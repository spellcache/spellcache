// La clé de file et les noms de jobs vivent dans un seul module partagé
// (packages/core/src/jobs.ts) : le serveur web qui dépose un job et le worker qui le
// consomme doivent tous deux s'y référer, jamais redéfinir leur propre copie.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { WORKER_QUEUE_KEY } from '@/lib/jobs/manual-jobs'
import { WORKER_QUEUE_KEY as CONTRACT_QUEUE_KEY } from '@spellcache/core/jobs'

describe('manual jobs', () => {
  it('enqueues on the queue key of the shared contract', () => {
    expect(WORKER_QUEUE_KEY).toBe(CONTRACT_QUEUE_KEY)
    expect(CONTRACT_QUEUE_KEY).toBe('spellcache:worker:jobs')
  })

  it('has the worker consume that same contract instead of a local copy', () => {
    const worker = readFileSync('../worker/src/index.ts', 'utf8')
    expect(worker).toMatch(/import \{[^}]*WORKER_QUEUE_KEY[^}]*\} from '@spellcache\/core\/jobs'/)
    expect(worker).not.toMatch(/'spellcache:worker:jobs'/)
  })
})
