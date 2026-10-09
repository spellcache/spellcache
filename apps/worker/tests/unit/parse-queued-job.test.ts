// Frontière de validation Zod du worker (docs/development.md, Coding conventions —
// toute entrée externe est validée par un schéma, jamais castée). Le payload
// sort de la file Redis en JSON brut : `parseQueuedJob` est le seul point où il redevient un `QueuedJob` de confiance.
import { describe, expect, it } from 'vitest'

import { parseQueuedJob } from '../../src/index.ts'

describe('worker/index — parseQueuedJob', () => {
  it('accepts a known job name, with or without payload', () => {
    expect(parseQueuedJob(JSON.stringify({ job: 'import-bulk' }))).toEqual({
      job: 'import-bulk',
      payload: undefined,
    })
    expect(parseQueuedJob(JSON.stringify({ job: 'revalue-containers', payload: { foo: 1 } }))).toEqual({
      job: 'revalue-containers',
      payload: { foo: 1 },
    })
  })

  it('drops malformed JSON', () => {
    expect(parseQueuedJob('{not json')).toBeNull()
  })

  it('drops a well-formed entry whose job name is not a known JobName — the crash this schema prevents downstream', () => {
    expect(parseQueuedJob(JSON.stringify({ job: 'delete-everything' }))).toBeNull()
  })

  it('drops an entry missing the job field entirely', () => {
    expect(parseQueuedJob(JSON.stringify({ payload: 42 }))).toBeNull()
  })
})
