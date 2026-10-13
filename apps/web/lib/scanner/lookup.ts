// Carte du catalogue local correspondant à un texte reconnu par le scanner
// Android. Seul ce texte arrive au serveur, jamais l'image (le scanner lit
// la carte sur le téléphone).
//
// Deux lectures, dans cet ordre :
//   1. code de set + numéro de collection imprimés en bas à gauche des cartes
//      récentes : l'impression exacte (index `cards_set_collector_number_idx`) ;
//   2. à défaut, le nom (ligne du haut) : une impression de cette carte, de
//      préférence dans le set lu, que l'écran de revue propose de corriger.
//
// Avec un filtre de sets (réglages du scanner, `lookupScannedCardIn`), seules
// les cartes de ces sets sont rendues, et une lecture douteuse (code de set
// mal lu, nom seul) est cherchée parmi elles.
import { sql } from 'drizzle-orm'

import { cards } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { textArray } from '@spellcache/db/array-param'
import { frontFaceExpr, frontFaceOf, normalizeCardName, normalizedNameExpr } from '@/lib/lists/normalize-name'
import { TOKEN_CARD_LAYOUTS } from '@/lib/search/set-type-groups'

import { cleanScannedName, collectorNumberVariants, setCodeVariants } from './scan-text'

export interface ScanQuery {
  setCode?: string | null
  collectorNumber?: string | null
  // Lignes candidates au nom, de haut en bas : la reconnaissance ne sait pas
  // laquelle est le nom (titre, ligne de type, texte).
  names?: string[]
  // Rareté `T` lue : un jeton, rangé par Scryfall dans le set de jetons du
  // set imprimé (`MKM` → `tmkm`).
  token?: boolean
}

// Codes de set à chercher pour une lecture : ceux des jetons pour un jeton.
function setCodesOf(query: ScanQuery): string[] {
  const codes = query.setCode ? setCodeVariants(query.setCode) : []
  return query.token ? codes.map((code) => `t${code}`) : codes
}

export interface ScanMatch {
  cardId: string
  name: string
  setCode: string
  setName: string
  collectorNumber: string
  // Icône du set (`sets.icon_svg_uri`), affichée par le scanner à côté du
  // code ; `null` si le catalogue n'en a pas.
  setIconUri: string | null
  // Finitions de l'impression : le scanner ne propose foil que si elle existe.
  finishes: string[]
  // `false` : trouvée par son nom, l'impression reste à confirmer.
  exact: boolean
}

export interface ScanLookup {
  match: ScanMatch | null
  // Aucune carte des sets choisis, mais une carte d'un autre set : le
  // scanner le dit plutôt que « aucune carte ».
  outsideSets: boolean
}

export interface MatchRow extends Record<string, unknown> {
  id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string
  set_icon_uri: string | null
  finishes: string[]
}

export function toMatch(row: MatchRow, exact: boolean): ScanMatch {
  return {
    cardId: row.id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    setIconUri: row.set_icon_uri,
    finishes: row.finishes,
    exact,
  }
}

async function findPrinting(setCodes: string[], numbers: string[]): Promise<ScanMatch | null> {
  // La lecture telle quelle passe avant ses variantes (`array_position`).
  const { rows } = await db.execute<MatchRow>(sql`
    select ${cards.id} as id, ${cards.name} as name, ${cards.setCode} as set_code,
      ${cards.collectorNumber} as collector_number, sets.name as set_name, sets.icon_svg_uri as set_icon_uri, ${cards.finishes} as finishes
    from ${cards}
    join sets on sets.code = ${cards.setCode}
    where ${cards.setCode} = any(${textArray(setCodes)})
      and ${cards.collectorNumber} = any(${textArray(numbers)})
    order by array_position(${textArray(setCodes)}, ${cards.setCode}),
      array_position(${textArray(numbers)}, ${cards.collectorNumber})
    limit 1
  `)
  return rows[0] ? toMatch(rows[0], true) : null
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// Égalité sur le nom normalisé (`lib/lists/normalize-name.ts`), comme
// l'import de listes : une ligne de texte de règles ne doit jamais passer
// pour un nom. Le filtre trigramme ne sert qu'à atteindre l'index
// `cards_name_trgm_idx` avant la normalisation, ligne par ligne.
// `onlySets` (sets choisis) ou `numbers` (numéro lu sans code de set) :
// recherche restreinte, l'impression est alors exacte quand elle y est la
// seule de ce nom.
async function findByName(
  name: string,
  setCodes: string[],
  { onlySets, numbers }: { onlySets?: string[]; numbers?: string[] } = {},
): Promise<ScanMatch | null> {
  const key = normalizeCardName(name)
  const frontKey = frontFaceOf(key)
  const norm = normalizedNameExpr(cards.name)
  const { rows } = await db.execute<MatchRow & { printings: string | number }>(sql`
    select ${cards.id} as id, ${cards.name} as name, ${cards.setCode} as set_code,
      ${cards.collectorNumber} as collector_number, sets.name as set_name, sets.icon_svg_uri as set_icon_uri, ${cards.finishes} as finishes,
      count(*) over () as printings
    from ${cards}
    join sets on sets.code = ${cards.setCode}
    where (${cards.name} % ${name} or ${cards.name} ilike ${`${escapeLike(name)} // %`})
      and (${norm} = ${key} or ${frontFaceExpr(norm)} = ${frontKey})
      ${onlySets ? sql`and ${cards.setCode} = any(${textArray(onlySets)})` : sql``}
      ${numbers ? sql`and ${cards.collectorNumber} = any(${textArray(numbers)})` : sql``}
    order by
      ${cards.setCode} = any(${textArray(setCodes)}) desc,
      coalesce(${cards.layout}, '') = any(${textArray([...TOKEN_CARD_LAYOUTS, 'art_series'])}) asc,
      sets.released_at desc nulls last,
      ${cards.collectorNumber} asc
    limit 1
  `)
  const row = rows[0]
  if (!row) return null
  return toMatch(row, (onlySets !== undefined || numbers !== undefined) && Number(row.printings) === 1)
}

// Numéro lu dans les sets choisis, quand le code de set ne l'est pas.
async function findNumberIn(onlySets: string[], numbers: string[]): Promise<MatchRow[]> {
  const { rows } = await db.execute<MatchRow>(sql`
    select ${cards.id} as id, ${cards.name} as name, ${cards.setCode} as set_code,
      ${cards.collectorNumber} as collector_number, sets.name as set_name, sets.icon_svg_uri as set_icon_uri, ${cards.finishes} as finishes
    from ${cards}
    join sets on sets.code = ${cards.setCode}
    where ${cards.setCode} = any(${textArray(onlySets)})
      and ${cards.collectorNumber} = any(${textArray(numbers)})
    limit 20
  `)
  return rows
}

function cleanedNames(query: ScanQuery): string[] {
  return (query.names ?? [])
    .slice(0, MAX_SCANNED_NAMES)
    .map(cleanScannedName)
    .filter((name) => name.length >= MIN_NAME_LENGTH)
}

// Impression lue par son set et son numéro, contre le nom lu : un chiffre
// manqué (`0118` lu `O18`) désigne une autre carte du même set. Le nom lu y
// désigne alors la bonne ; introuvable (carte non anglaise, nom mal lu),
// l'impression du numéro reste.
async function checkedByName(printing: ScanMatch, names: string[], setCodes: string[]): Promise<ScanMatch> {
  if (names.length === 0 || names.some((name) => sameName(printing.name, name))) return printing
  for (const name of names) {
    const match = await findByName(name, setCodes, { onlySets: setCodes })
    if (match) return match
  }
  return printing
}

// Au plus trois lignes de nom par lecture : au-delà, c'est du texte de règles.
export const MAX_SCANNED_NAMES = 3
const MIN_NAME_LENGTH = 3

export async function lookupScannedCard(query: ScanQuery): Promise<ScanMatch | null> {
  const setCodes = setCodesOf(query)
  const numbers = query.collectorNumber ? collectorNumberVariants(query.collectorNumber) : []
  const names = cleanedNames(query)

  if (setCodes.length > 0 && numbers.length > 0) {
    const printing = await findPrinting(setCodes, numbers)
    if (printing) return checkedByName(printing, names, setCodes)
  }

  // Numéro sans code de set lisible (cartes de 2008 à 2014, `51/264`) : le
  // nom et le numéro désignent en général une seule impression.
  if (numbers.length > 0) {
    for (const name of names) {
      const match = await findByName(name, setCodes, { numbers })
      if (match) return match
    }
  }

  for (const name of names) {
    const match = await findByName(name, setCodes)
    if (match) return match
  }
  return null
}

function sameName(cardName: string, read: string): boolean {
  const key = normalizeCardName(read)
  const card = normalizeCardName(cardName)
  return card === key || frontFaceOf(card) === key
}

// Impression exacte dont le nom est aussi lu sur la carte : deux lectures
// indépendantes (bas de carte et titre) concordent, le scanner compte dès
// la première image au lieu d'attendre la suivante.
export function confirmedByName(match: ScanMatch, names: string[]): boolean {
  return match.exact && cleanedNames({ names }).some((name) => sameName(match.name, name))
}

// Lecture restreinte aux sets choisis (`onlySets`, codes en minuscules) ;
// sans filtre, `lookupScannedCard`.
export async function lookupScannedCardIn(query: ScanQuery, onlySets: string[]): Promise<ScanLookup> {
  if (onlySets.length === 0) return { match: await lookupScannedCard(query), outsideSets: false }

  const setCodes = setCodesOf(query)
  const numbers = query.collectorNumber ? collectorNumberVariants(query.collectorNumber) : []
  const names = cleanedNames(query)

  // 1. Set lu parmi les sets choisis, et son numéro.
  const allowed = setCodes.filter((code) => onlySets.includes(code))
  if (allowed.length > 0 && numbers.length > 0) {
    const printing = await findPrinting(allowed, numbers)
    if (printing) return { match: await checkedByName(printing, names, allowed), outsideSets: false }
  }

  // 2. Code de set douteux : le numéro dans les sets choisis, confirmé par
  //    le nom lu ; seul candidat sans nom lisible, à vérifier.
  if (numbers.length > 0) {
    const candidates = await findNumberIn(onlySets, numbers)
    const named = candidates.find((row) => names.some((name) => sameName(row.name, name)))
    if (named) return { match: toMatch(named, true), outsideSets: false }
    if (candidates.length === 1 && names.length === 0) {
      return { match: toMatch(candidates[0]!, false), outsideSets: false }
    }
  }

  // 3. Le nom, dans les sets choisis.
  for (const name of names) {
    const match = await findByName(name, setCodes, { onlySets })
    if (match) return { match, outsideSets: false }
  }

  return { match: null, outsideSets: (await lookupScannedCard(query)) !== null }
}

// Impressions d'une même carte (même `oracle_id`), de la plus récente à la
// plus ancienne : le choix d'édition du scanner. Sans les Art Series.
export async function listPrintingsOf(cardId: string): Promise<ScanMatch[]> {
  const { rows } = await db.execute<MatchRow>(sql`
    select ${cards.id} as id, ${cards.name} as name, ${cards.setCode} as set_code,
      ${cards.collectorNumber} as collector_number, sets.name as set_name,
      sets.icon_svg_uri as set_icon_uri, ${cards.finishes} as finishes
    from ${cards}
    join sets on sets.code = ${cards.setCode}
    where ${cards.oracleId} = (select oracle_id from cards where id = ${cardId}::uuid)
      and coalesce(${cards.layout}, '') <> 'art_series'
    order by sets.released_at desc nulls last, ${cards.setCode}, ${cards.collectorNumber}
    limit 100
  `)
  return rows.map((row) => toMatch(row, true))
}
