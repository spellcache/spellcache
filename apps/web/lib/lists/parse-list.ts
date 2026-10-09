// Analyseur de liste texte. Pur : aucune base,
// aucun réseau — la résolution contre le catalogue local est le travail de
// `lib/lists/resolve-list.ts`, jamais celui-ci.
//
// Un export CSV (en-tête avec au moins un nom et une quantité) passe par
// `parse-csv.ts`. Sinon, les quatre formats d'entrée acceptés, et rien
// d'autre :
//   `4 Lightning Bolt`
//   `4 Lightning Bolt (2X2) 117`
//   `4x Lightning Bolt`
//   `4x Lightning Bolt (2X2) 117`
// Une ligne qui ne commence pas par une quantité n'est **jamais** devinée
// comme une carte : elle bascule la zone si c'est un en-tête de section,
// sinon elle rejoint `ignored` et l'aperçu la montre à l'utilisateur. Deviner
// `qty = 1` sur toute ligne restante ferait passer `About`, `Name …` ou une
// ligne de commentaire pour des cartes inconnues, et rendrait le compteur
// `N inconnues` illisible.
import type { Condition, DeckZone, Finish } from '@spellcache/db/schema'

import { looksLikeCsvHeader, parseCsv } from './parse-csv'

export interface ParsedLine {
  raw: string
  qty: number
  name: string
  setCode: string | null
  collectorNumber: string | null
  zone: DeckZone | null
  // Portés par un export CSV seulement ; absents (ou `null`), l'import écrit
  // les défauts choisis dans la feuille d'import.
  finish?: Finish | null
  condition?: Condition | null
  language?: string | null
}

export interface ParseResult {
  lines: ParsedLine[]
  ignored: string[]
}

// `\d{1,4}` : une quantité de liste tient sur quatre chiffres, et borner ici
// évite qu'un numéro de collection isolé en tête de ligne passe pour une
// quantité astronomique. `[xX]?` couvre `4x` ; le `\s+` qui suit interdit
// `4xLightning` (aucun des quatre formats ne l'écrit).
const CARD_LINE = /^(\d{1,4})\s*[xX]?\s+(.+)$/

// Suffixe d'impression : `(SET)` seul ou `(SET) NUMÉRO`. Le nom est capturé
// paresseusement pour que seul le **dernier** groupe entre parenthèses de la
// ligne soit lu comme un code de set. Aucun nom de carte du catalogue ne se
// termine par une parenthèse, ce suffixe est donc sans ambiguïté.
const SET_SUFFIX = /^(.+?)\s+\(([^()\s]{2,8})\)(?:\s+([^\s()]{1,12}))?$/

// En-têtes de section (lignes `Deck`, `Sideboard`, `Commander`, ignorées
// ou utilisées comme zone). Les
// synonymes courants des exports (`Maindeck`, `Mainboard`, `Side`) sont
// rattachés à la même zone : ce sont les mêmes trois zones du modèle
// (`DeckZone`), pas une quatrième inventée.
const SECTION_ZONES: Record<string, DeckZone> = {
  deck: 'main',
  main: 'main',
  maindeck: 'main',
  mainboard: 'main',
  sideboard: 'side',
  side: 'side',
  commander: 'commander',
  commanders: 'commander',
}

// `Sideboard`, `Sideboard:`, `// Sideboard`, `Sideboard (15)` désignent la
// même section : le décor est retiré avant la comparaison, jamais listé
// comme autant de clés dans `SECTION_ZONES`.
function sectionZone(line: string): DeckZone | null {
  const stripped = line
    .replace(/^\/\/\s*/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase()
  return SECTION_ZONES[stripped] ?? null
}

export function parseList(text: string): ParseResult {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  if (looksLikeCsvHeader(firstLine)) return parseCsv(text)

  const lines: ParsedLine[] = []
  const ignored: string[] = []
  // `null` tant qu'aucun en-tête n'a été rencontré (`zone: DeckZone |
  // null`) — une liste sans section n'invente pas
  // `main`, c'est l'écriture qui décidera de la zone par défaut.
  let zone: DeckZone | null = null

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    // Ligne vide : ni carte, ni ignorée listée — une chaîne vide dans
    // `ignored` ne dirait rien à l'utilisateur.
    if (trimmed.length === 0) continue

    const section = sectionZone(trimmed)
    if (section) {
      zone = section
      continue
    }

    const match = CARD_LINE.exec(trimmed)
    if (!match) {
      ignored.push(trimmed)
      continue
    }

    const qty = Number.parseInt(match[1]!, 10)
    const rest = match[2]!.trim()
    const suffix = SET_SUFFIX.exec(rest)

    lines.push({
      raw,
      qty,
      name: suffix ? suffix[1]!.trim() : rest,
      // Replié en minuscules, la forme du catalogue (`cards.set_code` —
      // le fichier bulk livre `2x2`, jamais `2X2`) : la résolution compare
      // directement, sans second repliement à un endroit qu'on oublierait.
      setCode: suffix ? suffix[2]!.toLowerCase() : null,
      collectorNumber: suffix?.[3] ? suffix[3].trim() : null,
      zone,
    })
  }

  return { lines, ignored }
}
