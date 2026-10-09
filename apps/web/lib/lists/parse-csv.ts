// Analyseur des exports CSV de collection (ManaBox, Moxfield, Deckbox, Delver
// Lens…). Pur, comme `parse-list.ts` qui l'appelle : il ne fait que traduire
// chaque ligne en `ParsedLine`, la résolution reste celle de
// `resolve-list.ts`.
//
// Les colonnes sont reconnues par leur en-tête, jamais par leur position :
// chaque application les ordonne à sa façon et en ajoute au fil des versions
// (ManaBox a inséré `Binder Type` en deuxième colonne).
import type { Condition, Finish } from '@spellcache/db/schema'

import type { ParsedLine, ParseResult } from './parse-list'

type Column = 'name' | 'qty' | 'set' | 'number' | 'foil' | 'condition' | 'language'

// En-têtes connus, comparés en minuscules et sans espaces de bord.
const HEADER_ALIASES: Record<Column, string[]> = {
  name: ['name', 'card name', 'card'],
  qty: ['quantity', 'count', 'qty', 'amount'],
  set: ['set code', 'set', 'edition code', 'edition'],
  number: ['collector number', 'card number', 'collector #', 'number', 'cn'],
  foil: ['foil', 'finish', 'printing'],
  condition: ['condition'],
  language: ['language', 'lang'],
}

// Un CSV se reconnaît à son en-tête : au moins un nom et une quantité.
export function looksLikeCsvHeader(line: string): boolean {
  const columns = mapColumns(splitRecords(line)[0] ?? [])
  return columns.name !== undefined && columns.qty !== undefined
}

function mapColumns(header: string[]): Partial<Record<Column, number>> {
  const normalized = header.map((cell) => cell.trim().toLowerCase())
  const columns: Partial<Record<Column, number>> = {}
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
    // Premier alias trouvé, dans l'ordre de la liste : `Set code` passe avant
    // `Set`, qui chez certains exports porte le nom complet du set.
    for (const alias of aliases) {
      const index = normalized.indexOf(alias)
      if (index !== -1) {
        columns[column] = index
        break
      }
    }
  }
  return columns
}

// RFC 4180 : champs entre guillemets (virgules et retours à la ligne
// compris), guillemet doublé pour un guillemet littéral. Un nom de set comme
// « Innistrad: Midnight Hunt, Promos » arrive entre guillemets.
function splitRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += char
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

// Un code de set tient en quelques caractères sans espace (`mic`, `plst`,
// `pmei`) : une colonne `Edition` qui porte le nom complet (Deckbox) est
// ignorée plutôt que prise pour un code.
function setCodeOf(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  return /^[a-z0-9]{2,6}$/.test(trimmed) ? trimmed : null
}

function finishOf(value: string): Finish | null {
  const v = value.trim().toLowerCase()
  if (v === '') return null
  if (v.includes('etched')) return 'etched'
  if (v === 'foil' || v === 'true' || v === 'yes' || v === '1') return 'foil'
  if (v === 'normal' || v === 'nonfoil' || v === 'non-foil' || v === 'false' || v === 'no' || v === '0') {
    return 'nonfoil'
  }
  return null
}

// États des différentes applications : `near_mint` (ManaBox), `NM`
// (Moxfield), `Near Mint`, `Good (Lightly Played)` (Deckbox)… ramenés aux
// cinq de l'app. Inconnu : `null`, le réglage de la feuille s'applique.
function conditionOf(value: string): Condition | null {
  const v = value.trim().toLowerCase().replace(/[_-]/g, ' ')
  if (v === '') return null
  if (v === 'nm' || v.includes('near mint') || v === 'mint' || v === 'm') return 'nm'
  if (v === 'lp' || v.includes('light') || v.includes('excellent') || v === 'ex') return 'lp'
  if (v === 'mp' || v.includes('moderate') || v === 'played' || v === 'good' || v === 'gd') return 'mp'
  if (v === 'hp' || v.includes('heav')) return 'hp'
  if (v === 'dmg' || v.includes('damage') || v === 'poor') return 'dmg'
  return null
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en',
  french: 'fr',
  german: 'de',
  italian: 'it',
  spanish: 'es',
  portuguese: 'pt',
  japanese: 'ja',
  korean: 'ko',
  russian: 'ru',
  'chinese simplified': 'zhs',
  'simplified chinese': 'zhs',
  'chinese traditional': 'zht',
  'traditional chinese': 'zht',
}

// Codes Scryfall (`en`, `fr`, `zhs`…) tels quels, noms anglais traduits.
function languageOf(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (v === '') return null
  if (/^[a-z]{2,3}$/.test(v)) return v
  return LANGUAGE_NAMES[v] ?? null
}

export function parseCsv(text: string): ParseResult {
  const records = splitRecords(text)
  const header = records.shift() ?? []
  const columns = mapColumns(header)
  const lines: ParsedLine[] = []
  const ignored: string[] = []

  const cell = (record: string[], column: Column): string => {
    const index = columns[column]
    return index === undefined ? '' : (record[index] ?? '')
  }

  for (const record of records) {
    // Ligne vide (fin de fichier) : ni carte, ni ignorée.
    if (record.every((value) => value.trim() === '')) continue
    const raw = record.join(',')
    const name = cell(record, 'name').trim()
    const qty = Number.parseInt(cell(record, 'qty').trim(), 10)
    if (name === '' || !Number.isFinite(qty) || qty < 1) {
      ignored.push(raw)
      continue
    }
    lines.push({
      raw,
      qty,
      name,
      setCode: setCodeOf(cell(record, 'set')),
      collectorNumber: cell(record, 'number').trim() || null,
      zone: null,
      finish: finishOf(cell(record, 'foil')),
      condition: conditionOf(cell(record, 'condition')),
      language: languageOf(cell(record, 'language')),
    })
  }

  return { lines, ignored }
}
