// Requête de recherche du catalogue : combine le rang plein texte
// (`ts_rank_cd` sur `search_vector`, index GIN) et la similarité
// trigramme sur `name` (tolérance aux fautes de frappe, index GIN
// `cards_name_trgm_idx` — voir packages/db/src/schema.ts), pagine par curseur
// opaque, et met en cache la réponse par requête normalisée (`lib/redis.ts`).
//
// Deux régimes de tri :
//   - `scope: 'search'` (défaut, onglet `Search › Cards`, feuille `Add a
//     card`) : équivalent de `unique=cards, order=name` chez Scryfall — un
//     seul résultat par nom (`DISTINCT ON (card_name)`, impression
//     représentative la plus récente), reclassé ensuite par pertinence
//     (rang plein texte + trigramme). Choisir le set dans la feuille de
//     filtres de cet onglet ne bascule pas de régime : ça reste une
//     recherche par nom, restreinte à un set.
//   - `scope: 'set'` (écran `SetDetail`, atteint depuis `Search › Sets`) :
//     équivalent de `unique=prints, order=set` — chaque impression du set,
//     triée par numéro de collectionneur en ordre **naturel** (`12` avant
//     `112`), jamais alphabétique.
import { sql, type SQL } from 'drizzle-orm'
import { RELEASE_SET_TYPES, SET_TYPE_GROUPS, type SetTypeGroup } from '@/lib/search/set-type-groups'

import { db } from '@spellcache/db'
import { largeUrl, thumbUrl } from '@spellcache/core/images'
import { cacheGet, cacheSet } from '@/lib/redis'
import type { ScryfallImageUris } from '@spellcache/core/scryfall/schemas'
import { textArray } from '@spellcache/db/array-param'

import { decodeCursor, encodeCursor, type SearchCursor } from './cursor'
import { normalizeSearchParams, searchCacheKey, type NormalizedSearchFilters, type NormalizedSearchParams } from './normalize'

export interface CardSearchFilters {
  colors?: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>
  colorMatch?: 'including' | 'exactly' | 'atMost'
  // Spectre de couleur : `'multi'` (au moins deux couleurs d'identité),
  // `'mono'` (exactement une) — orthogonal aux pips choisis, jamais une
  // contradiction (« every two-colour card » ne désigne aucune paire de pips
  // en particulier).
  colorSpread?: 'multi' | 'mono' | null
  types?: string[]
  rarities?: Array<'common' | 'uncommon' | 'rare' | 'mythic'>
  setCode?: string
  // Fourchette de prix de l'impression, dans la devise du compte — le prix
  // du marché, pas la valeur d'un exemplaire possédé (la recherche ne
  // connaît aucun exemplaire).
  priceMin?: number | null
  priceMax?: number | null
  // Impressions disponibles en foil seulement.
  foilOnly?: boolean
  // Familles « Set · Type » à MONTRER (demande produit) — voir
  // `lib/search/set-type-groups.ts`. `undefined` = la sélection par défaut
  // (Release + Tokens) ; tableau vide = tout montrer (aucune condition),
  // même sémantique que les puces de type de carte.
  setTypes?: SetTypeGroup[]
}

export interface CardSearchParams {
  query: string
  filters?: CardSearchFilters
  limit?: number
  cursor?: string | null
  // Régime de tri/dédoublonnage — voir le commentaire de tête. Toujours
  // `'search'` sauf l'écran `SetDetail`.
  scope?: 'search' | 'set'
  // Devise du compte (`price_source`), résolue côté serveur par l'appelant
  // (`searchCatalogAction`) — jamais un paramètre client (docs/development.md).
  currency?: 'usd' | 'eur'
}

export interface CardSearchItem {
  id: string
  name: string
  setCode: string
  // Nom du set (sous-titre `CODE · Set name · #num`), obtenu par jointure
  // sur `sets` plutôt que recopié depuis `sets.card_count`/`SetSummary`
  // (deux lectures indépendantes du même nom pourraient diverger).
  setName: string
  collectorNumber: string
  rarity: string
  manaCost: string | null
  typeLine: string
  thumbUrl: string
  // Grande image (variante `normal`) — l'étape « chosen printing » de
  // `AddCardSheet` montre l'illustration complète, pas une vignette. `null`
  // quand le bulk n'en a pas (jamais construite à la main — docs/development.md) ;
  // `CardImage` affiche alors son repli `ImageOff`.
  imageUrl: string | null
  price: number | null
  // Le picker de commandant de l'écran `Decks` a besoin de l'identité colorée
  // pour reproduire localement le statut que `evaluateDeck` calculerait côté
  // serveur (l'identité colorée d'un deck Commander est celle du commandant,
  // jamais l'union des cartes). Champ additif, ignoré par les appelants existants
  // (`add-card-sheet.tsx`, `SearchRow`).
  colorIdentity: string[]
}

export interface CardSearchResult {
  items: CardSearchItem[]
  nextCursor: string | null
  totalEstimate: number
  // Devise du compte utilisée pour `CardSearchItem.price` — portée par la
  // réponse plutôt que redemandée par un aller-retour séparé : tout
  // consommateur (`SearchRow` dans `search-view.tsx`, `set-detail-view.tsx`,
  // `add-card-sheet.tsx`) affiche un prix déjà connu
  // dans la bonne devise sans jamais deviner `$` par défaut.
  currency: 'usd' | 'eur'
}

// TTL du cache Redis : 10 minutes.
const CACHE_TTL_SECONDS = 10 * 60

interface SearchRow extends Record<string, unknown> {
  id: string
  card_name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  mana_cost: string | null
  type_line: string
  color_identity: string[]
  image_uris: ScryfallImageUris | null
  price: string | null
  sort_rank: number
  sort_name: string
  total_estimate: string
}

// pg_trgm génère ses trigrammes déjà repliés en casse — `similarity()`/`%`
// sont insensibles à la casse sur l'index brut (`cards_name_trgm_idx`).
// Correspondance STRICTE sur le nom (demande produit, 2026-09-01) : chaque
// mot de la requête doit apparaître tel quel dans `cards.name` (`ILIKE`,
// accéléré par l'index trigramme `cards_name_trgm_idx` — pg_trgm sert les
// `ILIKE '%…%'`). L'ancien double recours — plein texte sur
// nom+type+oracle, OU similarité trigramme `name % query` — faisait sortir
// « Volcanic… » sur « Volo » : la similarité floue matche des noms voisins
// sans contenir la requête. Elle ne sert plus qu'au CLASSEMENT, jamais à la
// sélection ; contrepartie assumée : une faute de frappe ne trouve plus
// rien.
//
// `normalized.query` (lib/search/normalize.ts) arrive déjà trim/minuscules,
// les espaces repliés — un mot par segment.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`)
}

// Un préfixe exact du nom passe devant, puis la similarité départage — le
// « Volo, Guide to Monsters » cherché sort avant « Krenko, Baron of Volo ».
function rankExpression(query: string): SQL {
  if (query.length === 0) return sql`0::real`
  return sql`(
    (case when cards.name ilike ${escapeLike(query) + '%'} then 1 else 0 end)
    + coalesce(similarity(cards.name, ${query}), 0)
  )`
}

function textCondition(query: string): SQL {
  if (query.length === 0) return sql`true`
  const words = query.split(' ').filter((word) => word.length > 0)
  const conditions = words.map((word) => sql`cards.name ilike ${'%' + escapeLike(word) + '%'}`)
  return sql.join(conditions, sql` and `)
}

// 'C' (incolore) n'existe jamais comme élément de `color_identity` dans le
// catalogue — une carte incolore a un tableau vide. Traité à part
// plutôt que comme une couleur parmi d'autres.
function colorCondition(filters: NormalizedSearchFilters): SQL | null {
  if (filters.colors.length === 0) return null

  const isColorlessOnly = filters.colors.length === 1 && filters.colors[0] === 'C'
  if (isColorlessOnly) return sql`cards.color_identity = ARRAY[]::text[]`

  const realColors = filters.colors.filter((color) => color !== 'C')
  if (realColors.length === 0) return null

  switch (filters.colorMatch) {
    case 'exactly':
      return sql`cards.color_identity @> ${textArray(realColors)} and cards.color_identity <@ ${textArray(realColors)}`
    case 'atMost':
      return sql`cards.color_identity <@ ${textArray(realColors)}`
    case 'including':
    default:
      return sql`cards.color_identity @> ${textArray(realColors)}`
  }
}

// Spectre de couleur : troisième axe, orthogonal aux pips —
// `array_length(..., 1)` rend `null` sur un tableau vide (carte incolore),
// jamais `0` ; `= 1` exclut donc correctement l'incolore de `'mono'`.
function colorSpreadCondition(filters: NormalizedSearchFilters): SQL | null {
  if (filters.colorSpread === 'multi') return sql`array_length(cards.color_identity, 1) > 1`
  if (filters.colorSpread === 'mono') return sql`array_length(cards.color_identity, 1) = 1`
  return null
}

function typesCondition(filters: NormalizedSearchFilters): SQL | null {
  if (filters.types.length === 0) return null
  const perType = filters.types.map((type) => sql`cards.type_line ilike ${`%${type}%`}`)
  return sql`(${sql.join(perType, sql` or `)})`
}

function raritiesCondition(filters: NormalizedSearchFilters): SQL | null {
  if (filters.rarities.length === 0) return null
  return sql`cards.rarity = any(${textArray(filters.rarities)})`
}

function setCodeCondition(filters: NormalizedSearchFilters): SQL | null {
  if (!filters.setCode) return null
  return sql`cards.set_code = ${filters.setCode}`
}

// Colonne de prix de l'impression dans la devise du compte — la même que
// celle affichée par la ligne de résultat (jamais `$` en dur). `usd`/`eur`
// sont deux colonnes de `card_prices`, jamais une conversion de change
// (docs/development.md, `price_source` unique).
function priceExpression(currency: 'usd' | 'eur'): SQL {
  return currency === 'eur' ? sql`latest_price.eur` : sql`latest_price.usd`
}

function priceCondition(filters: NormalizedSearchFilters, currency: 'usd' | 'eur'): SQL | null {
  const column = priceExpression(currency)
  const parts: SQL[] = []
  if (filters.priceMin !== null) parts.push(sql`${column} >= ${filters.priceMin}`)
  if (filters.priceMax !== null) parts.push(sql`${column} <= ${filters.priceMax}`)
  if (parts.length === 0) return null
  return sql.join(parts, sql` and `)
}

function foilCondition(filters: NormalizedSearchFilters): SQL | null {
  if (!filters.foilOnly) return null
  return sql`'foil' = any(cards.finishes)`
}

// Condition « Set · Type » : une carte est montrée si sa famille appartient
// à la sélection. Les prédicats suivent la préséance de
// `lib/search/set-type-groups.ts` (Tokens > Art Series > Promos > Release >
// Others) — chaque clause exclut les familles plus prioritaires pour que la
// partition reste exacte. NULL-sûr : layout/set_type NULL tombent dans
// `others` — d'où les `coalesce`. Sans eux, un `layout` NULL (cartes
// importées avant la migration 0017, jusqu'au prochain import) rendait
// `not tokenPred` NULL, et la carte disparaissait de toute famille, même
// d'un set `expansion`.
function setTypesCondition(filters: NormalizedSearchFilters): SQL | null {
  const selected = filters.setTypes
  if (selected.length === 0 || selected.length === SET_TYPE_GROUPS.length) return null

  const tokenPred = sql`(coalesce(cards.layout, '') in ('token', 'double_faced_token', 'emblem') or coalesce(sets.set_type, '') = 'token')`
  const artPred = sql`(coalesce(cards.layout, '') = 'art_series' or sets.name ilike '% Art Series')`
  const promoPred = sql`coalesce(sets.set_type, '') = 'promo'`
  const releasePred = sql`coalesce(sets.set_type, '') in (${sql.join(
    RELEASE_SET_TYPES.map((value) => sql`${value}`),
    sql`, `,
  )})`

  const clauses: SQL[] = []
  for (const group of selected) {
    if (group === 'tokens') clauses.push(tokenPred)
    else if (group === 'art_series') clauses.push(sql`(${artPred} and not ${tokenPred})`)
    else if (group === 'promos')
      clauses.push(sql`(${promoPred} and not ${tokenPred} and not ${artPred})`)
    else if (group === 'release')
      clauses.push(sql`(${releasePred} and not ${tokenPred} and not ${artPred})`)
    else
      clauses.push(
        sql`(not ${tokenPred} and not ${artPred} and not ${promoPred} and not (sets.set_type is not null and ${releasePred}))`,
      )
  }
  return sql`(${sql.join(clauses, sql` or `)})`
}

function filtersCondition(filters: NormalizedSearchFilters, currency: 'usd' | 'eur'): SQL {
  const conditions = [
    colorCondition(filters),
    colorSpreadCondition(filters),
    typesCondition(filters),
    raritiesCondition(filters),
    setCodeCondition(filters),
    priceCondition(filters, currency),
    foilCondition(filters),
    setTypesCondition(filters),
  ].filter((c): c is SQL => c !== null)

  if (conditions.length === 0) return sql`true`
  return sql.join(conditions, sql` and `)
}

// Pagination par curseur (seek pagination), jamais `OFFSET` (docs/development.md).
// `sort_rank`/`sort_name` sont les deux colonnes de tri **du régime en
// cours** (voir `scoredToFinal` ci-dessous) : la pertinence en mode
// `'search'`, le numéro de collectionneur en mode `'set'` — la même formule
// de curseur sert donc les deux régimes sans dupliquer la logique de seek.
// `-sort_rank` ramène le tri `sort_rank DESC, sort_name ASC, id ASC` à un
// ordre entièrement croissant : la comparaison de ligne `(a, b, c) > (x, y,
// z)` reproduit alors fidèlement « strictement après la dernière ligne vue »
// (`id` est le discriminant qui empêche la boucle sur un rang/nom égaux).
function cursorCondition(cursor: SearchCursor | null): SQL {
  if (!cursor) return sql`true`
  return sql`(-sort_rank, sort_name, id) > (${-cursor.rank}, ${cursor.name}, ${cursor.cardId})`
}

// Le corps commun aux deux régimes : cartes filtrées, jointes à leur set
// (nom + date de sortie), avec le prix résolu dans la devise du compte.
function scoredSelect(normalized: NormalizedSearchParams): SQL {
  return sql`
    select
      cards.id,
      cards.name as card_name,
      cards.set_code,
      sets.name as set_name,
      sets.released_at as released_at,
      cards.collector_number,
      cards.rarity,
      cards.mana_cost,
      cards.type_line,
      cards.color_identity,
      cards.image_uris,
      ${priceExpression(normalized.currency)} as price,
      ${rankExpression(normalized.query)} as text_rank
    from cards
    join sets on sets.code = cards.set_code
    left join lateral (
      select usd, eur from card_prices
      where card_prices.card_id = cards.id
      order by day desc
      limit 1
    ) as latest_price on true
    where ${textCondition(normalized.query)} and ${filtersCondition(normalized.filters, normalized.currency)}
  `
}

// Numéro de collectionneur en ordre naturel (`12` avant `112`, jamais
// alphabétique) : préfixe
// numérique extrait par `regexp_replace`, replié sur un très grand entier
// quand il n'y en a aucun (`S1`, `★…`) pour que ces variantes se rangent en
// fin de liste plutôt que de casser le tri. `\\D` (barre oblique doublée) :
// un gabarit `sql\`…\`` est un template littéral comme un autre — une seule
// barre oblique inverse serait consommée par JavaScript avant d'atteindre
// Postgres (`\D` → `D`), pas la classe de caractères voulue.
function collectorSortExpression(column: SQL = sql`collector_number`): SQL {
  return sql`coalesce(nullif(regexp_replace(${column}, '\\D.*$', ''), '')::int, 999999)`
}

async function runGroupedSearch(
  normalized: NormalizedSearchParams,
  cursor: SearchCursor | null,
): Promise<SearchRow[]> {
  // `distinct on (card_name)` — un résultat par nom (équivalent Scryfall
  // `unique=cards, order=name`), impression représentative la plus récente
  // (`released_at desc`, `id desc` en dernier repli sur une date égale ou
  // nulle). L'ordre de `distinct on` doit commencer par son expression
  // (règle Postgres) ; le classement par pertinence n'intervient qu'ensuite,
  // dans `final`.
  const query = sql`
    with scored as (${scoredSelect(normalized)}),
    representative as (
      select distinct on (card_name) *
      from scored
      order by card_name asc, released_at desc nulls last, id desc
    ),
    final as (
      select
        *,
        count(*) over () as total_estimate,
        text_rank as sort_rank,
        card_name as sort_name
      from representative
    )
    select * from final
    where ${cursorCondition(cursor)}
    order by sort_rank desc, sort_name asc, id asc
    limit ${normalized.limit + 1}
  `
  const { rows } = await db.execute<SearchRow>(query)
  return rows
}

async function runSetBrowse(
  normalized: NormalizedSearchParams,
  cursor: SearchCursor | null,
): Promise<SearchRow[]> {
  // Aucun dédoublonnage — chaque impression du set est sa propre ligne
  // (équivalent Scryfall `unique=prints, order=set`), triée par numéro de
  // collectionneur naturel.
  const query = sql`
    with scored as (${scoredSelect(normalized)}),
    final as (
      select
        *,
        count(*) over () as total_estimate,
        -(${collectorSortExpression()}) as sort_rank,
        collector_number as sort_name
      from scored
    )
    select * from final
    where ${cursorCondition(cursor)}
    order by sort_rank desc, sort_name asc, id asc
    limit ${normalized.limit + 1}
  `
  const { rows } = await db.execute<SearchRow>(query)
  return rows
}

function toItem(row: SearchRow): CardSearchItem {
  return {
    id: row.id,
    name: row.card_name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    manaCost: row.mana_cost,
    typeLine: row.type_line,
    thumbUrl: thumbUrl(row.id, 'small'),
    imageUrl: largeUrl({ imageUris: row.image_uris }, 'normal'),
    price: row.price === null ? null : Number(row.price),
    colorIdentity: row.color_identity,
  }
}

export async function searchCards(params: CardSearchParams): Promise<CardSearchResult> {
  const normalized = normalizeSearchParams(params)
  const cacheKey = searchCacheKey(params)

  const cached = await cacheGet(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as CardSearchResult
    } catch {
      // Entrée corrompue improbable — on retombe sur une recherche réelle
      // plutôt que d'échouer.
    }
  }

  // Peut lever `InvalidCursorError` — jamais rattrapée ici, la Server Action
  // la traduit en réponse d'erreur propre.
  const cursor = normalized.cursor ? decodeCursor(normalized.cursor) : null

  const rows =
    params.scope === 'set'
      ? await runSetBrowse(normalized, cursor)
      : await runGroupedSearch(normalized, cursor)

  const hasMore = rows.length > normalized.limit
  const pageRows = hasMore ? rows.slice(0, normalized.limit) : rows
  const lastRow = pageRows.at(-1)

  const result: CardSearchResult = {
    items: pageRows.map(toItem),
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({ rank: Number(lastRow.sort_rank), name: String(lastRow.sort_name), cardId: lastRow.id })
        : null,
    totalEstimate: rows[0] ? Number(rows[0].total_estimate) : 0,
    currency: normalized.currency,
  }

  await cacheSet(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS)

  return result
}

// Toutes les impressions d'un même nom de carte (feuille `Add a card`,
// étape « Choose a printing of X ») : lecture directe du miroir local, sans
// classement/dédoublonnage (chaque impression est un choix distinct pour
// l'utilisateur), triée de la plus récente à la plus ancienne. Non mise en
// cache : lue une fois par ouverture de la feuille,
// sur un jeu de lignes toujours petit (une poignée d'impressions par nom).
export interface PrintingItem {
  id: string
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  releasedAt: string | null
  imageUrl: string | null
  price: number | null
}

export async function getPrintingsByName(
  name: string,
  currency: 'usd' | 'eur',
): Promise<PrintingItem[]> {
  const { rows } = await db.execute<{
    id: string
    set_code: string
    set_name: string
    collector_number: string
    rarity: string
    released_at: string | null
    image_uris: ScryfallImageUris | null
    price: string | null
  }>(sql`
    select
      cards.id,
      cards.set_code,
      sets.name as set_name,
      cards.collector_number,
      cards.rarity,
      sets.released_at as released_at,
      cards.image_uris,
      ${priceExpression(currency)} as price
    from cards
    join sets on sets.code = cards.set_code
    left join lateral (
      select usd, eur from card_prices
      where card_prices.card_id = cards.id
      order by day desc
      limit 1
    ) as latest_price on true
    where cards.name = ${name}
    order by sets.released_at desc nulls last, cards.collector_number asc
  `)

  return rows.map((row) => ({
    id: row.id,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    releasedAt: row.released_at,
    imageUrl: largeUrl({ imageUris: row.image_uris }, 'normal'),
    price: row.price === null ? null : Number(row.price),
  }))
}
