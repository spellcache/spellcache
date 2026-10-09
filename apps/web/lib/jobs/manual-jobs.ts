// Déclenchement manuel des jobs du worker (Administration › Jobs). Le serveur
// web ne fait jamais le travail lui-même — aucun appel Scryfall pendant une
// requête utilisateur (docs/development.md) : il dépose le job dans la file Redis du
// worker, qui l'exécute comme un job nocturne.
//
// Garde-fous : jamais un job déjà en file ou en cours, et un délai minimal
// entre deux imports bulk (Scryfall ne publie ses fichiers qu'environ une fois
// par jour — relancer en boucle retéléchargerait ~100 Mo pour rien).
import { and, desc, eq, gt } from 'drizzle-orm'

import { importRuns } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { WORKER_QUEUE_KEY, type JobName } from '@spellcache/core/jobs'
import { getRedisClient } from '@/lib/redis'

export { WORKER_QUEUE_KEY }

export type ManualJob = JobName

// `import_runs.source` écrit par chaque job (apps/worker/src/import-bulk.ts,
// apps/worker/src/jobs/revalue-containers.ts).
const RUN_SOURCE: Record<ManualJob, string> = {
  'import-bulk': 'default_cards',
  'revalue-containers': 'revalue-containers',
}

export const BULK_IMPORT_COOLDOWN_MS = 60 * 60 * 1000
// Une ligne `running` plus vieille que ça vient d'un worker tombé en cours de
// route : elle ne bloque plus un nouveau lancement (même durée que le verrou
// nocturne, apps/worker/src/scheduler.ts).
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000

export interface ManualJobState {
  job: ManualJob
  queued: boolean
  running: boolean
  // Prochain lancement permis (délai entre deux imports bulk), `null` si
  // aucun délai ne s'applique.
  availableAt: Date | null
}

async function queuedJobs(): Promise<Set<string> | null> {
  const client = getRedisClient()
  if (!client) return null
  try {
    if (client.status === 'wait') await client.connect()
    const entries = await client.lrange(WORKER_QUEUE_KEY, 0, -1)
    const names = new Set<string>()
    for (const raw of entries) {
      try {
        const parsed = JSON.parse(raw) as { job?: unknown }
        if (typeof parsed.job === 'string') names.add(parsed.job)
      } catch {
        // Entrée illisible : le worker la rejette de toute façon.
      }
    }
    return names
  } catch (error) {
    console.warn(`[jobs] queue read failed: ${(error as Error).message}`)
    return null
  }
}

async function runStateOf(job: ManualJob, now: Date): Promise<{ running: boolean; availableAt: Date | null }> {
  const source = RUN_SOURCE[job]
  const [running] = await db
    .select({ id: importRuns.id })
    .from(importRuns)
    .where(
      and(
        eq(importRuns.source, source),
        eq(importRuns.status, 'running'),
        gt(importRuns.startedAt, new Date(now.getTime() - STALE_RUNNING_MS)),
      ),
    )
    .limit(1)

  let availableAt: Date | null = null
  if (job === 'import-bulk') {
    const [last] = await db
      .select({ startedAt: importRuns.startedAt })
      .from(importRuns)
      .where(eq(importRuns.source, source))
      .orderBy(desc(importRuns.startedAt))
      .limit(1)
    if (last) {
      const until = new Date(last.startedAt.getTime() + BULK_IMPORT_COOLDOWN_MS)
      if (until > now) availableAt = until
    }
  }
  return { running: Boolean(running), availableAt }
}

export async function getManualJobStates(now = new Date()): Promise<ManualJobState[]> {
  const queued = await queuedJobs()
  return Promise.all(
    (['import-bulk', 'revalue-containers'] as const).map(async (job) => ({
      job,
      queued: queued?.has(job) ?? false,
      ...(await runStateOf(job, now)),
    })),
  )
}

export type TriggerJobError = 'queued' | 'running' | 'cooldown' | 'unavailable'

export async function triggerJob(
  job: ManualJob,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: TriggerJobError }> {
  const client = getRedisClient()
  const queued = await queuedJobs()
  if (!client || queued === null) return { ok: false, error: 'unavailable' }
  if (queued.has(job)) return { ok: false, error: 'queued' }

  const state = await runStateOf(job, now)
  if (state.running) return { ok: false, error: 'running' }
  if (state.availableAt) return { ok: false, error: 'cooldown' }

  try {
    await client.lpush(WORKER_QUEUE_KEY, JSON.stringify({ job }))
  } catch (error) {
    console.warn(`[jobs] enqueue failed: ${(error as Error).message}`)
    return { ok: false, error: 'unavailable' }
  }
  return { ok: true }
}
