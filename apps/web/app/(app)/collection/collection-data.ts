// Requête de l'écran d'accueil. `container_stats` du container racine est
// l'unique source de la carte de valeur et de la ligne `All collection` —
// jamais une agrégation de `holdings` au rendu (docs/development.md : « le
// bandeau de valeur lit une ligne »). Le container racine ne porte que les
// cartes non rangées dans un binder/deck/liste (un holding vit dans un seul
// container) — « All collection » et « TOTAL COLLECTION VALUE » montrent donc
// le même nombre par construction, pas par coïncidence des données.
import { and, eq, sql, type SQL } from 'drizzle-orm'

import { collectionMembers, containers, containerStats, users, type LayoutStyle } from '@spellcache/db/schema'
import { type GradientKey, isGradientKey } from '@/lib/binders/gradients'
import { formatCount, type Currency } from '@/lib/format/money'
import { thumbUrl } from '@spellcache/core/images'
import { db } from '@spellcache/db'
import { activeMembershipOf } from '@/lib/collections/active'

import { BUILT_DECKS_SHELF_ID } from './shelf-constants'

export interface CollectionHome {
  collectionId: string
  rootContainerId: string
  // Préférence brute de mise en page. `page.tsx` n'appelle plus
  // `getCollectionHome` pour la lire (voir `getCollectionStyle`
  // ci-dessous) — conservée sur ce type pour
  // tout appelant qui a déjà la ligne `container_stats` sous la main.
  collectionStyle: LayoutStyle
  // Préférence de compte `Binder backdrops` : à `false`,
  // `CollectionView` rend chaque `BinderRow` comme si son binder n'avait
  // aucune apparence enregistrée — `coverArtUrl`/`coverGradient` restent
  // inchangés ici, seul le rendu est neutralisé (les réglages restent
  // stockés).
  binderBackdrops: boolean
  value: { amountMinor: number; currency: Currency; delta7d: number | null }
  counts: { cards: number; unique: number; addedThisWeek: number }
  decks: { builtCount: number; valueMinor: number }
  binders: BinderSummary[]
  lists: ListSummary[]
}

export interface BinderSummary {
  id: string
  name: string
  cardCount: number
  valueMinor: number
  coverArtUrl: string | null // art_crop via le proxy, ou null
  coverGradient: GradientKey | null
  // Répercutée depuis `containers.cover_intensity` : la ligne d'accueil Compact reflète
  // l'intensité choisie dans la feuille `Binder look`, pas seulement son
  // mode/dégradé/illustration.
  coverIntensity: number
}

// « Même géométrie de ligne » que `BinderSummary` (onglet `Lists`) : les
// containers `kind = 'list'` portent exactement les mêmes
// colonnes (`cover_card_id`, `cover_gradient`) qu'un binder — pas de forme
// distincte à inventer.
export type ListSummary = BinderSummary

interface SecondaryQueryRow extends Record<string, unknown> {
  containers: Array<{
    id: string
    kind: 'binder' | 'list'
    name: string
    coverCardId: string | null
    coverGradient: string | null
    coverIntensity: number
    cardCount: number
    valueUsdMinor: number
    valueEurMinor: number
  }>
  built_decks: Array<{
    cardCount: number
    valueUsdMinor: number
    valueEurMinor: number
  }>
  added_this_week: number
}

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  // Unique source de vérité pour la devise (docs/development.md) : `tcgplayer_usd` ⇒
  // $, `cardmarket_eur` ⇒ €.
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

function toSummary(row: SecondaryQueryRow['containers'][number], currency: Currency): BinderSummary {
  return {
    id: row.id,
    name: row.name,
    cardCount: row.cardCount,
    valueMinor: currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor,
    coverArtUrl: row.coverCardId ? thumbUrl(row.coverCardId, 'art_crop') : null,
    coverGradient: row.coverGradient && isGradientKey(row.coverGradient) ? row.coverGradient : null,
    coverIntensity: Number(row.coverIntensity),
  }
}

// Deux requêtes SQL au total : la première
// résout l'accès et lit la ligne `container_stats` du container racine en un
// aller-retour (jointures), la seconde regroupe binders/lists, decks montés
// et le compteur « added this week » dans un unique `select` à sous-requêtes
// JSON — jamais une requête par container.
export async function getCollectionHome(userId: string): Promise<CollectionHome> {
  const [root] = await db
    .select({
      collectionId: collectionMembers.collectionId,
      rootContainerId: containers.id,
      priceSource: users.priceSource,
      collectionStyle: users.collectionStyle,
      binderBackdrops: users.binderBackdrops,
      cardCount: containerStats.cardCount,
      uniqueCount: containerStats.uniqueCount,
      valueUsdMinor: containerStats.valueUsdMinor,
      valueEurMinor: containerStats.valueEurMinor,
      deltaUsd7d: containerStats.deltaUsd7d,
      deltaEur7d: containerStats.deltaEur7d,
    })
    .from(collectionMembers)
    .innerJoin(
      containers,
      and(eq(containers.collectionId, collectionMembers.collectionId), eq(containers.kind, 'collection')),
    )
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .where(activeMembershipOf(userId))
    .limit(1)

  // `requireSession()` (lib/auth-guards.ts) appelle `bootstrapCollection`
  // avant tout accès à cet écran : un compte
  // qui atteint `getCollectionHome` est nécessairement déjà membre d'une
  // collection avec un container racine.
  if (!root) {
    throw new Error(`User ${userId} has no collection.`)
  }

  const currency = toCurrency(root.priceSource)

  const { rows } = await db.execute<SecondaryQueryRow>(sql`
    select
      coalesce((
        select json_agg(row_to_json(t) order by t.sort_order, t.created_at)
        from (
          select
            c.id, c.kind, c.name,
            c.cover_card_id as "coverCardId",
            c.cover_gradient as "coverGradient",
            c.cover_intensity as "coverIntensity",
            c.sort_order, c.created_at,
            cs.card_count as "cardCount",
            cs.value_usd_minor as "valueUsdMinor",
            cs.value_eur_minor as "valueEurMinor"
          from containers c
          join container_stats cs on cs.container_id = c.id
          where c.collection_id = ${root.collectionId} and c.kind in ('binder', 'list')
        ) t
      ), '[]'::json) as containers,
      coalesce((
        select json_agg(row_to_json(d))
        from (
          select
            cs.card_count as "cardCount",
            cs.value_usd_minor as "valueUsdMinor",
            cs.value_eur_minor as "valueEurMinor"
          from containers c
          join container_stats cs on cs.container_id = c.id
          where c.collection_id = ${root.collectionId} and c.kind = 'deck' and c.deck_state = 'built'
        ) d
      ), '[]'::json) as built_decks,
      (
        select count(*)::int
        from holdings h
        join containers hc on hc.id = h.container_id
        where hc.collection_id = ${root.collectionId} and h.added_at >= now() - interval '7 days'
      ) as added_this_week
  `)

  const secondary = rows[0]
  const containerRows = secondary?.containers ?? []
  const builtDeckRows = secondary?.built_decks ?? []

  const binders: BinderSummary[] = []
  const lists: ListSummary[] = []
  for (const row of containerRows) {
    const target = row.kind === 'binder' ? binders : lists
    target.push(toSummary(row, currency))
  }

  let deckValueMinor = 0
  for (const deck of builtDeckRows) {
    deckValueMinor += currency === 'usd' ? deck.valueUsdMinor : deck.valueEurMinor
  }

  const delta = currency === 'usd' ? root.deltaUsd7d : root.deltaEur7d

  return {
    collectionId: root.collectionId,
    rootContainerId: root.rootContainerId,
    collectionStyle: root.collectionStyle,
    binderBackdrops: root.binderBackdrops,
    value: {
      amountMinor: currency === 'usd' ? root.valueUsdMinor : root.valueEurMinor,
      currency,
      // Rempli par le job `revalue-containers` : `null` tant que la variation n'a
      // jamais été calculée.
      delta7d: delta !== null && delta !== undefined ? Number(delta) : null,
    },
    counts: {
      cards: root.cardCount,
      unique: root.uniqueCount,
      addedThisWeek: secondary?.added_this_week ?? 0,
    },
    decks: {
      builtCount: builtDeckRows.length,
      valueMinor: deckValueMinor,
    },
    binders,
    lists,
  }
}

// Lecture seule de `users.collection_style` (choix du style d'accueil), une
// requête dédiée plutôt que la première ligne de `getCollectionHome` : celle-ci
// entraîne la seconde requête agrégée de `getCollectionHome` (binders,
// lists, decks, compteurs), entièrement jetée par `page.tsx` quand le style
// vaut `'shelves'` — mesuré à 4 requêtes par chargement de
// `/collection` en Shelves, dont 2 sans usage.
export async function getCollectionStyle(userId: string): Promise<LayoutStyle> {
  const [row] = await db
    .select({ collectionStyle: users.collectionStyle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // Même garantie que `getCollectionHome` ci-dessus : `requireSession()`
  // (lib/auth-guards.ts) a déjà appelé `bootstrapCollection` avant tout
  // accès à cet écran, donc `users` porte toujours une ligne pour ce compte.
  if (!row) {
    throw new Error(`User ${userId} has no collection.`)
  }

  return row.collectionStyle
}

// Écran d'accueil `Collection home · style = Shelves`. Distinct de
// `getCollectionHome` ci-dessus — la page (`app/(app)/collection/page.tsx`)
// lit d'abord `getCollectionStyle`, puis n'appelle celle-ci que si la valeur
// vaut `'shelves'` : le budget « deux requêtes SQL » de `getCollectionHome`
// (testé) reste inchangé, cette fonction porte son propre budget séparé (au
// plus trois requêtes SQL).

export interface ShelfTile {
  cardId: string
  name: string
  // Image de la carte ENTIÈRE (variante `small` du proxy), pas l'art crop :
  // une étagère montre une pile de cartes, cadres et boîtes de texte
  // compris. L'art crop reste réservé au fond illustré d'un
  // binder, l'exact opposé d'une étagère.
  artUrl: string
  priceMinor: number | null
}

export interface ShelfData {
  containerId: string
  name: string
  meta: string // "1,284 cards" | "3 decks · 264 cards" | "N cards · not owned"
  valueMinor: number
  notOwned: boolean // true pour les containers kind = 'list'
  tiles: ShelfTile[] // au plus 6, les plus récemment ajoutées
}

export interface CollectionShelves {
  // Le container racine de la collection. L'accueil Shelves en a besoin pour
  // les mêmes raisons que l'accueil Compact : le `+` de l'en-tête y ajoute
  // une carte, et l'export lit ce container. Déjà sélectionné par la requête
  // ci-dessous, seulement pas exposé jusqu'ici.
  rootContainerId: string
  value: { amountMinor: number; currency: Currency; delta7d: number | null }
  recentlyAdded: { count: number; tiles: ShelfTile[] } // 4 tuiles au plus
  shelves: ShelfData[]
}

// `ShelfData.containerId` sentinelle pour l'étagère `Built decks` : voir
// `./shelf-constants.ts` pour le détail. Ré-exportée ici pour ne pas casser
// l'API publique de ce module (`tests/integration/collection-shelves.test.ts`
// l'importe depuis `collection-data.ts`) — même destination que la ligne
// `Decks` de l'accueil Compact (`components/collection/nav-row.tsx`).
export { BUILT_DECKS_SHELF_ID } from './shelf-constants'

// 6 — pas 8 : juste assez pour remplir une étagère de 390px, le reste serait
// masqué sous le recouvrement. 8 pour `Recently added`, une piste défilante
// distincte qui n'a pas cette contrainte de recouvrement.
const SHELF_TILE_LIMIT = 6
const RECENTLY_ADDED_LIMIT = 8

interface ShelfTileSqlRow extends Record<string, unknown> {
  cardId: string
  name: string
  priceMinor: number | string | null
}

function toTile(row: ShelfTileSqlRow): ShelfTile {
  return {
    cardId: row.cardId,
    name: row.name,
    artUrl: thumbUrl(row.cardId, 'small'),
    priceMinor: row.priceMinor === null ? null : Number(row.priceMinor),
  }
}

// Prix unitaire courant en centimes, selon le finish de la ligne et la
// devise du compte — même formule que `priceExprMinor`
// (`app/(app)/container/[id]/holdings-data.ts`), réécrite ici plutôt que
// partagée : cette requête référence l'alias `p` (jointure latérale sur le
// dernier prix connu) posé par `topValueTilesJsonSql`/`recentTilesJsonSql`
// ci-dessous, pas le `holdings`/`p` de `HOLDINGS_JOIN_CHAIN`.
function tilePriceSql(currency: Currency): SQL {
  const nonfoilCol = currency === 'usd' ? sql`p.usd` : sql`p.eur`
  const foilCol = currency === 'usd' ? sql`p.usd_foil` : sql`p.eur_foil`
  return sql`round((case when h.finish = 'nonfoil' then ${nonfoilCol} else ${foilCol} end) * 100)`
}

// Jusqu'à 6 tuiles d'une étagère — les plus récemment ajoutées d'abord,
// JAMAIS les plus chères : une pile de cartes montre ce qui vient d'entrer,
// pas un classement de valeur. Jamais dédupliquée par carte non plus
// (plusieurs holdings récents de la même carte restent autant de tuiles) —
// un `distinct on` masquerait
// justement les ajouts les plus frais dès qu'une carte déjà présente en
// reçoit un second exemplaire. `scope` cible les holdings d'un seul
// container (corrélé à `c.id` pour un binder/liste, ou fixé pour le
// container racine) ou de plusieurs (Built decks) — un fragment SQL composé
// au point d'appel, jamais un second aller-retour (une requête latérale unique
// ramenant les tuiles de chaque container, ici une sous-requête corrélée dans
// la liste `SELECT`, équivalente à `LATERAL`
// pour une valeur scalaire). Partagée avec `Recently added` ci-dessous
// (`RECENTLY_ADDED_LIMIT`, un scope collection entière plutôt que par
// container) — même requête, seuls `scope` et `limit` diffèrent.
function previewTilesJsonSql(scope: SQL, limit: number, currency: Currency): SQL {
  const price = tilePriceSql(currency)
  return sql`
    coalesce((
      select json_agg(row_to_json(picked) order by picked.rnk)
      from (
        select
          h.card_id as "cardId",
          cd.name as "name",
          ${price} as "priceMinor",
          row_number() over (order by h.added_at desc) as rnk
        from holdings h
        join cards cd on cd.id = h.card_id
        left join lateral (
          select usd, usd_foil, eur, eur_foil from card_prices
          where card_prices.card_id = h.card_id
          order by day desc
          limit 1
        ) p on true
        where ${scope}
        order by h.added_at desc
        limit ${limit}
      ) picked
    ), '[]'::json)
  `
}

// Même requête que ci-dessus, scopée à la collection entière (`Recently
// added`) plutôt qu'à un seul container — a besoin de la
// jointure sur `containers` pour filtrer par `collection_id`, absente de
// `holdings`.
function recentTilesJsonSql(collectionId: string, limit: number, currency: Currency): SQL {
  const price = tilePriceSql(currency)
  return sql`
    coalesce((
      select json_agg(row_to_json(picked) order by picked.rnk)
      from (
        select
          h.card_id as "cardId",
          cd.name as "name",
          ${price} as "priceMinor",
          row_number() over (order by h.added_at desc) as rnk
        from holdings h
        join cards cd on cd.id = h.card_id
        join containers hc on hc.id = h.container_id
        left join lateral (
          select usd, usd_foil, eur, eur_foil from card_prices
          where card_prices.card_id = h.card_id
          order by day desc
          limit 1
        ) p on true
        where hc.collection_id = ${collectionId}
        order by h.added_at desc
        limit ${limit}
      ) picked
    ), '[]'::json)
  `
}

interface ShelvesSqlRow extends Record<string, unknown> {
  containers: Array<{
    id: string
    kind: 'binder' | 'list'
    name: string
    cardCount: number
    valueUsdMinor: number
    valueEurMinor: number
    tiles: ShelfTileSqlRow[]
  }>
  built_decks: {
    deckCount: number
    cardCount: number
    valueUsdMinor: number
    valueEurMinor: number
  }
  root_tiles: ShelfTileSqlRow[]
  built_deck_tiles: ShelfTileSqlRow[]
  recent_tiles: ShelfTileSqlRow[]
  added_this_week: number
}

// Deux requêtes SQL au total (budget : au plus trois) : la première résout
// l'accès et la ligne `container_stats` du
// container racine (même patron que `getCollectionHome`), la seconde
// regroupe binders/lists (avec leurs tuiles en sous-requête corrélée),
// Built decks, les tuiles du container racine, les tuiles `Recently added`
// et le compteur « added this week » dans un unique `select` — jamais une
// requête par étagère (ce qui fabriquerait un N+1 sur le nombre de binders).
export async function getCollectionShelves(userId: string): Promise<CollectionShelves> {
  const [root] = await db
    .select({
      collectionId: collectionMembers.collectionId,
      rootContainerId: containers.id,
      priceSource: users.priceSource,
      cardCount: containerStats.cardCount,
      valueUsdMinor: containerStats.valueUsdMinor,
      valueEurMinor: containerStats.valueEurMinor,
      deltaUsd7d: containerStats.deltaUsd7d,
      deltaEur7d: containerStats.deltaEur7d,
    })
    .from(collectionMembers)
    .innerJoin(
      containers,
      and(eq(containers.collectionId, collectionMembers.collectionId), eq(containers.kind, 'collection')),
    )
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .where(activeMembershipOf(userId))
    .limit(1)

  if (!root) {
    throw new Error(`User ${userId} has no collection.`)
  }

  const currency = toCurrency(root.priceSource)

  const { rows } = await db.execute<ShelvesSqlRow>(sql`
    select
      coalesce((
        select json_agg(row_to_json(t) order by t.sort_order, t.created_at)
        from (
          select
            c.id, c.kind, c.name, c.sort_order, c.created_at,
            cs.card_count as "cardCount",
            cs.value_usd_minor as "valueUsdMinor",
            cs.value_eur_minor as "valueEurMinor",
            (${previewTilesJsonSql(sql`h.container_id = c.id`, SHELF_TILE_LIMIT, currency)}) as tiles
          from containers c
          join container_stats cs on cs.container_id = c.id
          where c.collection_id = ${root.collectionId} and c.kind in ('binder', 'list')
        ) t
      ), '[]'::json) as containers,
      (
        select json_build_object(
          'deckCount', count(*)::int,
          'cardCount', coalesce(sum(cs.card_count), 0),
          'valueUsdMinor', coalesce(sum(cs.value_usd_minor), 0),
          'valueEurMinor', coalesce(sum(cs.value_eur_minor), 0)
        )
        from containers c
        join container_stats cs on cs.container_id = c.id
        where c.collection_id = ${root.collectionId} and c.kind = 'deck' and c.deck_state = 'built'
      ) as built_decks,
      (${previewTilesJsonSql(sql`h.container_id = ${root.rootContainerId}`, SHELF_TILE_LIMIT, currency)}) as root_tiles,
      (${previewTilesJsonSql(
        sql`h.container_id in (select id from containers where collection_id = ${root.collectionId} and kind = 'deck' and deck_state = 'built')`,
        SHELF_TILE_LIMIT,
        currency,
      )}) as built_deck_tiles,
      (${recentTilesJsonSql(root.collectionId, RECENTLY_ADDED_LIMIT, currency)}) as recent_tiles,
      (
        select count(*)::int
        from holdings h
        join containers hc on hc.id = h.container_id
        where hc.collection_id = ${root.collectionId} and h.added_at >= now() - interval '7 days'
      ) as added_this_week
  `)

  const data = rows[0]
  const delta = currency === 'usd' ? root.deltaUsd7d : root.deltaEur7d

  const shelves: ShelfData[] = []

  // « All collection » : même container racine et mêmes colonnes
  // `container_stats` que la carte de valeur de l'accueil Compact — le nombre
  // affiché ici et le montant collant ci-dessous coïncident par
  // construction, pas par coïncidence des données.
  shelves.push({
    containerId: root.rootContainerId,
    name: 'All collection',
    meta: `${formatCount(root.cardCount)} cards`,
    valueMinor: currency === 'usd' ? root.valueUsdMinor : root.valueEurMinor,
    notOwned: false,
    tiles: (data?.root_tiles ?? []).map(toTile),
  })

  // Ordre : All collection → binders → Built decks → listes en DERNIER.
  // `data.containers` mélange binders et listes dans un seul ordre SQL
  // (`sort_order, created_at`) — séparés ici en deux passes, chacune gardant
  // cet ordre relatif, plutôt que deux requêtes.
  const containerRows = data?.containers ?? []

  for (const row of containerRows.filter((r) => r.kind === 'binder')) {
    shelves.push({
      containerId: row.id,
      name: row.name,
      meta: `${formatCount(row.cardCount)} cards`,
      valueMinor: currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor,
      notOwned: false,
      tiles: row.tiles.map(toTile),
    })
  }

  const builtDecks = data?.built_decks ?? { deckCount: 0, cardCount: 0, valueUsdMinor: 0, valueEurMinor: 0 }
  // Masquée si 0 deck monté — jamais une étagère vide « 0
  // decks · 0 cards » : le `Collection home` compact masque déjà cette ligne
  // dans les mêmes conditions (`collection-view.tsx`).
  if (builtDecks.deckCount > 0) {
    shelves.push({
      containerId: BUILT_DECKS_SHELF_ID,
      name: 'Built decks',
      meta: `${formatCount(builtDecks.deckCount)} ${builtDecks.deckCount === 1 ? 'deck' : 'decks'} · ${formatCount(builtDecks.cardCount)} cards`,
      valueMinor: currency === 'usd' ? builtDecks.valueUsdMinor : builtDecks.valueEurMinor,
      notOwned: false,
      tiles: (data?.built_deck_tiles ?? []).map(toTile),
    })
  }

  // Listes en dernier : marquées `notOwned`, `meta` porte déjà le suffixe
  // « · not owned » — `Shelf` n'a donc rien à composer, seul le tag
  // « LIST » à côté du titre lui revient.
  for (const row of containerRows.filter((r) => r.kind === 'list')) {
    shelves.push({
      containerId: row.id,
      name: row.name,
      meta: `${formatCount(row.cardCount)} cards · not owned`,
      valueMinor: currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor,
      notOwned: true,
      tiles: row.tiles.map(toTile),
    })
  }

  return {
    rootContainerId: root.rootContainerId,
    value: {
      amountMinor: currency === 'usd' ? root.valueUsdMinor : root.valueEurMinor,
      currency,
      delta7d: delta !== null && delta !== undefined ? Number(delta) : null,
    },
    recentlyAdded: {
      count: data?.added_this_week ?? 0,
      tiles: (data?.recent_tiles ?? []).map(toTile),
    },
    shelves,
  }
}
