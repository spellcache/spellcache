// Applique les migrations Drizzle au démarrage du conteneur `web`, avant que
// `server.js` n'ouvre le port : un démarrage sur une base à schéma antérieur
// aboutit à une base à jour, sans requête servie entre-temps.
//
// Un seul conteneur les applique — jamais le `worker`, qui partage pourtant la
// même base : deux migrateurs en parallèle se disputent le verrou et l'un des
// deux échoue.
//
// Même bookkeeping que `pnpm db:migrate` en développement : le migrateur de
// `drizzle-orm` et `drizzle-kit` partagent la table `drizzle.__drizzle_migrations`
// et le journal `packages/db/migrations/meta/_journal.json`. Une migration déjà
// appliquée n'est donc jamais rejouée, et un redémarrage sur une base à jour
// est un no-op.
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const here = dirname(fileURLToPath(import.meta.url))
// `migrate.mjs` est posé à la racine de l'image (/app), à côté de `server.js` :
// le dossier de migrations est donc son voisin, pas un chemin relatif au
// répertoire courant — `output: 'standalone'` change ce dernier.
const migrationsFolder = join(here, 'db', 'migrations')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is not set')
  process.exit(1)
}

// Une seule connexion : ce process ne fait qu'une chose, et il meurt ensuite.
const pool = new Pool({ connectionString: databaseUrl, max: 1 })

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`)
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('[migrate] schema up to date')
} catch (error) {
  // Sortie non nulle : le point d'entrée s'arrête là (`set -e`) et le
  // conteneur redémarre au lieu de servir du trafic sur un schéma périmé.
  console.error('[migrate] failed', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
