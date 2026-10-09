// Requête de la vue étagères de l'onglet `Decks`. `FolderShelf`,
// `DeckCardData` et `getFolderShelves` appartiennent à
// `app/(app)/decks/folders-view.tsx` ; ils vivent ici pour la même raison
// que `decks-data.ts`/`decks-view.tsx` et
// `collection-data.ts`/`shelves-view.tsx` : `folders-view.tsx` est un
// îlot client (`'use client'` — glisser-déposer, menu contextuel, mises à
// jour optimistes) et ne peut pas importer `@spellcache/db` sans tirer `pg` dans
// le bundle navigateur. Le fichier de vue réexporte les deux types pour que
// l'appelant les trouve à côté de la vue.
//
// Le statut de chaque carte vient exclusivement d'`evaluateDeck`
// (`lib/decks/legality.ts`), aucun champ nouveau. Aucune règle de légalité
// n'est écrite ici.
import { and, eq, sql } from 'drizzle-orm'

import {
  collectionMembers,
  deckFolders,
  users,
  type DeckState,
  type Legality,
} from '@spellcache/db/schema'
import { deckColorIdentity } from '@/lib/decks/identity'
import { evaluateDeck, isDeckFormat, type DeckStatus } from '@/lib/decks/legality'
import type { Currency } from '@/lib/format/money'
import type { GradientKey } from '@/lib/binders/gradients'
import { resolveDeckLook } from '@/lib/decks/deck-look'
import { db } from '@spellcache/db'
import { activeMembershipOf } from '@/lib/collections/active'
import { UNSORTED_SHELF_NAME } from '@/lib/decks/unsorted-folder'

export interface FolderShelf {
  folderId: string | null // null = Unsorted
  name: string
  deckCount: number
  decks: DeckCardData[] // au plus 10 ; le reste derrière « See all »
}

export interface DeckCardData {
  id: string
  name: string
  // Habillage résolu par `resolveDeckLook` (lib/decks/deck-look.ts), le même
  // que l'écran du deck. Les deux `null` : la tuile retombe sur l'identité
  // colorée.
  artUrl: string | null
  coverGradient: GradientKey | null
  colorIdentity: string[]
  priceMinor: number
  status: DeckStatus // celui d'`evaluateDeck`, jamais recalculé ici
  // Texte brut de `containers.format` — voir le
  // commentaire de `DeckDetail.formatRaw` (`app/(app)/decks/[id]/deck-data.ts`).
  formatRaw: string | null
  // Nombre de cartes du deck, repli d'affichage quand `colorIdentity` est
  // vide : `{N} cards` à la place des pips.
  cardCount: number
}

export interface FolderShelvesResult {
  shelves: FolderShelf[]
  currency: Currency
}

// `UNSORTED_SHELF_NAME` et `UNSORTED_FOLDER_SLUG` vivent dans
// `lib/decks/unsorted-folder.ts` (sans dépendance serveur) ; réexportés ici
// pour les appelants serveur et les tests qui les lisaient à cet endroit.
export { UNSORTED_FOLDER_SLUG, UNSORTED_SHELF_NAME } from '@/lib/decks/unsorted-folder'

// Au plus 10 decks par étagère ; le reste
// vit derrière `See all`.
const SHELF_DECK_LIMIT = 10

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  // Unique source de vérité pour la devise (docs/development.md) — même ternaire que
  // `decks-data.ts` et `collection-data.ts`, dupliqué plutôt que
  // partagé pour les mêmes raisons qu'eux.
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

interface DeckCardSqlRow {
  id: string
  name: string
  format: string | null
  deckState: DeckState | null
  // Agrégées en JSON (`json_build_object`), pas sélectionnées en colonne de
  // premier niveau : le pilote les rend donc déjà en nombre JS après
  // `JSON.parse`, contrairement aux `bigint` de premier niveau de
  // `decks-data.ts`. `Number()` reste appliqué en sortie, jamais un cast.
  valueUsdMinor: number
  valueEurMinor: number
  commander: { cardId: string; colorIdentity: string[] } | null
  coverCardId: string | null
  coverGradient: string | null
  cards: Array<{
    cardId: string
    name: string
    qty: number
    legalities: Record<string, Legality>
    colorIdentity: string[]
    typeLine: string
  }>
}

interface FolderShelfSqlRow extends Record<string, unknown> {
  folderId: string | null
  name: string
  deckCount: number
  decks: DeckCardSqlRow[]
}

// Deux requêtes SQL au total : la première résout l'accès (collection du
// compte, via `collection_members` — l'unique chemin d'autorisation,
// docs/development.md) et la devise, la seconde ramène toutes les étagères.
//
// La seconde n'a qu'une seule jointure latérale, corrélée à l'étagère
// courante (au plus 10 decks par étagère en une requête latérale unique —
// pas de N+1 sur le nombre de dossiers). Elle porte deux valeurs : le compte
// total de decks du dossier (un nombre de decks, pas de cartes) et les 10
// premiers seulement, dont les holdings nécessaires à `evaluateDeck`
// reviennent en sous-requête JSON corrélée, même patron que `listDecks`.
// Le `limit` est posé sur
// la sous-requête des containers, avant l'agrégation JSON : les holdings ne
// sont donc jamais lus pour le 11e deck d'un dossier.
//
// L'étagère `Unsorted` est produite par le même `union all` que les
// dossiers, avec `folderId = null`, pour qu'un seul aller-retour couvre les
// deux cas : `c.folder_id is not distinct from f.id` fait correspondre
// `null` à `null` (`= null` ne le ferait pas). Elle est toujours présente,
// y compris vide — l'état vide (aucun dossier ⇒ une seule étagère
// `Unsorted`) en dépend, et un deck créé sans dossier y tombe.
// `order by f.position nulls last` la place toujours en dernier.
export async function getFolderShelves(userId: string): Promise<FolderShelvesResult> {
  const [root] = await db
    .select({
      collectionId: collectionMembers.collectionId,
      priceSource: users.priceSource,
    })
    .from(collectionMembers)
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .where(activeMembershipOf(userId))
    .limit(1)

  // `requireSession()` (lib/auth-guards.ts) appelle `bootstrapCollection`
  // avant tout accès à cet écran.
  if (!root) {
    throw new Error(`User ${userId} has no collection.`)
  }

  const currency = toCurrency(root.priceSource)
  const collectionId = root.collectionId

  const { rows } = await db.execute<FolderShelfSqlRow>(sql`
    select
      f.id as "folderId",
      f.name as "name",
      shelf."deckCount" as "deckCount",
      shelf.decks as "decks"
    from (
      select id, name, position
      from deck_folders
      where collection_id = ${collectionId}
      union all
      select null::uuid as id, ${UNSORTED_SHELF_NAME}::text as name, null::integer as position
    ) f
    left join lateral (
      select
        (
          select count(*)::int
          from containers cc
          where cc.collection_id = ${collectionId}
            and cc.kind = 'deck'
            and cc.deck_state is distinct from 'built'
            and cc.folder_id is not distinct from f.id
        ) as "deckCount",
        coalesce((
          select json_agg(json_build_object(
            'id', picked.id,
            'name', picked.name,
            'format', picked.format,
            'deckState', picked.deck_state,
            'coverCardId', picked.cover_card_id,
            'coverGradient', picked.cover_gradient,
            'valueUsdMinor', picked.value_usd_minor,
            'valueEurMinor', picked.value_eur_minor,
            'commander', (
              select json_build_object('cardId', h.card_id, 'colorIdentity', cd.color_identity)
              from holdings h
              join cards cd on cd.id = h.card_id
              where h.container_id = picked.id and h.is_commander = true
              limit 1
            ),
            'cards', coalesce((
              select json_agg(json_build_object(
                'cardId', h.card_id,
                'name', cd.name,
                'qty', h.qty,
                'legalities', cd.legalities,
                'colorIdentity', cd.color_identity,
                'typeLine', cd.type_line
              ))
              from holdings h
              join cards cd on cd.id = h.card_id
              where h.container_id = picked.id
            ), '[]'::json)
          ) order by picked.sort_order, picked.created_at)
          from (
            select c.id, c.name, c.format, c.deck_state, c.sort_order, c.created_at,
                   c.cover_card_id, c.cover_gradient,
                   cs.value_usd_minor, cs.value_eur_minor
            from containers c
            join container_stats cs on cs.container_id = c.id
            where c.collection_id = ${collectionId}
              and c.kind = 'deck'
              -- L'onglet Decks est l'atelier : un deck monté a quitté cette
              -- zone pour Collection > Decks, où ses cartes sont des entrées
              -- réelles de la collection.
              and c.deck_state is distinct from 'built'
              and c.folder_id is not distinct from f.id
            order by c.sort_order, c.created_at
            limit ${SHELF_DECK_LIMIT}
          ) picked
        ), '[]'::json) as decks
    ) shelf on true
    order by f.position asc nulls last, f.name asc
  `)

  const shelves: FolderShelf[] = rows.map((row) => ({
    folderId: row.folderId,
    name: row.name,
    deckCount: Number(row.deckCount),
    decks: (row.decks ?? []).map((deck) => toDeckCard(deck, currency)),
  }))

  return { shelves, currency }
}

function toDeckCard(row: DeckCardSqlRow, currency: Currency): DeckCardData {
  const format = row.format && isDeckFormat(row.format) ? row.format : null
  const commander = row.commander
  // Même repli défensif que `decks-data.ts` : `deck_state` reste
  // `text | null` au niveau du schéma, même si tout deck créé aujourd'hui la
  // porte.
  const deckState: DeckState = row.deckState ?? 'plan'
  const cards = row.cards ?? []

  return {
    id: row.id,
    name: row.name,
    ...resolveDeckLook({
      coverCardId: row.coverCardId,
      coverGradient: row.coverGradient,
      commanderCardId: commander?.cardId ?? null,
    }),
    colorIdentity: deckColorIdentity({
      commanderColorIdentity: commander?.colorIdentity ?? null,
      cardColorIdentities: cards.map((card) => card.colorIdentity),
    }),
    priceMinor: Number(currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor),
    status: evaluateDeck({
      format,
      deckState,
      cards,
      commander: commander ? { colorIdentity: commander.colorIdentity } : null,
    }),
    formatRaw: row.format,
    cardCount: cards.reduce((sum, card) => sum + card.qty, 0),
  }
}

export interface FolderPage {
  // `null` = `Unsorted`, le dossier virtuel des decks sans `folder_id` : son
  // écran `See all` liste ces decks mais ne se renomme ni ne se supprime.
  folderId: string | null
  name: string
}

export function unsortedFolderPage(): FolderPage {
  return { folderId: null, name: UNSORTED_SHELF_NAME }
}

// En-tête de l'écran `See all`, titré du nom du dossier. Le dossier est
// résolu par la collection du compte, pas
// par son seul `id` : un `folderId` d'URL ne doit jamais laisser lire le
// dossier d'une autre collection — même garde que `requireContainerAccess`
// (`lib/collections/authorize.ts`), joint ici sur `collection_members`,
// jamais un second chemin d'autorisation (docs/development.md).
export async function getFolder(
  userId: string,
  folderId: string,
): Promise<FolderPage | null> {
  const [row] = await db
    .select({ id: deckFolders.id, name: deckFolders.name })
    .from(deckFolders)
    .innerJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, deckFolders.collectionId),
        eq(collectionMembers.userId, userId),
      ),
    )
    .where(eq(deckFolders.id, folderId))
    .limit(1)

  return row ? { folderId: row.id, name: row.name } : null
}
