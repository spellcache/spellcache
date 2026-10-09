// Runtime JS de Capacitor pour l'écran local, qui n'a pas de bundler : le
// build navigateur de @capacitor/core est copié dans www/ avant chaque
// `cap sync`, à la version installée (jamais versionné).
import { copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const coreDir = dirname(require.resolve('@capacitor/core/package.json'))
const www = join(dirname(fileURLToPath(import.meta.url)), '..', 'www')

copyFileSync(join(coreDir, 'dist', 'capacitor.js'), join(www, 'capacitor.js'))
