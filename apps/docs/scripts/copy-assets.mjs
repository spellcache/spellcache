// Copie le favicon de design/assets/ vers public/, octet pour octet : une
// seule source pour l'app et la documentation. Le logo de l'en-tête, lui, est
// importé directement depuis design/ (astro.config.mjs).
//
// Un script Node plutôt qu'un `cp` shell : doit fonctionner identiquement
// sous PowerShell (dev Windows) et en CI Linux.

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const iconSourceDir = join(rootDir, '..', '..', 'design/assets/icon')

async function main() {
  await mkdir(join(rootDir, 'public'), { recursive: true })
  await copyFile(join(iconSourceDir, 'favicon.svg'), join(rootDir, 'public/favicon.svg'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
