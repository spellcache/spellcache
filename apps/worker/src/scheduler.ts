// Ordonnanceur nocturne du worker : import bulk + revalorisation une fois par
// nuit (heure creuse), avec verrou empêchant deux exécutions simultanées.
//
// Reprend et remplace `startNightlyScheduler` de `apps/worker/src/index.ts`, qui
// ne connaissait qu'une heure UTC entière et aucun verrou : en production deux
// déclencheurs coexistent — l'ordonnanceur interne de ce conteneur et l'entrée
// cron de l'hôte documentée dans `deploy/cron.md`. Sans verrou partagé, une
// nuit lançait deux imports bulk en parallèle.
//
// Sans bundler (résolution ESM native de Node, `node apps/worker/src/index.ts`) : tous
// les imports internes sont relatifs avec extension `.ts` explicite, jamais
// l'alias `@/`.
import Redis from 'ioredis'
import { z } from 'zod'

// Contrat de configuration : heure locale « HH:MM » et fuseau
// IANA. L'heure est lue dans ce fuseau, pas en UTC — sinon la nuit creuse
// dérive d'une heure entre l'été et l'hiver.
export interface ScheduleConfig {
  nightlyAt: string /* "03:15" */
  timezone: string
}

export type NightlyJobName = 'import-bulk'

const LOCK_KEY_PREFIX = 'spellcache:worker:lock:'
export const NIGHTLY_LOCK_NAME = 'nightly'

// Le verrou représente la nuit, pas la durée d'un appel : il est pris avant la
// mise en file et expire de lui-même. 6 h couvre largement le plus long import
// bulk observé tout en étant très inférieur aux 24 h qui séparent deux nuits —
// une nuit ratée pour cause de verrou périmé est donc impossible. Pour forcer
// une relance dans la même fenêtre, supprimer la clé (voir docs/self-hosting.md).
export const NIGHTLY_LOCK_TTL_MS = 6 * 60 * 60 * 1000

// Sondage minute par minute plutôt qu'un délai unique calculé au démarrage :
// ce dernier dérive après la première nuit (durée du job précédent,
// redémarrage du conteneur), le sondage reste correct indéfiniment.
const TICK_MS = 60_000

// Fenêtre de déclenchement, en minutes après `nightlyAt`. Elle absorbe un
// redémarrage du conteneur en pleine nuit (le worker relancé à 03:40 rattrape
// la nuit de 03:15) sans pour autant qu'un déploiement de 14 h ne déclenche un
// import bulk : passé la fenêtre, plus rien ne part avant la nuit suivante.
const TRIGGER_WINDOW_MINUTES = 60

const nightlyAtSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
const nightlyHourUtcSchema = z.coerce.number().int().min(0).max(23)

export const DEFAULT_SCHEDULE: ScheduleConfig = { nightlyAt: '03:15', timezone: 'UTC' }

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string, error?: unknown) => void
}

const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, error) => console.error(message, error),
}

// --- Verrou Redis ------------------------------------------------------------

// Client dédié au verrou, distinct de celui de la file (`apps/worker/src/index.ts`) :
// `acquireLock` doit aussi fonctionner depuis le déclencheur en ligne de
// commande de `deploy/cron.md`, qui n'ouvre jamais la boucle de consommation.
let lockClient: Redis | null = null

function getLockClient(): Redis {
  if (!lockClient) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not set')
    lockClient = new Redis(url)
  }
  return lockClient
}

export function lockKey(name: string): string {
  return `${LOCK_KEY_PREFIX}${name}`
}

// `SET key value NX PX ttl` : pose atomique, donc sûre entre deux process
// concurrents (l'ordonnanceur interne et le cron de l'hôte). Le premier obtient
// `OK`, le second `null`.
export async function acquireLock(name: string, ttlMs: number): Promise<boolean> {
  const ttl = Math.max(1, Math.trunc(ttlMs))
  const result = await getLockClient().set(lockKey(name), String(Date.now()), 'PX', ttl, 'NX')
  return result === 'OK'
}

// --- Heure locale ------------------------------------------------------------

export interface WallClock {
  /** Jour local au format `YYYY-MM-DD` — la clé « une fois par nuit ». */
  day: string
  /** Minutes écoulées depuis minuit, heure locale du fuseau configuré. */
  minutes: number
}

// `hourCycle: 'h23'` explicitement, jamais `hour12: false` : ce dernier rend
// minuit « 24 » sur plusieurs versions d'ICU, ce qui décalerait la fenêtre d'un
// jour entier. Le `% 24` garde le calcul juste même si l'environnement rend
// tout de même « 24 ».
export function wallClock(at: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    minutes: (Number(read('hour')) % 24) * 60 + Number(read('minute')),
  }
}

export function parseNightlyAt(nightlyAt: string): number {
  const [hours, minutes] = nightlyAt.split(':')
  return Number(hours) * 60 + Number(minutes)
}

// --- Configuration -----------------------------------------------------------

// Entrée externe (variables d'environnement) validée par un schéma Zod à la
// frontière, jamais castée (docs/development.md, « Coding conventions »). Une
// valeur invalide retombe sur le défaut avec un log explicite, plutôt que de
// produire un `NaN` qui empêcherait silencieusement toute nuit de partir.
export function resolveScheduleConfig(
  env: Record<string, string | undefined> = process.env,
  logger: Logger = consoleLogger,
): ScheduleConfig {
  const rawAt = env.WORKER_NIGHTLY_AT
  const rawHourUtc = env.WORKER_NIGHTLY_HOUR_UTC

  if (rawAt !== undefined) {
    const parsed = nightlyAtSchema.safeParse(rawAt)
    if (parsed.success) {
      return { nightlyAt: parsed.data, timezone: resolveTimezone(env.WORKER_TIMEZONE, logger) }
    }
    logger.error(
      `[worker] WORKER_NIGHTLY_AT=${JSON.stringify(rawAt)} is not a "HH:MM" time, falling back to ${DEFAULT_SCHEDULE.nightlyAt}`,
    )
  }

  // Compatibilité avec `WORKER_NIGHTLY_HOUR_UTC` (`docker-compose.yml` de
  // développement) : le nom de la variable promet UTC, le fuseau est donc forcé
  // à UTC ici — `WORKER_TIMEZONE` ne s'applique qu'à `WORKER_NIGHTLY_AT`.
  if (rawAt === undefined && rawHourUtc !== undefined) {
    const parsed = nightlyHourUtcSchema.safeParse(rawHourUtc)
    if (parsed.success) {
      return { nightlyAt: `${String(parsed.data).padStart(2, '0')}:00`, timezone: 'UTC' }
    }
    logger.error(
      `[worker] WORKER_NIGHTLY_HOUR_UTC=${JSON.stringify(rawHourUtc)} is not an integer in 0-23, falling back to ${DEFAULT_SCHEDULE.nightlyAt} UTC`,
    )
  }

  return { nightlyAt: DEFAULT_SCHEDULE.nightlyAt, timezone: resolveTimezone(env.WORKER_TIMEZONE, logger) }
}

function resolveTimezone(raw: string | undefined, logger: Logger): string {
  if (raw === undefined || raw === '') return DEFAULT_SCHEDULE.timezone
  try {
    // Un fuseau inconnu fait lever `Intl` : le détecter au démarrage plutôt
    // qu'à 03:15, où l'exception tuerait le tick sans laisser de trace utile.
    new Intl.DateTimeFormat('en-CA', { timeZone: raw })
    return raw
  } catch {
    logger.error(
      `[worker] WORKER_TIMEZONE=${JSON.stringify(raw)} is not a known IANA time zone, falling back to ${DEFAULT_SCHEDULE.timezone}`,
    )
    return DEFAULT_SCHEDULE.timezone
  }
}

// --- Exécution nocturne ------------------------------------------------------

export interface SchedulerDeps {
  /**
   * Mise en file du job d'import. Le chaînage `import-bulk → revalue-containers`
   * appartient à la boucle de consommation (`apps/worker/src/index.ts`) : on ne met
   * en file que le premier maillon. Par défaut, `enqueue` de `apps/worker/src/index.ts`,
   * importé dynamiquement pour éviter un cycle de modules statique.
   */
  enqueue?: (job: NightlyJobName) => Promise<void>
  acquireLockFn?: (name: string, ttlMs: number) => Promise<boolean>
  now?: () => Date
  logger?: Logger
  /** Arrête la boucle ; la promesse de `startScheduler` se résout alors. */
  signal?: AbortSignal
}

async function defaultEnqueue(job: NightlyJobName): Promise<void> {
  const { enqueue } = await import('./index.ts')
  await enqueue(job)
}

/**
 * Déclenche la nuit : prend le verrou, puis met `import-bulk` en file.
 * Retourne `false` — sans échouer — si un autre déclencheur détient déjà le
 * verrou : le second se termine proprement en journalisant qu'il a été
 * ignoré.
 */
export async function runNightly(deps: SchedulerDeps = {}): Promise<boolean> {
  const logger = deps.logger ?? consoleLogger
  const acquire = deps.acquireLockFn ?? acquireLock
  const enqueue = deps.enqueue ?? defaultEnqueue

  const acquired = await acquire(NIGHTLY_LOCK_NAME, NIGHTLY_LOCK_TTL_MS)
  if (!acquired) {
    logger.warn(
      `[worker] nightly run skipped: another trigger holds the "${NIGHTLY_LOCK_NAME}" lock`,
    )
    return false
  }

  await enqueue('import-bulk')
  logger.info('[worker] nightly run queued: import-bulk, then revalue-containers')
  return true
}

/**
 * Boucle d'ordonnancement. La promesse ne se résout que lorsque `deps.signal`
 * est avorté — le conteneur `worker` la garde ouverte pour toujours.
 */
export function startScheduler(cfg: ScheduleConfig, deps: SchedulerDeps = {}): Promise<void> {
  const logger = deps.logger ?? consoleLogger
  const now = deps.now ?? ((): Date => new Date())
  const target = parseNightlyAt(cfg.nightlyAt)

  let lastTriggeredDay: string | null = null
  let running = false

  const tick = (): void => {
    const { day, minutes } = wallClock(now(), cfg.timezone)
    if (minutes < target || minutes >= target + TRIGGER_WINDOW_MINUTES) return
    if (day === lastTriggeredDay) return
    // Posé avant l'`await` : un tick suivant ne doit pas rentrer pendant que
    // `runNightly` est en vol. Le verrou Redis couvre les autres process, cette
    // garde couvre celui-ci.
    lastTriggeredDay = day
    if (running) return
    running = true

    runNightly(deps)
      .catch((error) => {
        // Une nuit ratée ne doit jamais achever le process : sans cela, plus
        // aucune nuit suivante ne revalorise quoi que ce soit.
        logger.error('[worker] nightly trigger failed', error)
      })
      .finally(() => {
        running = false
      })
  }

  logger.info(`[worker] nightly schedule: ${cfg.nightlyAt} ${cfg.timezone}`)
  // Couvre le redémarrage du conteneur à l'intérieur de la fenêtre, sans
  // attendre la première minute.
  tick()
  const interval = setInterval(tick, TICK_MS)

  return new Promise<void>((resolve) => {
    const stop = (): void => {
      clearInterval(interval)
      resolve()
    }
    if (deps.signal?.aborted) return stop()
    deps.signal?.addEventListener('abort', stop, { once: true })
  })
}
