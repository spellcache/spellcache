// Boucle de développement sur téléphone : synchronise la coque, relie le port
// de `pnpm dev` au téléphone (adb reverse), installe et lance le build debug
// (`io.github.spellcache.dev`, à côté de la release).
//
//   pnpm android:dev              # port 3000
//   DEV_PORT=3001 pnpm android:dev
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const windows = process.platform === 'win32'
const port = process.env.DEV_PORT ?? '3000'
const appId = 'io.github.spellcache.dev'

// adb et le SDK viennent de l'installation d'Android Studio quand ils ne sont
// pas dans l'environnement.
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (windows && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
    : null)
const sdkAdb = sdk && join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb')
const adb = sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb'

// JDK 21, celui de la CI : le JDK d'Android Studio (25) est trop récent pour
// la version de Gradle du projet.
const env = { ...process.env }
if (!env.ANDROID_HOME && sdk && existsSync(sdk)) env.ANDROID_HOME = sdk
if (!env.JAVA_HOME) {
  const jdkRoots = windows
    ? [
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Microsoft',
      ]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines']
  const jdk21 = jdkRoots
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)))
    .find((path) => /(jdk|temurin|openjdk)-?21/i.test(path))
  if (jdk21)
    env.JAVA_HOME = existsSync(join(jdk21, 'Contents', 'Home'))
      ? join(jdk21, 'Contents', 'Home')
      : jdk21
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    // Les .bat/.cmd (gradlew, pnpm) exigent un shell sous Windows.
    shell: windows && !command.endsWith('.exe'),
  })
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? result.stderr ?? `exit code ${result.status}`)
    process.exit(result.status || 1)
  }
  return result.stdout ?? ''
}

const devices = run(adb, ['devices'], { capture: true })
  .split('\n')
  .slice(1)
  .filter((line) => /\tdevice$/.test(line.trim()))
if (devices.length === 0) {
  console.error(
    'No Android device: plug the phone in over USB (USB debugging on) or pair it with ' +
      '`adb pair` (Wireless debugging), then retry.',
  )
  process.exit(1)
}

// Profil Android cible : celui au premier plan, sauf `DEV_USER`. `installDebug`
// ne choisit pas de profil ; sur un téléphone à plusieurs profils, l'app
// doit atterrir dans celui où l'on teste.
const user =
  process.env.DEV_USER ??
  run(adb, ['shell', 'am', 'get-current-user'], { capture: true }).trim()

run('node', ['scripts/copy-runtime.mjs'])
run('pnpm', ['exec', 'cap', 'sync', 'android'])
run(adb, ['reverse', `tcp:${port}`, `tcp:${port}`])
// Chemin absolu : le répertoire courant n'est pas toujours cherché par `cmd`
// (NoDefaultCurrentDirectoryInExePath).
const gradlew = join(root, 'android', windows ? 'gradlew.bat' : 'gradlew')
run(windows ? `"${gradlew}"` : gradlew, ['assembleDebug'], {
  cwd: join(root, 'android'),
})
run(adb, [
  'install',
  '-r',
  '--user',
  user,
  join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
])
run(adb, [
  'shell',
  'am',
  'start',
  '--user',
  user,
  '-n',
  `${appId}/io.github.spellcache.MainActivity`,
])

console.log(
  `\nspellcache dev is running (Android user ${user}). ` +
    `Server address in the app: http://localhost:${port}` +
    '\nDevTools: chrome://inspect on this computer.',
)
