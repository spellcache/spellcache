'use server'

// Point d'entrée serveur de l'onglet Search. Toute entrée externe
// est validée par Zod à la frontière avant d'atteindre `searchCards()`
// (docs/development.md, « Toute entrée externe… ») — une entrée malformée rejette avec
// la `ZodError` de `.parse()`.
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireSession, type SessionUser } from '@/lib/auth-guards'
import { db } from '@spellcache/db'
import { currencyOf } from '@/lib/price-source'
import { getPreferences } from '@/lib/preferences'

import { InvalidCursorError } from '@/lib/search/cursor'
import {
  getPrintingsByName,
  searchCards,
  type CardSearchResult,
  type PrintingItem,
} from '@/lib/search/search-cards'

const cardSearchFiltersSchema = z.object({
  colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G', 'C'])).optional(),
  colorMatch: z.enum(['including', 'exactly', 'atMost']).optional(),
  colorSpread: z.enum(['multi', 'mono']).nullable().optional(),
  types: z.array(z.string()).optional(),
  rarities: z.array(z.enum(['common', 'uncommon', 'rare', 'mythic'])).optional(),
  setCode: z.string().optional(),
  priceMin: z.number().nullable().optional(),
  priceMax: z.number().nullable().optional(),
  foilOnly: z.boolean().optional(),
  // Familles « Set · Type » à montrer (`lib/search/set-type-groups.ts`) —
  // omis = défaut Release + Tokens, tableau vide = tout montrer.
  setTypes: z
    .array(z.enum(['release', 'promos', 'art_series', 'tokens', 'others']))
    .optional(),
})

const cardSearchParamsSchema = z.object({
  query: z.string(),
  filters: cardSearchFiltersSchema.optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
  // Régime de tri/dédoublonnage (`lib/search/search-cards.ts`) : `'set'`
  // seulement depuis l'écran `SetDetail` — tout le reste de
  // l'app (onglet `Search`, feuille `Add a card`) reste au défaut `'search'`
  // sans avoir à le préciser.
  scope: z.enum(['search', 'set']).optional(),
})

// Une Server Action qui `throw` produit, côté client, une erreur opaque
// (digest / 500 générique) — exactement ce que le critère #5 interdit pour
// un curseur invalide. Un curseur malformé est une entrée attendue (l'usager
// est revenu sur un lien de pagination périmé), pas un bug : contrairement à
// l'entrée malformée (qui reste une `ZodError` rejetée, conforme au
// contrat), ce cas résout normalement avec une réponse distincte et
// typée plutôt que de rejeter la promesse.
export interface InvalidCursorResponse {
  error: 'invalid_cursor'
  message: string
}

// Liste des sets du catalogue, pour l'onglet `Sets` de la recherche et le
// sélecteur de set de la feuille de filtres. Le catalogue est un miroir local
// (docs/development.md) : aucune requête Scryfall ici, juste la table alimentée par le
// bulk. Triée du plus récent au plus ancien — c'est dans cet ordre qu'on
// cherche un set.
export interface SetSummary {
  code: string
  name: string
  releasedAt: string | null
  iconSvgUri: string | null
  cardCount: number
  // `set_type` Scryfall (`token`, `expansion`…) — NULL avant le premier
  // import qui suit la migration 0017. Porte le filtre « Ignore Tokens and
  // Art Series » de l'onglet Sets (demande produit).
  setType: string | null
}

export async function listSetsAction(): Promise<SetSummary[]> {
  await requireSession()
  // `cardCount` compte les impressions **réellement présentes dans notre
  // catalogue**, pas la taille imprimée du set que porte `sets.card_count`.
  // Les deux divergent dès que le miroir local est partiel — et un set dont
  // l'écran liste 18 cartes ne doit pas s'annoncer à 0 (ni à 350). C'est le
  // nombre que l'écran du set affichera de toute façon.
  const { rows } = await db.execute<{
    code: string
    name: string
    releasedAt: string | null
    iconSvgUri: string | null
    cardCount: number
    setType: string | null
  }>(sql`
    select
      s.code,
      s.name,
      s.released_at as "releasedAt",
      s.icon_svg_uri as "iconSvgUri",
      s.set_type as "setType",
      coalesce(c.n, 0)::int as "cardCount"
    from sets s
    left join (
      select set_code, count(*)::int as n from cards group by set_code
    ) c on c.set_code = s.code
    order by s.released_at desc nulls last, s.name asc
  `)
  return rows
}

// Devise du compte, jamais un choix client (docs/development.md, `price_source`
// unique) : résolue une seule fois ici, partagée par `searchCatalogAction`
// et `printingsAction` plutôt que devinée dans `lib/search/search-cards.ts`.
async function resolveCurrency(user: SessionUser): Promise<'usd' | 'eur'> {
  const preferences = await getPreferences(user.id)
  return currencyOf(preferences)
}

export async function searchCatalogAction(
  input: unknown,
): Promise<CardSearchResult | InvalidCursorResponse> {
  const params = cardSearchParamsSchema.parse(input)
  const user = await requireSession()
  const currency = await resolveCurrency(user)

  try {
    return await searchCards({ ...params, currency })
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return { error: 'invalid_cursor', message: error.message }
    }
    throw error
  }
}

// Impressions d'un même nom de carte (feuille `Add a card`, étape « Choose
// a printing of X »). `name` vient toujours d'un
// résultat de recherche déjà résolu (jamais une saisie libre) : une simple
// borne de longueur suffit à la frontière (docs/development.md), pas de schéma plus
// riche à faire respecter.
const printingsParamsSchema = z.object({ name: z.string().trim().min(1).max(300) })

export interface PrintingsResult {
  items: PrintingItem[]
  // Portée avec les impressions plutôt que redemandée à part (même raison
  // que `CardSearchResult.currency`).
  currency: 'usd' | 'eur'
}

export async function printingsAction(input: unknown): Promise<PrintingsResult> {
  const { name } = printingsParamsSchema.parse(input)
  const user = await requireSession()
  const currency = await resolveCurrency(user)
  const items = await getPrintingsByName(name, currency)
  return { items, currency }
}
