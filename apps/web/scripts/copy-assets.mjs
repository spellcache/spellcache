// Copie les assets de design/assets/ vers public/, octet pour octet.
//
// Un script Node plutôt qu'un `cp -r` shell : doit fonctionner identiquement
// sous PowerShell (dev Windows) et en conteneur Linux (build Docker).

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Racine de l'app web (destination) et du dépôt (source : design/ y vit,
// partagé entre les apps).
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const iconSourceDir = join(rootDir, '..', '..', 'design/assets/icon')

async function copyIconFile(name, destDir) {
  await mkdir(destDir, { recursive: true })
  await copyFile(join(iconSourceDir, name), join(destDir, name))
}

async function main() {
  // Les symboles de mana ne passent pas par ici : scripts/fetch-mana.mjs les
  // télécharge depuis Scryfall.

  // Icône d'app : PNG + SVG -> public/icons/
  const iconAssets = [
    'favicon.svg',
    'spellcache-icon.svg',
    'spellcache-icon-16.png',
    'spellcache-icon-32.png',
    'spellcache-icon-64.png',
    'spellcache-icon-180.png',
    'spellcache-icon-192.png',
    'spellcache-icon-512.png',
    'spellcache-icon-maskable-192.png',
    'spellcache-icon-maskable-512.png',
    'spellcache-apple-touch-icon-180.png',
  ]
  for (const name of iconAssets) {
    await copyIconFile(name, join(rootDir, 'public/icons'))
  }

  // Manifest : sert depuis la racine publique, référencé par `<link rel="manifest" href="/site.webmanifest">`
  // et par ses propres icônes en `/icons/...` (design/assets/icon/site.webmanifest).
  await copyIconFile('site.webmanifest', join(rootDir, 'public'))

  console.log('Assets copiés vers public/icons/ et public/site.webmanifest')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
