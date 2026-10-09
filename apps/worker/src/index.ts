// Ordonnanceur du worker : file Redis, boucle interne, jamais deux jobs en
// concurrence. Point d'entrée du service `worker` en développement
// (`docker-compose.yml`) comme en production (`docker-compose.example.yml`) ;
// la fenêtre nocturne et son verrou partagé vivent dans
// `apps/worker/src/scheduler.ts`.
//
// Sans bundler (résolution ESM native de Node, `node apps/worker/src/index.ts`),
// comme `apps/worker/src/import-bulk.ts` : tous les imports internes sont
// relatifs avec extension `.ts` explicite, jamais l'alias `@/`.
//
// Ce client Redis est distinct de `lib/redis.ts` (cache de recherche) :
// ce dernier échoue vite et en silence par conception (une recherche ne
// doit jamais attendre Redis). Une file de jobs a l'exigence inverse — se
// reconnecter et réessayer — donc un client `ioredis` dédié, avec son
// comportement par défaut (reconnexion, file d'attente hors-ligne),
// plutôt qu'un partage qui dégraderait silencieusement les deux jobs.
import Redis from 'ioredis'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

import { beat, createHealthState, startHealthServer } from './health.ts'
import { importBulk } from './import-bulk.ts'
import { revalueAllContainers } from './jobs/revalue-containers.ts'
import { resolveScheduleConfig, runNightly, startScheduler } from './scheduler.ts'
import { jobNameSchema, WORKER_QUEUE_KEY, type JobName } from '@spellcache/core/jobs'

export type { JobName }

// Entrée externe (payload lu depuis la file Redis) : validée par un schéma
// Zod à la frontière du worker, jamais castée (docs/development.md,
// Coding conventions). Un job dont le nom n'est pas une `JobName`
// connue est rejeté ici plutôt que de faire planter la boucle plus loin en
// heurtant `handlers[undefined]`.
const queuedJobSchema = z.object({
  job: jobNameSchema,
  payload: z.unknown().optional(),
})

interface QueuedJob {
  job: JobName
  payload?: unknown
}

const QUEUE_KEY = WORKER_QUEUE_KEY
// `BRPOP` bloque au plus ce délai avant de rendre la main — la boucle
// reprend son attente sans jamais tourner à vide en boucle serrée.
const POP_TIMEOUT_SECONDS = 5

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL is not set')
  return url
}

let redisClient: Redis | null = null
function getClient(): Redis {
  if (!redisClient) redisClient = new Redis(requireRedisUrl())
  return redisClient
}

export async function enqueue(job: JobName, payload?: unknown): Promise<void> {
  const entry: QueuedJob = { job, payload }
  await getClient().lpush(QUEUE_KEY, JSON.stringify(entry))
}

// Frontière de validation, pure et testable sans Redis : un `JSON.parse`
// suivi d'un cast n'aurait rien détecté d'une entrée dont `job` n'est pas un
// `JobName` connu — exactement le crash qu'elle prévient plus loin dans
// `consumeQueue`.
export function parseQueuedJob(raw: string): QueuedJob | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = queuedJobSchema.safeParse(parsed)
  return result.success ? result.data : null
}

async function popFromRedis(): Promise<QueuedJob | null> {
  const result = await getClient().brpop(QUEUE_KEY, POP_TIMEOUT_SECONDS)
  if (!result) return null
  const [, raw] = result
  const job = parseQueuedJob(raw)
  if (!job) console.warn(`[worker] dropping invalid queue entry: ${raw}`)
  return job
}

// Chaînage `import-bulk → revalue-containers` posé ici, dans
// l'ordonnanceur, plutôt que dans `apps/worker/src/import-bulk.ts` : ce dernier reste
// l'unique point d'entrée du script standalone `pnpm import:bulk`,
// qui ne doit jamais échouer faute de `REDIS_URL` configuré dans un
// environnement qui n'exécute pas le worker. L'ordonnanceur, lui, a déjà
// Redis pour exister — le chaînage y est un appel direct en cours de
// process, pas un aller-retour par la file.
async function handleImportBulk(): Promise<void> {
  await importBulk()
  await revalueAllContainers()
}

async function handleRevalueContainers(): Promise<void> {
  await revalueAllContainers()
}

const HANDLERS: Record<JobName, (payload?: unknown) => Promise<void>> = {
  'import-bulk': handleImportBulk,
  'revalue-containers': handleRevalueContainers,
}

// Boucle de consommation, pure et injectable (testée sans Redis ni base).
// La garantie « jamais deux jobs en
// concurrence » tient à la structure même de cette boucle : chaque
// itération attend la fin du job précédent (`await handlers[...]`) avant de
// redemander un job suivant — aucun chemin ne peut lancer un second job
// avant que le premier n'ait terminé.
export async function consumeQueue(
  popNext: () => Promise<QueuedJob | null>,
  handlers: Record<JobName, (payload?: unknown) => Promise<void>>,
  opts?: {
    maxIterations?: number
    onJobError?: (job: JobName, error: unknown) => void
    // Battement du healthcheck HTTP : appelé à chaque tour, y compris
    // les tours à vide, pour distinguer une boucle qui attend d'une boucle
    // bloquée.
    onTick?: () => void
  },
): Promise<void> {
  let iterations = 0
  for (;;) {
    if (opts?.maxIterations !== undefined && iterations >= opts.maxIterations) return
    iterations += 1
    opts?.onTick?.()

    const next = await popNext()
    if (!next) continue

    try {
      await handlers[next.job](next.payload)
    } catch (error) {
      // Boucle censée tourner pour toujours (les prix bougent seuls chaque
      // matin) : une erreur de job — déjà journalisée dans `import_runs` par
      // `revalueAllContainers()` elle-même, qui la traite comme un cas
      // nominal — ne doit jamais
      // achever le process pour de bon, sinon plus aucune nuit suivante ne
      // revalorise quoi que ce soit.
      if (opts?.onJobError) opts.onJobError(next.job, error)
      else console.error(`[worker] job "${next.job}" failed`, error)
    }
  }
}

// Ordonnancement nocturne : délégué à `apps/worker/src/scheduler.ts` —
// fenêtre horaire dans un fuseau IANA, et verrou Redis
// partagé avec le déclencheur cron de l'hôte (`deploy/cron.md`). La boucle de
// consommation ci-dessus reste la garantie « jamais deux jobs en concurrence »
// à l'intérieur de ce process ; le verrou est la même garantie entre process.

export async function startWorker(opts?: { maxIterations?: number }): Promise<void> {
  const health = createHealthState()
  startHealthServer(health)

  const scheduler = new AbortController()
  const config = resolveScheduleConfig()
  // La promesse de `startScheduler` ne se résout qu'à l'abandon : on ne
  // l'attend pas ici, c'est la boucle de consommation qui tient le process.
  void startScheduler(config, { enqueue, signal: scheduler.signal })

  try {
    await consumeQueue(popFromRedis, HANDLERS, { ...opts, onTick: () => beat(health) })
  } finally {
    scheduler.abort()
  }
}

// Déclencheur nocturne en ligne de commande (`node apps/worker/src/index.ts --run-now`,
// voir `deploy/cron.md`) : pose le verrou puis met la nuit
// en file, pour que le cron de l'hôte puisse la déclencher sans dupliquer
// l'exécution de l'ordonnanceur interne. Sort 0 dans les deux cas — un
// déclenchement ignoré parce qu'un autre détient le verrou est un succès, pas
// une erreur.
async function runNightlyFromCli(): Promise<void> {
  const queued = await runNightly({ enqueue })
  if (!queued) console.log('[worker] nightly trigger ignored, nothing queued')
}

// Point d'entrée du service `worker` du Compose (`docker-compose.yml` en
// développement, `docker-compose.example.yml` en production) — invoqué par `node
// apps/worker/src/index.ts` (ou `pnpm worker`), jamais importé pour son effet de bord
// par un autre module (même garde que `apps/worker/src/import-bulk.ts`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runNow = process.argv.includes('--run-now')
  const main = runNow ? runNightlyFromCli() : startWorker()
  main
    .then(() => {
      // Hors `--run-now`, n'est atteint que si `maxIterations` est fourni : la
      // boucle par défaut ne rend jamais la main.
      process.exit(0)
    })
    .catch((error) => {
      console.error('[worker] fatal error', error)
      process.exit(1)
    })
}
