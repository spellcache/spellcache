// Télécharge les symboles de mana depuis Scryfall vers public/mana/.
//
// Les symboles appartiennent à Wizards of the Coast : ils ne sont pas versionnés
// dans le dépôt mais récupérés au setup (`predev`, `prebuild`). Lancé hors de
// toute requête utilisateur, comme l'import bulk — la règle « aucun appel à
// Scryfall pendant une requête » tient. Un fichier déjà présent n'est pas
// retéléchargé ; `--force` les remplace tous.
//
// Le nom de fichier est celui de `svg_uri` (`{W/U/P}` -> `WUP.svg`), le même
// que celui qu'attend `components/cards/mana-cost.tsx`.

import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const destDir = join(rootDir, 'public/mana')
const force = process.argv.includes('--force')

// Scryfall demande un User-Agent identifiable et 50–100 ms entre deux requêtes.
const headers = { 'User-Agent': 'spellcache/1.0', Accept: 'application/json' }
const DELAY_MS = 100

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(destDir, { recursive: true })

  const response = await fetch('https://api.scryfall.com/symbology', { headers })
  if (!response.ok) throw new Error(`GET /symbology: HTTP ${response.status}`)
  const { data } = await response.json()

  let downloaded = 0
  for (const symbol of data) {
    const uri = symbol.svg_uri
    if (typeof uri !== 'string' || !uri.startsWith('https://svgs.scryfall.io/')) continue
    const name = uri.split('/').pop()
    if (!/^[A-Za-z0-9]+\.svg$/.test(name)) continue

    const target = join(destDir, name)
    if (!force && (await exists(target))) continue

    await sleep(DELAY_MS)
    const svg = await fetch(uri, { headers: { 'User-Agent': headers['User-Agent'] } })
    if (!svg.ok) throw new Error(`GET ${uri}: HTTP ${svg.status}`)
    await writeFile(target, await svg.text())
    downloaded += 1
  }

  console.log(`Symboles de mana : ${downloaded} téléchargé(s) vers public/mana/`)
}

main().catch(async (err) => {
  // Hors ligne avec un public/mana/ déjà rempli : on continue sans bloquer.
  if (await exists(join(destDir, 'W.svg'))) {
    console.warn(`[fetch-mana] ${err.message} — symboles existants conservés`)
    return
  }
  console.error(err)
  process.exit(1)
})
