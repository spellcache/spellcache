// Résolution d'une liste analysée contre le **catalogue local**. Aucun appel
// sortant : résoudre un nom absent du catalogue via l'API externe pendant
// l'import est interdit pendant une requête utilisateur, et c'est
// mécaniquement vérifiable — la résolution n'interroge que Postgres.
//
// Deux requêtes au maximum, quel que soit le nombre de lignes (un import de
// 300 lignes doit résoudre en une requête par lot, pas une par ligne) :
//   1. une correspondance exacte sur le nom normalisé, pour toutes les
//      lignes d'un coup (`= any($keys)`) ;
//   2. un repli trigramme, uniquement s'il reste des noms sans
//      correspondance, pour proposer des candidats à corriger.
import { sql } from 'drizzle-orm'

import { cards } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import type { Currency } from '@/lib/format/money'
import { textArray } from '@spellcache/db/array-param'

import { frontFaceExpr, frontFaceOf, normalizeCardName, normalizedNameExpr } from './normalize-name'
import type { ParsedLine } from './parse-list'

export interface ResolvedCandidate {
  cardId: string
  setCode: string
  collectorNumber: string
  priceMinor: number | null
}

export interface ResolvedLine extends ParsedLine {
  status: 'resolved' | 'ambiguous' | 'unknown'
  cardId: string | null
  candidates?: ResolvedCandidate[]
}

export interface ResolveSummary {
  resolved: number
  ambiguous: number
  unknown: number
}

export interface ResolveListOptions {
  // La devise vient de `users.price_source` (docs/development.md : unique source de
  // vérité) et n'est utilisée que pour classer les impressions par prix —
  // aucune conversion, aucun second réglage. Optionnelle pour que
  // `resolveList(lines)` reste l'appel de base ; le défaut reprend celui de
  // la colonne `users.price_source` (`cardmarket_eur`), jamais une locale de
  // navigateur.
  currency?: Currency
}

// Plafond de candidats remontés par ligne ambiguë. `Lightning Bolt` compte
// une quarantaine d'impressions : les remonter toutes gonflerait la charge
// utile de l'aperçu pour un import de 300 lignes sans rien apporter, la
// liste étant déjà triée par prix croissant (le défaut — l'impression la
// moins chère du catalogue — reste donc toujours en tête).
const MAX_CANDIDATES = 20

// Nombre de propositions du repli trigramme pour un nom inconnu (le choix
// « corriger »).
const MAX_SUGGESTIONS = 5

interface CatalogRow extends Record<string, unknown> {
  card_id: string
  set_code: string
  collector_number: string
  norm: string
  front: string
  price_minor: string | number | null
}

interface SuggestionRow extends Record<string, unknown> {
  query_name: string
  card_id: string
  set_code: string
  collector_number: string
  price_minor: string | number | null
}

function toMinor(raw: string | number | null): number | null {
  return raw === null ? null : Number(raw)
}

function toCandidate(row: CatalogRow | SuggestionRow): ResolvedCandidate {
  return {
    cardId: row.card_id,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    priceMinor: toMinor(row.price_minor),
  }
}

// Prix unitaire courant en unité majeure, dernier jour connu pour cette
// carte — même forme de jointure latérale que
// `app/(app)/container/[id]/holdings-data.ts`. Toujours la colonne
// non-foil : une ligne de liste texte ne porte aucune finition, l'import
// écrit donc `nonfoil` (voir `sharing-actions.ts`).
function priceExpr(currency: Currency) {
  return currency === 'usd' ? sql`p.usd` : sql`p.eur`
}

export async function resolveList(
  lines: ParsedLine[],
  options: ResolveListOptions = {},
): Promise<{ lines: ResolvedLine[]; summary: ResolveSummary }> {
  const currency = options.currency ?? 'eur'

  if (lines.length === 0) {
    return { lines: [], summary: { resolved: 0, ambiguous: 0, unknown: 0 } }
  }

  const keyed = lines.map((line) => {
    const key = normalizeCardName(line.name)
    return { line, key, frontKey: frontFaceOf(key) }
  })

  const keys = [...new Set(keyed.flatMap((entry) => [entry.key, entry.frontKey]))]

  const normExpr = normalizedNameExpr(cards.name)
  // `t` matérialise le nom normalisé une fois par ligne de catalogue ; la
  // face avant s'en déduit dans la même sous-requête. Un seul parcours de
  // `cards` sert toutes les lignes collées — pas une requête par ligne.
  const { rows: catalogRows } = await db.execute<CatalogRow>(sql`
    select
      t.id as card_id,
      t.set_code,
      t.collector_number,
      t.norm,
      t.front,
      round(${priceExpr(currency)} * 100) as price_minor
    from (
      select
        ${cards.id} as id,
        ${cards.setCode} as set_code,
        ${cards.collectorNumber} as collector_number,
        ${normExpr} as norm,
        ${frontFaceExpr(normExpr)} as front
      from cards
    ) as t
    left join lateral (
      select usd, eur from card_prices
      where card_prices.card_id = t.id
      order by day desc
      limit 1
    ) as p on true
    where t.norm = any(${textArray(keys)}) or t.front = any(${textArray(keys)})
    order by price_minor asc nulls last, t.set_code asc, t.collector_number asc
  `)

  // Deux index sur le même jeu de lignes : correspondance sur le nom complet
  // d'abord (une impression dont le nom entier correspond l'emporte sur une
  // simple correspondance de face avant), repli sur la face avant ensuite.
  const byFullName = new Map<string, CatalogRow[]>()
  const byFrontFace = new Map<string, CatalogRow[]>()
  for (const row of catalogRows) {
    const full = byFullName.get(row.norm)
    if (full) full.push(row)
    else byFullName.set(row.norm, [row])

    const front = byFrontFace.get(row.front)
    if (front) front.push(row)
    else byFrontFace.set(row.front, [row])
  }

  function matchesFor(key: string, frontKey: string): CatalogRow[] {
    const exact = byFullName.get(key)
    if (exact && exact.length > 0) return exact

    const seen = new Set<string>()
    const merged: CatalogRow[] = []
    for (const bucket of [byFrontFace.get(key), byFullName.get(frontKey), byFrontFace.get(frontKey)]) {
      for (const row of bucket ?? []) {
        if (seen.has(row.card_id)) continue
        seen.add(row.card_id)
        merged.push(row)
      }
    }
    return merged
  }

  const resolved: ResolvedLine[] = []
  const unknownNames: string[] = []

  for (const { line, key, frontKey } of keyed) {
    const matches = matchesFor(key, frontKey)

    if (matches.length === 0) {
      unknownNames.push(line.name)
      resolved.push({ ...line, status: 'unknown', cardId: null })
      continue
    }

    // Indication d'impression donnée par la ligne collée. Si elle ne désigne
    // rien au catalogue (set inconnu, numéro d'une autre édition), elle est
    // abandonnée au profit du nom seul plutôt que de rendre la ligne
    // inconnue : c'est le nom qui identifie la carte, le set n'était qu'une
    // précision.
    let pool = matches
    if (line.setCode) {
      const narrowed = matches.filter(
        (row) =>
          row.set_code.toLowerCase() === line.setCode &&
          (line.collectorNumber === null || row.collector_number === line.collectorNumber),
      )
      if (narrowed.length > 0) pool = narrowed
    }

    if (pool.length === 1) {
      resolved.push({ ...line, status: 'resolved', cardId: pool[0]!.card_id })
      continue
    }

    resolved.push({
      ...line,
      status: 'ambiguous',
      // `null` tant que l'utilisateur n'a pas choisi l'impression de cette
      // ligne ambiguë. Le défaut appliqué à l'écriture est `candidates[0]`,
      // déjà l'impression la moins chère grâce à l'`order by` ci-dessus.
      cardId: null,
      candidates: pool.slice(0, MAX_CANDIDATES).map(toCandidate),
    })
  }

  if (unknownNames.length > 0) {
    const suggestions = await suggestByTrigram([...new Set(unknownNames)], currency)
    for (const line of resolved) {
      if (line.status !== 'unknown') continue
      const proposed = suggestions.get(line.name)
      if (proposed && proposed.length > 0) line.candidates = proposed
    }
  }

  const summary: ResolveSummary = {
    resolved: resolved.filter((line) => line.status === 'resolved').length,
    ambiguous: resolved.filter((line) => line.status === 'ambiguous').length,
    unknown: resolved.filter((line) => line.status === 'unknown').length,
  }

  return { lines: resolved, summary }
}

// Repli trigramme pour proposer des candidats. Une seule requête pour tous les
// noms inconnus : `unnest` les déplie en lignes, la jointure latérale rapporte
// les meilleurs voisins de chacun. `%` s'appuie sur `cards_name_trgm_idx` —
// l'index existe, c'est la même opération que la recherche floue.
async function suggestByTrigram(
  names: string[],
  currency: Currency,
): Promise<Map<string, ResolvedCandidate[]>> {
  const { rows } = await db.execute<SuggestionRow>(sql`
    select
      q.name as query_name,
      m.card_id,
      m.set_code,
      m.collector_number,
      m.price_minor
    from unnest(${textArray(names)}) as q(name)
    join lateral (
      select
        c.id as card_id,
        c.set_code,
        c.collector_number,
        round(${priceExpr(currency)} * 100) as price_minor,
        similarity(c.name, q.name) as score
      from cards c
      left join lateral (
        select usd, eur from card_prices
        where card_prices.card_id = c.id
        order by day desc
        limit 1
      ) as p on true
      where c.name % q.name
      order by score desc, c.name asc
      limit ${MAX_SUGGESTIONS}
    ) as m on true
  `)

  const byName = new Map<string, ResolvedCandidate[]>()
  for (const row of rows) {
    const bucket = byName.get(row.query_name)
    if (bucket) bucket.push(toCandidate(row))
    else byName.set(row.query_name, [toCandidate(row)])
  }
  return byName
}
