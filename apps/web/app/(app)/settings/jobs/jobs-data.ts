// Lecture de `Administration › Jobs` : les dix dernières exécutions
// d'`import_runs`, tous jobs confondus (`default_cards`,
// `revalue-containers`) — même patron mince que `settings-data.ts`, la
// requête vit ici, la page ne fait que la
// rendre.
import { desc } from 'drizzle-orm'

import { importRuns } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

const RECENT_RUNS_LIMIT = 10

export interface JobRun {
  id: string
  source: string
  startedAt: Date
  finishedAt: Date | null
  rowsUpserted: number
  status: string
  errorMessage: string | null
}

export async function getRecentJobRuns(): Promise<JobRun[]> {
  return db
    .select({
      id: importRuns.id,
      source: importRuns.source,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
      rowsUpserted: importRuns.rowsUpserted,
      status: importRuns.status,
      errorMessage: importRuns.errorMessage,
    })
    .from(importRuns)
    .orderBy(desc(importRuns.startedAt))
    .limit(RECENT_RUNS_LIMIT)
}
