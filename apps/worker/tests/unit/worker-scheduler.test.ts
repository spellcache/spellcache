// Ordonnanceur nocturne (`ScheduleConfig`, `startScheduler`, `acquireLock`) :
// deux déclenchements concurrents ne produisent qu'une exécution (verrou), le
// second se termine proprement en journalisant qu'il a été ignoré.
//
// Reprend la couverture de l'ancien ordonnanceur (une seule mise en file par
// nuit, déclenchement immédiat si le worker démarre dans la fenêtre, arrêt
// propre) sur `apps/worker/src/scheduler.ts`, qui remplace `startNightlyScheduler` —
// et y ajoute le fuseau horaire et le verrou, les deux nouveautés.
//
// Tout est injectable (horloge, `enqueue`, verrou) : aucun Redis, aucune
// horloge réelle, donc ces tests s'exécutent partout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SCHEDULE,
  NIGHTLY_LOCK_NAME,
  NIGHTLY_LOCK_TTL_MS,
  lockKey,
  parseNightlyAt,
  resolveScheduleConfig,
  runNightly,
  startScheduler,
  wallClock,
  type Logger,
  type NightlyJobName,
} from '../../src/scheduler.ts'

function silentLogger(): Logger & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    error: (message) => messages.push(message),
  }
}

describe('worker/scheduler — wallClock', () => {
  it('reads the hour in the configured time zone, not in UTC', () => {
    // 01:30 UTC en plein été (CEST) = 03:30 à Paris (UTC+2).
    expect(wallClock(new Date('2024-07-01T01:30:00Z'), 'Europe/Paris')).toEqual({
      day: '2024-07-01',
      minutes: 3 * 60 + 30,
    })
    // Le même instant, lu en UTC, tombe une heure creuse plus tôt.
    expect(wallClock(new Date('2024-07-01T01:30:00Z'), 'UTC')).toEqual({
      day: '2024-07-01',
      minutes: 60 + 30,
    })
  })

  it('rolls the local day over when the zone offset crosses midnight', () => {
    // 23:15 UTC est déjà le lendemain à Paris : le jour local — la clé du
    // « une fois par nuit » — doit suivre le fuseau, pas l'horloge du serveur.
    expect(wallClock(new Date('2024-01-08T23:15:00Z'), 'Europe/Paris')).toEqual({
      day: '2024-01-09',
      minutes: 15,
    })
  })

  it('renders midnight as 0 minutes, never as hour 24', () => {
    expect(wallClock(new Date('2024-01-08T00:00:00Z'), 'UTC')).toEqual({
      day: '2024-01-08',
      minutes: 0,
    })
  })
})

describe('worker/scheduler — resolveScheduleConfig', () => {
  it('reads WORKER_NIGHTLY_AT and WORKER_TIMEZONE', () => {
    expect(
      resolveScheduleConfig(
        { WORKER_NIGHTLY_AT: '02:45', WORKER_TIMEZONE: 'Europe/Paris' },
        silentLogger(),
      ),
    ).toEqual({ nightlyAt: '02:45', timezone: 'Europe/Paris' })
  })

  it('falls back to the default when WORKER_NIGHTLY_AT is not a HH:MM time', () => {
    const logger = silentLogger()
    expect(resolveScheduleConfig({ WORKER_NIGHTLY_AT: '3h' }, logger)).toEqual(DEFAULT_SCHEDULE)
    expect(logger.messages.join('\n')).toContain('WORKER_NIGHTLY_AT')
  })

  it('rejects an out-of-range hour rather than scheduling at NaN', () => {
    expect(resolveScheduleConfig({ WORKER_NIGHTLY_AT: '24:00' }, silentLogger())).toEqual(
      DEFAULT_SCHEDULE,
    )
  })

  it('still honours WORKER_NIGHTLY_HOUR_UTC and forces UTC with it', () => {
    expect(
      resolveScheduleConfig(
        { WORKER_NIGHTLY_HOUR_UTC: '4', WORKER_TIMEZONE: 'Europe/Paris' },
        silentLogger(),
      ),
    ).toEqual({ nightlyAt: '04:00', timezone: 'UTC' })
  })

  it('falls back to UTC on an unknown time zone instead of throwing at 03:15', () => {
    const logger = silentLogger()
    expect(
      resolveScheduleConfig({ WORKER_NIGHTLY_AT: '03:15', WORKER_TIMEZONE: 'Mars/Olympus' }, logger),
    ).toEqual({ nightlyAt: '03:15', timezone: 'UTC' })
    expect(logger.messages.join('\n')).toContain('WORKER_TIMEZONE')
  })

  it('parses HH:MM into minutes since local midnight', () => {
    expect(parseNightlyAt('03:15')).toBe(195)
    expect(parseNightlyAt('00:00')).toBe(0)
  })
})

describe('worker/scheduler — runNightly', () => {
  it('takes the lock, then queues import-bulk', async () => {
    const queued: NightlyJobName[] = []
    const locks: Array<[string, number]> = []

    const ran = await runNightly({
      enqueue: async (job) => {
        queued.push(job)
      },
      acquireLockFn: async (name, ttlMs) => {
        locks.push([name, ttlMs])
        return true
      },
      logger: silentLogger(),
    })

    expect(ran).toBe(true)
    expect(queued).toEqual(['import-bulk'])
    expect(locks).toEqual([[NIGHTLY_LOCK_NAME, NIGHTLY_LOCK_TTL_MS]])
  })

  it('queues nothing and logs the skip when another trigger holds the lock', async () => {
    const queued: NightlyJobName[] = []
    const logger = silentLogger()

    const ran = await runNightly({
      enqueue: async (job) => {
        queued.push(job)
      },
      acquireLockFn: async () => false,
      logger,
    })

    expect(ran).toBe(false)
    expect(queued).toEqual([])
    expect(logger.messages.join('\n')).toContain('skipped')
  })

  it('lets only the first of two concurrent triggers queue the night', async () => {
    // Le verrou réel est un `SET NX` Redis ; ici, la même sémantique en
    // mémoire — le premier appelant l'obtient, les suivants non.
    let held = false
    const acquireLockFn = async (): Promise<boolean> => {
      if (held) return false
      held = true
      return true
    }
    const queued: NightlyJobName[] = []
    const enqueue = async (job: NightlyJobName): Promise<void> => {
      queued.push(job)
    }
    const logger = silentLogger()

    const [first, second] = await Promise.all([
      runNightly({ enqueue, acquireLockFn, logger }),
      runNightly({ enqueue, acquireLockFn, logger }),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(queued).toEqual(['import-bulk'])
  })

  it('namespaces the lock key', () => {
    expect(lockKey(NIGHTLY_LOCK_NAME)).toBe('spellcache:worker:lock:nightly')
  })
})

describe('worker/scheduler — startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function harness() {
    const queued: NightlyJobName[] = []
    return {
      queued,
      deps: {
        enqueue: async (job: NightlyJobName): Promise<void> => {
          queued.push(job)
        },
        acquireLockFn: async (): Promise<boolean> => true,
        logger: silentLogger(),
      },
    }
  }

  it('queues the night once the local clock enters the window, not again the same day, then again the next day', async () => {
    const { queued, deps } = harness()
    let current = new Date('2024-01-08T01:00:00Z') // 02:00 à Paris, avant 03:15.
    const controller = new AbortController()

    void startScheduler(
      { nightlyAt: '03:15', timezone: 'Europe/Paris' },
      { ...deps, now: () => current, signal: controller.signal },
    )
    expect(queued).toEqual([])

    current = new Date('2024-01-08T02:16:00Z') // 03:16 à Paris.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queued).toEqual(['import-bulk'])

    current = new Date('2024-01-08T02:40:00Z') // toujours dans la fenêtre.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queued).toEqual(['import-bulk'])

    current = new Date('2024-01-09T02:16:00Z') // la nuit suivante.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queued).toEqual(['import-bulk', 'import-bulk'])

    controller.abort()
  })

  it('triggers immediately when the worker restarts inside the window', async () => {
    const { queued, deps } = harness()
    const controller = new AbortController()

    void startScheduler(
      { nightlyAt: '03:15', timezone: 'UTC' },
      { ...deps, now: () => new Date('2024-01-08T03:40:00Z'), signal: controller.signal },
    )
    // `runNightly` est asynchrone : laisser la microtâche se vider.
    await vi.advanceTimersByTimeAsync(0)

    expect(queued).toEqual(['import-bulk'])
    controller.abort()
  })

  it('never triggers a deploy-time import outside the window', async () => {
    // Un redémarrage à 14:00 ne doit rien lancer : sans fenêtre, une simple
    // comparaison « heure locale >= 03:15 » déclencherait un import bulk à
    // chaque déploiement de la journée.
    const { queued, deps } = harness()
    let current = new Date('2024-01-08T14:00:00Z')
    const controller = new AbortController()

    void startScheduler(
      { nightlyAt: '03:15', timezone: 'UTC' },
      { ...deps, now: () => current, signal: controller.signal },
    )
    current = new Date('2024-01-08T16:00:00Z')
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(queued).toEqual([])
    controller.abort()
  })

  it('resolves and stops ticking once the signal is aborted', async () => {
    const { queued, deps } = harness()
    let current = new Date('2024-01-08T01:00:00Z')
    const controller = new AbortController()

    const stopped = startScheduler(
      { nightlyAt: '03:15', timezone: 'UTC' },
      { ...deps, now: () => current, signal: controller.signal },
    )
    controller.abort()
    await stopped

    current = new Date('2024-01-08T03:20:00Z')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(queued).toEqual([])
  })
})
