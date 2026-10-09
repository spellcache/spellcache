// Lecture paginée des holdings d'un container (`query`, `filters`, `sort`,
// `groupBy`) : autorisée par `requireContainerAccess` — le seul chemin
// d'autorisation (docs/development.md) — jamais un agrégat sur `holdings` (le
// total vient de `container_stats` : le bandeau de valeur lit une ligne).
// Toute la jointure `holdings → cards → card_prices` et tous les filtres
// (catalogue et holding) sont construits en ce point unique : les mélanger
// dans un seul WHERE sans jointure explicite produit des faux positifs.
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { containers, containerStats, users, type Condition, type Finish } from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { isGradientKey, type GradientKey } from '@/lib/binders/gradients'
import { availableQtyExpr } from '@/lib/decks/availability'
import type { Currency } from '@/lib/format/money'
import { db } from '@spellcache/db'
import { thumbUrl } from '@spellcache/core/images'
import { getCardArtist } from '@/lib/cards/artist'
import { textArray, uuidArray } from '@spellcache/db/array-param'
import {
  EMPTY_FILTERS,
  type GroupKey,
  type HoldingFilters,
  type SortDir,
  type SortKey,
} from '@/lib/view-state/parse'

export type Density = 'rows' | 'compact' | 'grid'

export interface HoldingRow {
  holdingId: string
  cardId: string
  name: string
  manaCost: string | null
  setCode: string
  // Nom complet du set (ligne de set `CODE · Nom du set #numéro` de
  // `CardRow`) — `left join sets` sur
  // `HOLDINGS_JOIN_CHAIN`, `null` seulement si le catalogue local n'a pas
  // encore reçu la ligne `sets` correspondante (miroir bulk incomplet).
  setName: string | null
  // Icône officielle du set (`sets.icon_svg_uri`, remplie par l'import) —
  // `null` si Scryfall n'en a pas fourni : la tuile n'affiche alors rien.
  setIconUri: string | null
  collectorNumber: string
  rarity: string
  finish: Finish
  condition: Condition
  qty: number
  // Quantité disponible de cette ligne précise : une carte réservée apparaît
  // avec sa quantité totale ET sa quantité disponible, deux valeurs distinctes
  // dans le DOM. Jamais agrégée depuis `qty` par ce composant : `available` vient de
  // `availableQtyExpr` (`lib/decks/availability.ts`), la même formule que
  // l'assemblage, scopée à la finition de cette ligne (une réservation ne
  // porte que sur la finition que le deck construit réclame réellement).
  // Égale à `qty` tant qu'aucun deck `built` de la collection ne réclame
  // cette carte sous cette finition.
  available: number
  priceMinor: number | null
  thumbUrl: string
  // Nom du binder qui possède réellement cette ligne, `null` si elle est en
  // vrac dans le container racine (voir le commentaire de
  // tête de `listHoldings` ci-dessous). Sur l'écran d'un
  // binder/deck/liste, tous les holdings affichés appartiennent déjà à ce
  // seul container : le champ y reste constant, sans intérêt fonctionnel.
  // Utile uniquement sur « All collection » (racine), pour le filtre `Binder`
  // et la ligne `Binder` de la feuille de détail — jamais affiché dans une
  // ligne de liste.
  binderName: string | null
  // Étiquette du groupe courant (en-têtes de groupe collants dans la liste
  // virtualisée) — `null` quand `groupBy` est
  // absent/`none`/`binder` (inerte). Calculée côté serveur (même
  // classement que l'`ORDER BY`) pour qu'un changement de frontière de
  // groupe ne puisse jamais dériver du tri réel.
  groupLabel: string | null
}

export interface HoldingPage {
  items: HoldingRow[]
  nextCursor: string | null
  total: number
}

// Header d'écran de container : nom, densité de la préférence compte (jamais
// du navigateur, docs/development.md), et les mêmes colonnes précalculées que
// la carte de valeur de l'accueil de la collection.
export interface ContainerHeader {
  containerId: string
  kind: 'collection' | 'binder' | 'deck' | 'list'
  name: string
  density: Density
  currency: Currency
  cardCount: number
  uniqueCount: number
  valueMinor: number
  // Apparence du binder — `null`/`null`
  // pour tout autre `kind`, ou pour un binder resté au mode `None`.
  // `coverCardId` (l'`art_scryfall_id` brut, pas seulement l'URL dérivée) est
  // nécessaire à `LookSheet` pour présélectionner la carte déjà choisie en
  // mode `Card art` — `coverArtUrl` seul (même convention que `BinderSummary`)
  // ne suffit pas à round-tripper l'id.
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  // Artiste de la carte de fond (`coverCardId`), crédité sous le titre :
  // l'`art_crop` ne porte pas la ligne d'artiste de la carte.
  coverArtist: string | null
  coverIntensity: number
  // Préférences de compte réglées dans Settings › Appearance, jamais
  // écrites ici. `pricesOnArt` gouverne uniquement `GridTile` (densité
  // `grid` — la seule tuile qui superpose un prix à même l'illustration).
  // `binderBackdrops` neutralise le rendu de l'en-tête
  // illustré (`BinderHeader`) sans jamais toucher `coverGradient`/
  // `coverCardId`/`coverArtUrl` ci-dessus, qui restent la valeur réelle
  // stockée.
  pricesOnArt: boolean
  binderBackdrops: boolean
  // Préférence `Card preview pane`, pilotée aussi par la bascule
  // `panel-right` de la barre de commande : les deux commandes écrivent cette
  // seule et même colonne.
  // Lue ici plutôt que par un second aller-retour client : l'écran doit
  // déjà savoir, au premier rendu serveur, s'il monte le panneau.
  previewPane: boolean
  // Rôle du compte dans la collection de CE container (`viewer` ⇒ lecture
  // seule) : un lien direct peut ouvrir une collection qui n'est pas
  // l'active, le shell ne suffit donc pas — l'écran repose sa propre valeur.
  canEdit: boolean
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

interface HoldingCursor {
  // `string` pour `groupBy: 'set'` (`cards.set_code`), `number` pour
  // `type`/`colour`/`rarity` (rang entier). Un schéma qui n'accepterait que
  // `number` ferait produire au groupement par `set` un curseur que son
  // propre `cursorSchema` rejetterait (`InvalidHoldingCursorError`),
  // converti en `{ error: 'invalid_cursor' }` par `listHoldingsAction`, la
  // page perdue en silence par `getNextPageParam` → liste tronquée à 50
  // lignes sans erreur visible.
  groupRank: number | string | null
  sortValue: string | number
  holdingId: string
}

export type { HoldingCursor }

export class InvalidHoldingCursorError extends Error {}

const cursorSchema = z.object({
  groupRank: z.union([z.number(), z.string()]).nullable(),
  sortValue: z.union([z.string(), z.number()]),
  holdingId: z.uuid(),
})

// Exportées uniquement pour un test unitaire pur (`tests/unit/`), même
// précédent que `lib/search/cursor.ts` : le round-trip du curseur ne
// dépend d'aucune connexion Postgres, il peut donc être prouvé sans base de
// données réelle — contrairement à `listHoldings`/`countHoldings`, qui
// exécutent une vraie requête et restent couverts par
// `tests/integration/filters.test.ts`.
function encodeCursor(cursor: HoldingCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string): HoldingCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    return cursorSchema.parse(JSON.parse(json))
  } catch {
    throw new InvalidHoldingCursorError(`Invalid holdings cursor: ${raw}`)
  }
}

export { encodeCursor, decodeCursor }

// Unique source de vérité pour la devise (docs/development.md) : `tcgplayer_usd` ⇒ $,
// `cardmarket_eur` ⇒ €. Même correspondance que `collection-data.ts`,
// dupliquée ici plutôt que partagée — un ternaire à deux branches, pas une
// logique qui justifie un fichier commun hors du périmètre de cette feature.
function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

interface HoldingSqlRow extends Record<string, unknown> {
  holding_id: string
  card_id: string
  name: string
  mana_cost: string | null
  set_code: string
  set_name: string | null
  set_icon_uri: string | null
  collector_number: string
  rarity: string
  finish: Finish
  condition: Condition
  qty: number
  available_qty: string | number
  usd: string | null
  usd_foil: string | null
  eur: string | null
  eur_foil: string | null
  group_rank: number | string | null
  group_label: string | null
  // Nom du binder propriétaire de la ligne, `null` en vrac (voir
  // `HoldingRow.binderName`) — calculé dans `HOLDINGS_JOIN_CHAIN` via le join
  // sur `containers`.
  binder_name: string | null
  // Le pilote `pg` renvoie `numeric` en `string`, jamais en `number` — la
  // normalisation vers le type attendu par `HoldingCursor` se fait
  // explicitement selon `SORT_VALUE_KIND[sort.key]`, jamais par un `typeof`
  // sur la valeur brute (voir `normalizeSortValue` ci-dessous). `added` est lu
  // via `::text` (voir `rawSortExpr`), jamais comme `Date` : le pilote `pg`
  // interprète `timestamp without time zone` (OID 1114) avec le fuseau du
  // *process*, pas celui de la session Postgres — `Date.toISOString()`
  // décalerait alors le curseur de l'offset UTC local (reproduit sous
  // `TZ=Europe/Paris`), faisant boucler ou sauter la page suivante. Un cast
  // SQL en texte contourne tout parsing de date côté driver : la même chaîne
  // ressort telle qu'elle est entrée.
  sort_value: string | number | null
}

function unitPriceMinor(row: HoldingSqlRow, currency: Currency): number | null {
  const raw =
    row.finish === 'nonfoil'
      ? currency === 'usd'
        ? row.usd
        : row.eur
      : currency === 'usd'
        ? row.usd_foil
        : row.eur_foil
  return raw === null ? null : Math.round(Number(raw) * 100)
}

function toItem(row: HoldingSqlRow, currency: Currency): HoldingRow {
  return {
    holdingId: row.holding_id,
    cardId: row.card_id,
    name: row.name,
    manaCost: row.mana_cost,
    setCode: row.set_code,
    setName: row.set_name,
    setIconUri: row.set_icon_uri,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    finish: row.finish,
    condition: row.condition,
    qty: row.qty,
    available: Number(row.available_qty),
    priceMinor: unitPriceMinor(row, currency),
    thumbUrl: thumbUrl(row.card_id, 'small'),
    groupLabel: row.group_label,
    binderName: row.binder_name,
  }
}

// Prix unitaire courant en unité majeure (ex. `12.34`), selon le finish de
// la ligne et la devise du compte — colonne partagée par l'affichage
// (`unitPriceMinor` ci-dessus, calculé côté JS après lecture) et le filtre/
// tri par prix ci-dessous (calculé côté SQL : un seul point
// de jointure/calcul, pas deux logiques de prix qui pourraient diverger).
function priceExprMajor(currency: Currency): SQL {
  const nonfoilCol = currency === 'usd' ? sql`p.usd` : sql`p.eur`
  const foilCol = currency === 'usd' ? sql`p.usd_foil` : sql`p.eur_foil`
  return sql`(case when holdings.finish = 'nonfoil' then ${nonfoilCol} else ${foilCol} end)`
}

function priceExprMinor(currency: Currency): SQL {
  return sql`round(${priceExprMajor(currency)} * 100)`
}

// Chaîne `FROM`/`JOIN` unique de `holdings` (une seule
// requête, jointure `holdings → cards → card_prices` construite en un
// point) — `p` (le dernier prix connu) est référencé par
// `buildWhereConditions` (filtre Price) autant que par `listHoldings`
// (affichage/tri) : un second point de jointure écrit à la main dans
// `countHoldings` divergerait tôt ou tard de celui-ci (un `count(*)` joignant
// `holdings` et `cards` sans `p` ferait lever Postgres 42P01 — table `p`
// manquante — à tout recompte avec un filtre Price).
// `countHoldings` et `listHoldings` interpolent tous deux ce même fragment.
// `left join containers as holding_container` (voir le commentaire de tête
// de `listHoldings`) : nécessaire pour calculer
// `binder_name` (le nom du binder propriétaire réel de la ligne, `HoldingRow.
// binderName`) sur l'écran racine, qui affiche des lignes de plusieurs
// containers à la fois. N'affecte ni le nombre de lignes (jointure
// 1-1 sur une clé primaire) ni les filtres/tri existants.
export const HOLDINGS_JOIN_CHAIN = sql`
  from holdings
  join cards on cards.id = holdings.card_id
  left join sets on sets.code = cards.set_code
  left join containers as holding_container on holding_container.id = holdings.container_id
  left join lateral (
    select usd, usd_foil, eur, eur_foil from card_prices
    where card_prices.card_id = holdings.card_id
    order by day desc
    limit 1
  ) as p on true
`

// Périmètre des containers interrogés par une lecture de `holdings` (voir le
// commentaire de tête de `listHoldings` ci-dessous) : la racine d'une
// collection (`kind: 'collection'`) donne accès à elle-même ET à tous les
// binders de la même collection, puisque « All collection » montre les
// cartes en vrac ET celles rangées dans un binder. Tout autre `kind`
// (binder/deck/liste) reste seul dans son propre périmètre, sans jointure
// inter-containers. `executor` accepte aussi bien
// `db` qu'une transaction Drizzle (`lib/containers/bulk.ts` la réutilise).
export async function resolveContainerScope(
  executor: Pick<typeof db, 'select'>,
  containerId: string,
): Promise<string[]> {
  const [row] = await executor
    .select({ kind: containers.kind, collectionId: containers.collectionId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1)
  if (!row || row.kind !== 'collection') return [containerId]

  const rows = await executor
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(eq(containers.collectionId, row.collectionId), inArray(containers.kind, ['collection', 'binder'])),
    )
  return rows.map((r) => r.id)
}

// Bâtit la clause `WHERE` unique (holdings + cards + card_prices) à partir
// de la recherche texte et des filtres.
//
// `containerIds` : le périmètre réel interrogé, résolu par
// `resolveContainerScope` — la racine d'une collection interroge elle-même ET
// tous ses binders, tout autre `kind` reste seul. Absent ou vide, retombe sur
// `[containerId]` seul, pour tout appelant qui n'est pas passé par
// `resolveContainerScope`.
//
// `f.binderId` filtre réellement `holdings.container_id`. Ce n'est pas un
// no-op UNIQUEMENT parce que le périmètre de la racine n'est pas un seul
// container : `f.binderId` y désigne soit un binder précis, soit la racine
// elle-même (« No binder », les cartes en vrac — `listHoldingBindersAction`
// rend déjà la racine sous ce nom, `actions.ts`). Combiné en `AND` avec la
// condition de périmètre ci-dessus, un id hors périmètre (une autre
// collection, une valeur forgée) ne peut jamais ÉLARGIR l'accès — seulement
// le restreindre à rien.
export function buildWhereConditions(params: {
  containerId: string
  containerIds?: string[]
  query: string
  filters: HoldingFilters
  currency: Currency
}): SQL[] {
  const scope =
    params.containerIds && params.containerIds.length > 0 ? params.containerIds : [params.containerId]
  const conditions: SQL[] =
    scope.length > 1
      ? [sql`holdings.container_id = any(${uuidArray(scope)})`]
      : [sql`holdings.container_id = ${scope[0]}::uuid`]

  const trimmedQuery = params.query.trim()
  if (trimmedQuery) conditions.push(sql`cards.name ilike ${'%' + trimmedQuery + '%'}`)

  const f = params.filters

  // Couleurs : trois régimes façon Scryfall
  // — `including` (superset, la carte contient au moins les couleurs
  // choisies), `exactly` (égalité ensembliste, ordre normalisé côté SQL),
  // `atMost` (sous-ensemble, incolore compris). `C` (incolore) est un
  // pseudo-symbole hors palette WUBRG : combiné à une vraie couleur, il est
  // ignoré plutôt que de produire une condition toujours fausse (aucune
  // carte n'est à la fois incolore et colorée) — cas de bord non prévu par le design.
  const realColors = f.colors.filter((c) => c !== 'C')
  const wantColorless = f.colors.includes('C')
  if (realColors.length > 0) {
    if (f.colorMatch === 'including') {
      conditions.push(sql`cards.colors @> ${textArray(realColors)}`)
    } else if (f.colorMatch === 'exactly') {
      conditions.push(
        sql`(select array_agg(c order by c) from unnest(cards.colors) c) = (select array_agg(c order by c) from unnest(${textArray(realColors)}) c)`,
      )
    } else {
      conditions.push(sql`cards.colors <@ ${textArray(realColors)}`)
    }
  } else if (wantColorless) {
    conditions.push(sql`cardinality(cards.colors) = 0`)
  }

  if (f.multicolourOnly) conditions.push(sql`cardinality(cards.colors) >= 2`)
  if (f.monoOnly) conditions.push(sql`cardinality(cards.colors) = 1`)

  if (f.types.length > 0) {
    const typeConditions = f.types.map((t) => sql`cards.type_line ilike ${'%' + t + '%'}`)
    conditions.push(sql`(${sql.join(typeConditions, sql` or `)})`)
  }

  if (f.rarities.length > 0) conditions.push(sql`cards.rarity = any(${textArray(f.rarities)})`)
  if (f.finishes.length > 0) conditions.push(sql`holdings.finish = any(${textArray(f.finishes)})`)
  if (f.conditions.length > 0) conditions.push(sql`holdings.condition = any(${textArray(f.conditions)})`)
  if (f.setCode) conditions.push(sql`cards.set_code = ${f.setCode}`)

  // Voir le commentaire de tête de cette fonction : actif désormais, jamais
  // un no-op — visible seulement sur le container racine côté UI
  // (`filters-sheet.tsx`), mais sain à évaluer sur n'importe quel `kind`.
  if (f.binderId) conditions.push(sql`holdings.container_id = ${f.binderId}::uuid`)

  if (f.priceMinMinor !== null) conditions.push(sql`${priceExprMinor(params.currency)} >= ${f.priceMinMinor}`)
  if (f.priceMaxMinor !== null) conditions.push(sql`${priceExprMinor(params.currency)} <= ${f.priceMaxMinor}`)

  return conditions
}

export type SortValueKind = 'text' | 'numeric'

// Exportée pour le même test unitaire pur que `encodeCursor`/`decodeCursor`
// ci-dessus : `added` doit rester `'text'`, jamais un troisième `'timestamp'`
// qui réintroduirait un passage par `Date` (voir `rawSortExpr`).
export const SORT_VALUE_KIND: Record<SortKey, SortValueKind> = {
  name: 'text',
  price: 'numeric',
  cmc: 'numeric',
  rarity: 'numeric',
  set: 'text',
  // `text`, pas un troisième `'timestamp'` — voir `rawSortExpr` : la
  // colonne est castée en texte au niveau SQL, donc jamais reçue comme
  // `Date` par le pilote (voir `HoldingSqlRow.sort_value` ci-dessus).
  added: 'text',
  qty: 'numeric',
}

// Expression SQL brute (nullable seulement pour `price`) du critère de tri
// (`SortKey`). `set` combine set et numéro de
// collection en une seule valeur ordonnable (« Set & collector number »,
// une ligne, un critère), `rarity` porte un rang plutôt que
// l'ordre alphabétique de la chaîne (common < uncommon < rare < mythic).
export function rawSortExpr(key: SortKey, currency: Currency): SQL {
  switch (key) {
    case 'name':
      return sql`cards.name`
    case 'price':
      return priceExprMinor(currency)
    case 'cmc':
      return sql`cards.cmc`
    case 'rarity':
      return sql`(case cards.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'mythic' then 4 else 5 end)`
    case 'set':
      return sql`(cards.set_code || '#' || lpad(cards.collector_number, 10, '0'))`
    // `::text`, pas la colonne `timestamp` brute : Postgres formate
    // `2026-08-25 10:00:00.123456` (largeur fixe avant le point, fraction à
    // gauche) — un tri/curseur textuel reste chronologique, et évite tout
    // passage par `Date` côté pilote `pg` (voir `HoldingSqlRow.sort_value`).
    case 'added':
      return sql`holdings.added_at::text`
    case 'qty':
      return sql`holdings.qty`
  }
}

// `NULLS LAST` inconditionnel (`price` seul est nullable) obtenu par un
// sentinel plutôt qu'une clause `NULLS LAST` séparée : `High`/`Low` réduit
// alors à une seule colonne monotone, et la prédicat de reprise (« seek »)
// ci-dessous n'a besoin que d'une comparaison, jamais d'un cas nul distinct.
const NULL_SENTINEL_HIGH = -1e15
const NULL_SENTINEL_LOW = 1e15

function sortValueExpr(key: SortKey, dir: SortDir, currency: Currency): SQL {
  const raw = rawSortExpr(key, currency)
  if (key !== 'price') return raw
  const sentinel = dir === 'high' ? NULL_SENTINEL_HIGH : NULL_SENTINEL_LOW
  return sql`coalesce(${raw}, ${sentinel})`
}

// Normalise la valeur de tri lue en base vers ce que `HoldingCursor` encode
// (un curseur doit rester stable
// aller-retour) — jamais par `typeof` sur la valeur pg brute (`numeric`
// revient en `string`).
export function normalizeSortValue(raw: string | number | null, kind: SortValueKind): string | number {
  if (raw === null) return kind === 'text' ? '' : 0
  if (kind === 'numeric') return typeof raw === 'number' ? raw : Number(raw)
  return String(raw)
}

// Caste la valeur de curseur décodée vers le type SQL attendu par
// `kind` — jamais par inférence implicite du pilote (même principe que
// `normalizeSortValue`).
export function castCursorValue(value: string | number, kind: SortValueKind): SQL {
  if (kind === 'numeric') return sql`${value}::numeric`
  return sql`${value}::text`
}

// Caste le rang de groupe du curseur décodé
// vers le type SQL attendu par `groupExprs` — `text` pour `set`
// (`cards.set_code`), `numeric` pour `type`/`colour`/`rarity` (rang entier).
// Même principe que `castCursorValue` : jamais d'inférence implicite du
// pilote, le type suit celui, connu, de l'expression comparée.
function castGroupRank(value: number | string): SQL {
  return typeof value === 'string' ? sql`${value}::text` : sql`${value}::numeric`
}

// Rang de groupe (rendu par en-têtes de groupe collants
// dans la liste virtualisée) — `null` pour `none`/absent. `binder` (modèle
// disjoint) n'a délibérément aucun cas ici : il retombe sur `null`,
// jamais de jointure inter-container.
function groupExprs(groupBy: GroupKey | null): { rankExpr: SQL; labelExpr: SQL } | null {
  switch (groupBy) {
    case 'set':
      return { rankExpr: sql`cards.set_code`, labelExpr: sql`upper(cards.set_code)` }
    case 'type':
      return {
        rankExpr: sql`(
          case
            when cards.type_line ilike '%Creature%' then 1
            when cards.type_line ilike '%Planeswalker%' then 2
            when cards.type_line ilike '%Battle%' then 3
            when cards.type_line ilike '%Instant%' then 4
            when cards.type_line ilike '%Sorcery%' then 5
            when cards.type_line ilike '%Artifact%' then 6
            when cards.type_line ilike '%Enchantment%' then 7
            when cards.type_line ilike '%Land%' then 8
            else 9
          end
        )`,
        labelExpr: sql`(
          case
            when cards.type_line ilike '%Creature%' then 'Creature'
            when cards.type_line ilike '%Planeswalker%' then 'Planeswalker'
            when cards.type_line ilike '%Battle%' then 'Battle'
            when cards.type_line ilike '%Instant%' then 'Instant'
            when cards.type_line ilike '%Sorcery%' then 'Sorcery'
            when cards.type_line ilike '%Artifact%' then 'Artifact'
            when cards.type_line ilike '%Enchantment%' then 'Enchantment'
            when cards.type_line ilike '%Land%' then 'Land'
            else 'Other'
          end
        )`,
      }
    case 'colour':
      return {
        rankExpr: sql`(
          case
            when cardinality(cards.colors) = 0 then 0
            when cardinality(cards.colors) > 1 then 6
            when cards.colors[1] = 'W' then 1
            when cards.colors[1] = 'U' then 2
            when cards.colors[1] = 'B' then 3
            when cards.colors[1] = 'R' then 4
            when cards.colors[1] = 'G' then 5
            else 7
          end
        )`,
        labelExpr: sql`(
          case
            when cardinality(cards.colors) = 0 then 'Colourless'
            when cardinality(cards.colors) > 1 then 'Multicolour'
            when cards.colors[1] = 'W' then 'White'
            when cards.colors[1] = 'U' then 'Blue'
            when cards.colors[1] = 'B' then 'Black'
            when cards.colors[1] = 'R' then 'Red'
            when cards.colors[1] = 'G' then 'Green'
            else 'Other'
          end
        )`,
      }
    case 'rarity':
      return {
        rankExpr: sql`(case cards.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'mythic' then 4 else 5 end)`,
        labelExpr: sql`initcap(cards.rarity)`,
      }
    default:
      return null
  }
}

// Prédicat de reprise générique (seek pagination, jamais `OFFSET`,
// docs/development.md) : `(groupe, valeur de tri, id)` — le groupe toujours croissant,
// la valeur de tri dans le sens `dir`, `holdings.id` en départage final. Un
// sentinel numérique porte déjà `NULLS LAST` (voir `sortValueExpr`), donc
// chaque niveau ne compare qu'une seule colonne.
function seekCondition(params: {
  groupExpr: SQL | null
  valueExpr: SQL
  valueKind: SortValueKind
  sqlDir: 'asc' | 'desc'
  cursor: HoldingCursor | null
}): SQL {
  const { groupExpr, valueExpr, valueKind, sqlDir, cursor } = params
  if (!cursor) return sql`true`

  const valueOp = sqlDir === 'asc' ? sql`>` : sql`<`
  const cursorValue = castCursorValue(cursor.sortValue, valueKind)
  const valueTier = sql`((${valueExpr}) ${valueOp} (${cursorValue}) or ((${valueExpr}) = (${cursorValue}) and holdings.id > ${cursor.holdingId}::uuid))`

  if (!groupExpr || cursor.groupRank === null) return valueTier

  const groupRank = castGroupRank(cursor.groupRank)
  return sql`((${groupExpr}) > ${groupRank} or ((${groupExpr}) = ${groupRank} and ${valueTier}))`
}

export interface ListHoldingsOptions {
  cursor?: string | null
  limit?: number
  query?: string
  filters?: HoldingFilters
  sort?: { key: SortKey; dir: SortDir }
  groupBy?: GroupKey | null
}

// L'écran « All collection » (le container racine, `kind: 'collection'`)
// liste TOUTES les cartes possédées de la collection — celles en vrac dans la
// racine ET celles rangées dans un binder ; les decks et les listes restent
// exclus.
//
// Le modèle de données reste disjoint : chaque holding n'appartient qu'à un
// seul `container_id`. Seul le PÉRIMÈTRE interrogé par la racine s'élargit —
// voir `resolveContainerScope` ci-dessus, réutilisé par `countHoldings`,
// `listContainerSets`, `getContainerHeader` et les actions groupées
// (`lib/containers/bulk.ts`), pour qu'une sélection mêlant racine et binders
// reste éditable en un lot. Un binder, un deck ou une liste ouverts
// directement ne montrent que leurs propres holdings.
export async function listHoldings(
  userId: string,
  containerId: string,
  opts: ListHoldingsOptions = {},
): Promise<HoldingPage> {
  const access = await requireContainerAccess(userId, containerId, 'read')

  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null
  const query = opts.query ?? ''
  const filters = opts.filters ?? EMPTY_FILTERS
  const sort = opts.sort ?? { key: 'name' as SortKey, dir: 'low' as SortDir }
  const groupBy = opts.groupBy ?? null

  const [[userRow], [containerRow], containerScope] = await Promise.all([
    db.select({ priceSource: users.priceSource }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ kind: containers.kind }).from(containers).where(eq(containers.id, containerId)).limit(1),
    resolveContainerScope(db, containerId),
  ])
  const currency = toCurrency(userRow?.priceSource ?? 'cardmarket_eur')
  // `total` (curseur/`HoldingPage.total`) somme les lignes
  // `container_stats` déjà précalculées du périmètre entier (docs/development.md : «
  // valeurs précalculées... le bandeau de valeur lit une ligne, il n'agrège
  // jamais la liste des holdings au chargement ») — jamais un agrégat direct
  // sur `holdings`, même élargi à plusieurs containers.
  const statsRows = await db
    .select({ uniqueCount: containerStats.uniqueCount })
    .from(containerStats)
    .where(inArray(containerStats.containerId, containerScope))
  const total = statsRows.reduce((sum, row) => sum + row.uniqueCount, 0)
  // Cette route sert aussi bien un binder/la racine qu'un deck (aucun garde
  // de `kind`, contrairement à `deck-data.ts`/`getDeck`). Un deck `built` a
  // sa propre réclamation qui compte NÉGATIVEMENT dans `availableQtyExpr`
  // (elle est de `kind = 'deck'`) — sans l'exclure, chaque ligne de ce deck
  // se soustrairait elle-même de sa propre disponibilité (`0 available` quasi
  // systématique). Un binder/la racine ne doivent en revanche JAMAIS
  // s'exclure eux-mêmes : leur propre holding compte POSITIVEMENT dans la
  // somme (c'est littéralement le stock qui rend la carte disponible), donc
  // l'exclusion ne s'applique que si le container consulté est un deck.
  const excludeContainerIdExpr = containerRow?.kind === 'deck' ? sql`${containerId}::uuid` : null

  const whereConditions = buildWhereConditions({
    containerId,
    containerIds: containerScope,
    query,
    filters,
    currency,
  })
  const sqlDir = sort.dir === 'high' ? 'desc' : 'asc'
  const valueExpr = sortValueExpr(sort.key, sort.dir, currency)
  const valueKind = SORT_VALUE_KIND[sort.key]
  const group = groupExprs(groupBy)
  const seek = seekCondition({
    groupExpr: group ? group.rankExpr : null,
    valueExpr,
    valueKind,
    sqlDir,
    cursor,
  })

  const orderClauses = [
    ...(group ? [sql`(${group.rankExpr}) asc`] : []),
    sql`(${valueExpr}) ${sql.raw(sqlDir)}`,
    sql`holdings.id asc`,
  ]

  const { rows } = await db.execute<HoldingSqlRow>(sql`
    select
      holdings.id as holding_id,
      holdings.card_id as card_id,
      cards.name as name,
      cards.mana_cost as mana_cost,
      cards.set_code as set_code,
      sets.name as set_name,
      sets.icon_svg_uri as set_icon_uri,
      cards.collector_number as collector_number,
      cards.rarity as rarity,
      holdings.finish as finish,
      holdings.condition as condition,
      holdings.qty as qty,
      ${availableQtyExpr(sql`holdings.card_id`, sql`${access.collectionId}::uuid`, sql`h2.finish = holdings.finish`, excludeContainerIdExpr)} as available_qty,
      p.usd as usd,
      p.usd_foil as usd_foil,
      p.eur as eur,
      p.eur_foil as eur_foil,
      ${group ? sql`(${group.rankExpr})` : sql`null`} as group_rank,
      ${group ? sql`(${group.labelExpr})` : sql`null`} as group_label,
      (case when holding_container.kind = 'binder' then holding_container.name else null end) as binder_name,
      (${valueExpr}) as sort_value
    ${HOLDINGS_JOIN_CHAIN}
    where (${sql.join(whereConditions, sql` and `)}) and (${seek})
    order by ${sql.join(orderClauses, sql`, `)}
    limit ${limit + 1}
  `)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows.at(-1)

  return {
    items: pageRows.map((row) => toItem(row, currency)),
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({
            groupRank: lastRow.group_rank,
            sortValue: normalizeSortValue(lastRow.sort_value, valueKind),
            holdingId: lastRow.holding_id,
          })
        : null,
    total,
  }
}

// Compte de résultats avant application (`Show N cards`, recompté à chaque
// changement de filtre) — même clause `WHERE` **et** même chaîne `FROM`/`JOIN`
// que `listHoldings` (`HOLDINGS_JOIN_CHAIN` : un seul point de construction),
// sans tri ni curseur. `buildWhereConditions` référence `p.eur`/`p.usd` pour
// le filtre Price : sans le `left join lateral ... as p`, tout recompte avec
// un prix min/max lèverait Postgres 42P01 (« missing FROM-clause entry for
// table "p" »).
export async function countHoldings(
  userId: string,
  containerId: string,
  opts: { query?: string; filters?: HoldingFilters } = {},
): Promise<number> {
  await requireContainerAccess(userId, containerId, 'read')

  const [[userRow], containerScope] = await Promise.all([
    db.select({ priceSource: users.priceSource }).from(users).where(eq(users.id, userId)).limit(1),
    resolveContainerScope(db, containerId),
  ])
  const currency = toCurrency(userRow?.priceSource ?? 'cardmarket_eur')

  const whereConditions = buildWhereConditions({
    containerId,
    containerIds: containerScope,
    query: opts.query ?? '',
    filters: opts.filters ?? EMPTY_FILTERS,
    currency,
  })

  const { rows } = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    ${HOLDINGS_JOIN_CHAIN}
    where ${sql.join(whereConditions, sql` and `)}
  `)

  return Number(rows[0]?.count ?? '0')
}

// Sets distincts détenus dans ce container (ligne `Set` de la feuille
// `Filters`, « Any » ou un set précis) — sans picker dédié dans le design,
// qui ne montre que le bouton fermé (`Any`, chevron) : une
// liste triée par nom de set, seule surface neuve nécessaire pour rendre la
// ligne fonctionnelle sans inventer un second écran hors périmètre.
export interface ContainerSetOption {
  code: string
  name: string
}

export async function listContainerSets(userId: string, containerId: string): Promise<ContainerSetOption[]> {
  await requireContainerAccess(userId, containerId, 'read')
  // Même périmètre élargi que `listHoldings`/`countHoldings` pour la
  // racine : sinon le sélecteur `Set` de « All collection »
  // n'offrirait que les sets du vrac, incomplet face aux cartes de binder
  // listées à côté.
  const containerScope = await resolveContainerScope(db, containerId)

  const { rows } = await db.execute<{ code: string; name: string }>(sql`
    select distinct cards.set_code as code, sets.name as name
    from holdings
    join cards on cards.id = holdings.card_id
    join sets on sets.code = cards.set_code
    where holdings.container_id = any(${uuidArray(containerScope)})
    order by sets.name asc
  `)

  return rows
}

export async function getContainerHeader(userId: string, containerId: string): Promise<ContainerHeader> {
  const access = await requireContainerAccess(userId, containerId, 'read')

  const [row] = await db
    .select({
      id: containers.id,
      kind: containers.kind,
      name: containers.name,
      coverGradient: containers.coverGradient,
      coverCardId: containers.coverCardId,
      coverIntensity: containers.coverIntensity,
      cardCount: containerStats.cardCount,
      uniqueCount: containerStats.uniqueCount,
      valueUsdMinor: containerStats.valueUsdMinor,
      valueEurMinor: containerStats.valueEurMinor,
    })
    .from(containers)
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .where(eq(containers.id, containerId))
    .limit(1)

  if (!row) throw new Error(`Container ${containerId} not found.`)

  let cardCount = row.cardCount
  let uniqueCount = row.uniqueCount
  let valueUsdMinor = row.valueUsdMinor
  let valueEurMinor = row.valueEurMinor

  // Racine de collection (voir le commentaire de tête de
  // `listHoldings`) : le compteur du champ « Find in N cards... » et
  // `N shown` doivent couvrir les binders au même titre que le vrac.
  // Toujours une SOMME de lignes `container_stats` déjà précalculées
  // (docs/development.md : « le bandeau de valeur lit une ligne, il n'agrège jamais la
  // liste des holdings au chargement »), jamais un
  // agrégat direct sur `holdings` — le bandeau de valeur de l'accueil
  // (`app/(app)/collection/collection-data.ts`) reste, lui, inchangé.
  if (row.kind === 'collection') {
    const containerScope = await resolveContainerScope(db, containerId)
    if (containerScope.length > 1) {
      const statsRows = await db
        .select({
          cardCount: containerStats.cardCount,
          uniqueCount: containerStats.uniqueCount,
          valueUsdMinor: containerStats.valueUsdMinor,
          valueEurMinor: containerStats.valueEurMinor,
        })
        .from(containerStats)
        .where(inArray(containerStats.containerId, containerScope))
      cardCount = statsRows.reduce((sum, r) => sum + r.cardCount, 0)
      uniqueCount = statsRows.reduce((sum, r) => sum + r.uniqueCount, 0)
      valueUsdMinor = statsRows.reduce((sum, r) => sum + r.valueUsdMinor, 0)
      valueEurMinor = statsRows.reduce((sum, r) => sum + r.valueEurMinor, 0)
    }
  }

  const [userRow] = await db
    .select({
      priceSource: users.priceSource,
      density: users.density,
      pricesOnArt: users.pricesOnArt,
      binderBackdrops: users.binderBackdrops,
      previewPane: users.previewPane,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const currency = toCurrency(userRow?.priceSource ?? 'cardmarket_eur')

  return {
    containerId: row.id,
    kind: row.kind,
    name: row.name,
    density: userRow?.density ?? 'compact',
    currency,
    cardCount,
    uniqueCount,
    valueMinor: currency === 'usd' ? valueUsdMinor : valueEurMinor,
    pricesOnArt: userRow?.pricesOnArt ?? true,
    binderBackdrops: userRow?.binderBackdrops ?? true,
    previewPane: userRow?.previewPane ?? true,
    coverGradient: row.coverGradient && isGradientKey(row.coverGradient) ? row.coverGradient : null,
    coverCardId: row.coverCardId,
    coverArtUrl: row.coverCardId ? thumbUrl(row.coverCardId, 'art_crop') : null,
    coverArtist: await getCardArtist(row.coverCardId),
    coverIntensity: Number(row.coverIntensity),
    canEdit: access.role !== 'viewer',
  }
}

export interface ContainerCardOption {
  cardId: string
  name: string
  thumbUrl: string
}

// Cartes détenues dans ce container, dédupliquées par carte (le
// sélecteur de carte du mode `Card art` ne doit lister que les
// cartes du binder, jamais le catalogue) — même patron que
// `listContainerSets` ci-dessus.
export async function listContainerCards(
  userId: string,
  containerId: string,
  query: string,
): Promise<ContainerCardOption[]> {
  await requireContainerAccess(userId, containerId, 'read')

  const trimmed = query.trim()
  const { rows } = await db.execute<{ card_id: string; name: string }>(sql`
    select distinct on (cards.id) cards.id as card_id, cards.name as name
    from holdings
    join cards on cards.id = holdings.card_id
    where holdings.container_id = ${containerId}::uuid
    ${trimmed ? sql`and cards.name ilike ${'%' + trimmed + '%'}` : sql``}
    order by cards.id
  `)

  return rows
    .map((row) => ({ cardId: row.card_id, name: row.name, thumbUrl: thumbUrl(row.card_id, 'small') }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
