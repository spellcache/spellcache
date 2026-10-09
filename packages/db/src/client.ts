import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema.ts'

// Singleton : évite d'ouvrir un nouveau pool à chaque rechargement à chaud en
// développement (le module Next.js peut être ré-évalué sans redémarrer le
// process Node).
declare global {
  var __spellcacheDb: NodePgDatabase<typeof schema> | undefined
}

function createDb(): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return drizzle(pool, { schema })
}

export const db: NodePgDatabase<typeof schema> = globalThis.__spellcacheDb ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__spellcacheDb = db
}
