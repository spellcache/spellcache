// Base éphémère pour les tests d'intégration (tests/integration/**/*.test.ts).
//
// Démarre le service `postgres-test` (profil Compose dédié, stockage tmpfs —
// aucune donnée ne survit) sur le port 5433, applique les migrations Drizzle,
// puis expose `process.env.TEST_DATABASE_URL` aux tests. Le conteneur est
// arrêté et supprimé en fin de run.
//
// Docker peut être absent de l'environnement d'exécution (ex. cette
// sandbox) : dans ce cas `setup` se dégrade proprement — les tests
// d'intégration doivent se sauter eux-mêmes via
// `describe.skipIf(!process.env.TEST_DATABASE_URL)`.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// `drizzle-kit` est lancé par son entrée Node, jamais par `pnpm exec` :
// `execFile` ne passe pas par un shell, et sur Windows le binaire de pnpm est
// un `.cmd` — l'appel échouait donc en `spawn pnpm ENOENT`, `setup` se
// dégradait, et TOUTE la suite d'intégration se sautait en silence sur un
// poste Windows tout en affichant « base éphémère indisponible ».
//
// Résolu depuis le répertoire du paquet plutôt qu'en codant le chemin en
// dur : pnpm range `drizzle-kit` dans un répertoire versionné de `.pnpm/`.
// Le `package.json` est lu par chemin absolu, car le paquet n'exporte ni
// `./package.json` ni `./bin.cjs`. Résolu depuis `@spellcache/db`, qui porte
// `drizzle-kit` et sa configuration : la migration tourne dans ce package.
const DB_PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
// Chaque package lance ses tests depuis son propre dossier : le fichier
// Compose de la racine est désigné explicitement plutôt que cherché.
const COMPOSE_FILE = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url))
const require_ = createRequire(join(DB_PACKAGE_DIR, 'package.json'))
const drizzleKitDir = dirname(require_.resolve('drizzle-kit'))
const drizzleKitBin = join(
  drizzleKitDir,
  (require_(join(drizzleKitDir, 'package.json')) as { bin: Record<string, string> }).bin[
    'drizzle-kit'
  ]!,
)

const COMPOSE_PROFILE = 'test'
const SERVICE = 'postgres-test'
export const TEST_DATABASE_URL = 'postgres://spellcache:spellcache@localhost:5433/spellcache_test'

let containerStarted = false

export async function setup() {
  // Base fournie par l'environnement (service Postgres de la CI) : on la
  // migre telle quelle, sans démarrer ni arrêter de conteneur.
  const externalUrl = process.env.TEST_DATABASE_URL
  if (externalUrl) {
    await execFileAsync(process.execPath, [drizzleKitBin, 'migrate'], {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: externalUrl },
    })
    return
  }

  try {
    await execFileAsync('docker', [
      'compose',
      '-f',
      COMPOSE_FILE,
      '--profile',
      COMPOSE_PROFILE,
      'up',
      '-d',
      SERVICE,
      '--wait',
    ])
    containerStarted = true

    await execFileAsync(process.execPath, [drizzleKitBin, 'migrate'], {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    })

    process.env.TEST_DATABASE_URL = TEST_DATABASE_URL
  } catch (error) {
    console.warn(
      `[tests/integration] base éphémère indisponible (${(error as Error).message.split('\n')[0]}) ` +
        '— les tests d\'intégration se sautent eux-mêmes.',
    )
  }
}

export async function teardown() {
  if (!containerStarted) return

  try {
    await execFileAsync('docker', ['compose', '-f', COMPOSE_FILE, 'stop', SERVICE])
    await execFileAsync('docker', ['compose', '-f', COMPOSE_FILE, 'rm', '-f', SERVICE])
  } catch {
    // Best effort : un conteneur tmpfs orphelin ne persiste aucune donnée.
  }
}
