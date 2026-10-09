// Requête de l'écran `Decks`. Une seule requête agrégée pour la liste
// (recalculer le statut deck par deck avec une requête chacun fabriquerait un
// N+1 dès quatre decks) — les holdings de
// chaque deck (nécessaires à `evaluateDeck`, qui reste pur et ne lit jamais
// la base lui-même) reviennent en sous-requête JSON corrélée, même patron
// que `topValueTilesJsonSql` (`app/(app)/collection/collection-data.ts`).
// `container_stats` reste l'unique source du compteur de cartes et de la
// valeur affichés (docs/development.md : « le bandeau de valeur lit une ligne, il
// n'agrège jamais » ) — seules la légalité et l'identité colorée, qui ne
// peuvent pas être précalculées génériquement par format, lisent les
// holdings eux-mêmes (la légalité vient du catalogue).
import { eq, sql } from 'drizzle-orm'

import { collectionMembers, users, type DeckState, type Legality } from '@spellcache/db/schema'
import { deckColorIdentity } from '@/lib/decks/identity'
import {
  evaluateDeck,
  isDeckFormat,
  type DeckFormat,
  type DeckStatus,
} from '@/lib/decks/legality'
import type { Currency } from '@/lib/format/money'
import type { GradientKey } from '@/lib/binders/gradients'
import { resolveDeckLook } from '@/lib/decks/deck-look'
import { db } from '@spellcache/db'
import { activeMembershipOf } from '@/lib/collections/active'

export interface DeckSummary {
  id: string
  name: string
  format: DeckFormat | null
  // Texte brut de `containers.format` — voir
  // le commentaire de `DeckDetail.formatRaw` (`app/(app)/decks/[id]/deck-data.ts`).
  formatRaw: string | null
  deckState: DeckState
  cardCount: number
  valueMinor: number
  colorIdentity: string[]
  // Habillage résolu par `resolveDeckLook` (lib/decks/deck-look.ts), le même
  // que l'écran du deck : illustration choisie ou du commandant, sinon
  // dégradé choisi. Les deux `null` : la ligne retombe sur l'identité colorée.
  artUrl: string | null
  coverGradient: GradientKey | null
  status: DeckStatus
}

export interface DeckCounts {
  all: number
  legal: number
  needsWork: number
}

export interface DeckListResult {
  decks: DeckSummary[]
  counts: DeckCounts
  currency: Currency
}

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  // Unique source de vérité pour la devise (docs/development.md) : `tcgplayer_usd` ⇒
  // $, `cardmarket_eur` ⇒ €. Même correspondance que
  // `app/(app)/collection/collection-data.ts`, dupliquée plutôt que
  // partagée — un ternaire à deux branches, hors du périmètre commun de
  // cette feature.
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

interface DeckCardRow {
  cardId: string
  name: string
  qty: number
  legalities: Record<string, Legality>
  colorIdentity: string[]
  typeLine: string
}

interface DeckSqlRow extends Record<string, unknown> {
  id: string
  name: string
  format: string | null
  deckState: DeckState | null
  cardCount: number
  // `container_stats.value_usd_minor`/`value_eur_minor` sont `bigint` (int8,
  // `packages/db/src/schema.ts`). Sélectionnées ici comme colonnes de premier niveau d'un
  // `db.execute` brut, elles échappent au mapping `mode: 'number'` de
  // Drizzle (qui ne s'applique qu'aux requêtes construites par le query
  // builder) — `node-postgres` renvoie un int8 en `string` par défaut, faute
  // de `setTypeParser` dans `packages/db/src/client.ts`. Contrairement à `commander`/`cards`
  // ci-dessous (agrégés en JSON via `json_build_object`/`json_agg`, où le
  // pilote reçoit déjà un nombre JS après `JSON.parse`), ces deux colonnes
  // reviennent en chaîne — converties explicitement plus bas, jamais castées.
  valueUsdMinor: string
  valueEurMinor: string
  commander: { cardId: string; colorIdentity: string[] } | null
  coverCardId: string | null
  coverGradient: string | null
  cards: DeckCardRow[]
}

// Résout deux à la fois : le statut calculé par `evaluateDeck` (pur) tombe
// dans l'un de deux paniers pour les puces de filtre (`All · N`, `Legal · N`,
// `Needs work · N`) — `built`/`legal` sous « Legal », `needsWork`/`noFormat`
// sous « Needs work ». Le design validé le confirme par le calcul : sur ses
// 4 decks d'exemple, un seul est `built`+légal (« Mono-red burn ») et compte
// sous `Legal · 1`, tandis que les deux `needsWork` et le seul `noFormat`
// (« Draft leftovers ») totalisent `Needs work · 3` — un deck sans format
// « a aussi besoin de travail », il ne forme pas un troisième panier.
function isLegalBucket(kind: DeckStatus['kind']): boolean {
  return kind === 'legal' || kind === 'built'
}

// `options.built` sépare les deux zones de decks de l'application, et c'est
// la seule chose qui les sépare — même requête, mêmes lignes, même calcul de
// légalité :
//   - `true`  → `Collection › Decks`, les decks **montés**, dont les cartes
//     sont des entrées réelles de la collection ;
//   - `false` → l'onglet `Decks`, l'atelier : plans, imports, decks en cours
//     d'assemblage, qui n'ont encore rien pris à la collection.
// Omis, la requête ne filtre pas (aucun écran n'en a besoin aujourd'hui, mais
// un total ou un export le voudrait).
//
// `options.folderId` : l'écran `See all`
// d'un dossier rend la **même** liste verticale que cet écran, avec les
// mêmes lignes `DeckRow` — il restreint donc cette requête plutôt que d'en
// écrire une seconde qui divergerait au premier changement de statut ou de
// devise. `null` restreint aux decks **sans** dossier — le `See all` de
// l'étagère `Unsorted` (demande produit, 2026-09-06). Sans l'option, la
// requête est identique à celle de l'écran `Decks`,
// au prédicat près (`true`). `counts` reste calculé sur les decks réellement
// ramenés : le dossier n'affiche pas de puces de filtre, l'écran `Decks` les
// affiche toujours sur la collection entière (aucun appelant ne passe
// `folderId` là-bas).
export async function listDecks(
  userId: string,
  options: { folderId?: string | null; built?: boolean } = {},
): Promise<DeckListResult> {
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
  // avant tout accès à cet écran : un compte
  // qui atteint cet écran est nécessairement déjà membre d'une collection.
  if (!root) {
    throw new Error(`User ${userId} has no collection.`)
  }

  const currency = toCurrency(root.priceSource)

  const { rows } = await db.execute<DeckSqlRow>(sql`
    select
      c.id, c.name, c.format,
      c.deck_state as "deckState",
      c.cover_card_id as "coverCardId",
      c.cover_gradient as "coverGradient",
      cs.card_count as "cardCount",
      cs.value_usd_minor as "valueUsdMinor",
      cs.value_eur_minor as "valueEurMinor",
      (
        select json_build_object('cardId', h.card_id, 'colorIdentity', cd.color_identity)
        from holdings h
        join cards cd on cd.id = h.card_id
        where h.container_id = c.id and h.is_commander = true
        limit 1
      ) as commander,
      coalesce((
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
        where h.container_id = c.id
      ), '[]'::json) as cards
    from containers c
    join container_stats cs on cs.container_id = c.id
    where c.collection_id = ${root.collectionId} and c.kind = 'deck'
      and ${
        options.folderId === undefined
          ? sql`true`
          : options.folderId === null
            ? sql`c.folder_id is null`
            : sql`c.folder_id = ${options.folderId}`
      }
      and ${
        options.built === undefined
          ? sql`true`
          : options.built
            ? sql`c.deck_state = 'built'`
            : sql`c.deck_state is distinct from 'built'`
      }
    order by c.sort_order, c.created_at
  `)

  const decks: DeckSummary[] = []
  let legal = 0
  let needsWork = 0

  for (const row of rows) {
    const format = row.format && isDeckFormat(row.format) ? row.format : null
    const commander = row.commander
    // `containers.deck_state` reste `text | null` au niveau du schéma
    // (colonne partagée avec les autres `kind`, qui la laissent à `null`) —
    // tout container `kind = 'deck'` la reçoit à la création
    // (`createDeckAction`), `'plan'` est
    // donc un repli défensif, jamais la valeur réellement lue en pratique.
    const deckState: DeckState = row.deckState ?? 'plan'
    const status = evaluateDeck({
      format,
      deckState,
      cards: row.cards,
      commander: commander ? { colorIdentity: commander.colorIdentity } : null,
    })

    const colorIdentity = deckColorIdentity({
      commanderColorIdentity: commander?.colorIdentity ?? null,
      cardColorIdentities: row.cards.map((card) => card.colorIdentity),
    })

    if (isLegalBucket(status.kind)) legal += 1
    // `noRules` (format posé mais sans règles — tout sauf Commander) ne
    // compte dans aucun des deux paniers : visible sous `All` seulement.
    else if (status.kind !== 'noRules') needsWork += 1

    decks.push({
      id: row.id,
      name: row.name,
      format,
      formatRaw: row.format,
      deckState,
      cardCount: row.cardCount,
      valueMinor: Number(currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor),
      colorIdentity,
      ...resolveDeckLook({
        coverCardId: row.coverCardId,
        coverGradient: row.coverGradient,
        commanderCardId: commander?.cardId ?? null,
      }),
      status,
    })
  }

  return {
    decks,
    counts: { all: decks.length, legal, needsWork },
    currency,
  }
}
