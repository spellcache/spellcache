// Boucle de consommation du worker : `startWorker()` n'exécute jamais deux
// jobs simultanément. `consumeQueue` est une fonction pure — aucune base ni
// Redis nécessaire, contrairement au reste de cette feature (worker +
// Postgres), ce qui la rend exécutable même sans Docker.
import { describe, expect, it } from 'vitest'

import { consumeQueue, type JobName } from '../../src/index.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('worker/index — consumeQueue', () => {
  it('never runs two jobs concurrently: two close jobs run one after the other, never overlapping', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []

    const queued: Array<{ job: JobName; payload?: unknown }> = [
      { job: 'import-bulk' },
      { job: 'revalue-containers' },
    ]

    const popNext = async () => queued.shift() ?? null

    const handlers: Record<JobName, () => Promise<void>> = {
      'import-bulk': async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        order.push('start:import-bulk')
        await sleep(20)
        order.push('end:import-bulk')
        active -= 1
      },
      'revalue-containers': async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        order.push('start:revalue-containers')
        await sleep(5)
        order.push('end:revalue-containers')
        active -= 1
      },
    }

    await consumeQueue(popNext, handlers, { maxIterations: 2 })

    expect(maxActive).toBe(1)
    expect(order).toEqual([
      'start:import-bulk',
      'end:import-bulk',
      'start:revalue-containers',
      'end:revalue-containers',
    ])
  })

  it('skips empty pops without invoking any handler, and stops at maxIterations', async () => {
    let calls = 0
    const popNext = async () => null
    const handlers: Record<JobName, () => Promise<void>> = {
      'import-bulk': async () => {
        calls += 1
      },
      'revalue-containers': async () => {
        calls += 1
      },
    }

    await consumeQueue(popNext, handlers, { maxIterations: 3 })

    expect(calls).toBe(0)
  })

  it('never lets a job error escape the loop: the next job still runs (priority minor 1 — a job error must not kill the worker forever)', async () => {
    const order: string[] = []
    const errors: Array<{ job: JobName; error: unknown }> = []

    const queued: Array<{ job: JobName }> = [{ job: 'import-bulk' }, { job: 'revalue-containers' }]
    const popNext = async () => queued.shift() ?? null

    const handlers: Record<JobName, () => Promise<void>> = {
      'import-bulk': async () => {
        order.push('import-bulk')
        throw new Error('simulated revaluation failure')
      },
      'revalue-containers': async () => {
        order.push('revalue-containers')
      },
    }

    await expect(
      consumeQueue(popNext, handlers, {
        maxIterations: 2,
        onJobError: (job, error) => errors.push({ job, error }),
      }),
    ).resolves.toBeUndefined()

    expect(order).toEqual(['import-bulk', 'revalue-containers'])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.job).toBe('import-bulk')
    expect((errors[0]?.error as Error).message).toBe('simulated revaluation failure')
  })

  it('routes a job by name to its own handler only', async () => {
    const seen: JobName[] = []
    const queued: Array<{ job: JobName }> = [{ job: 'revalue-containers' }]
    const popNext = async () => queued.shift() ?? null

    const handlers: Record<JobName, () => Promise<void>> = {
      'import-bulk': async () => {
        seen.push('import-bulk')
      },
      'revalue-containers': async () => {
        seen.push('revalue-containers')
      },
    }

    await consumeQueue(popNext, handlers, { maxIterations: 1 })

    expect(seen).toEqual(['revalue-containers'])
  })
})
