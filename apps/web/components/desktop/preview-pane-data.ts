// Données du panneau d'aperçu desktop (`getCardPreview`). Trois choses que
// la feuille de carte mobile ne porte pas : où la carte est détenue ailleurs
// dans la collection, ses autres impressions, et son texte de catalogue
// complet.
//
// Quatre requêtes bornées, jamais une par ligne survolée : `Other printings`
// est plafonné à trois vignettes pour exactement cette raison, et l'appelant ne
// déclenche cette lecture que sur la ligne *sélectionnée* — jamais au survol.
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'

import {
  cardPrices,
  cards,
  containers,
  holdings,
  sets,
  users,
  type Condition,
  type Finish,
} from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'
import type { Currency } from '@/lib/format/money'
import { largeUrl, thumbUrl } from '@spellcache/core/images'

export interface CardPreview {
  cardId: string
  name: string
  manaCost: string | null
  typeLine: string
  setCode: string
  setName: string
  // Icône officielle du set (`sets.icon_svg_uri`), `null` si absente.
  setIconUri: string | null
  collectorNumber: string
  rarity: string
  oracleText: string | null
  artist: string | null
  // Image `normal` servie **par le CDN Scryfall** (le proxy est réservé aux
  // vignettes de liste) — lue depuis `cards.image_uris`, remplie par le bulk,
  // jamais construite à la main (docs/development.md).
  //
  // `null` possible : `cards.image_uris` est nullable dans le modèle livré
  // (`packages/db/src/schema.ts`), et la feuille de carte mobile traite
  // déjà ce cas. Le panneau montre alors le cadre vide plutôt qu'un
  // `src` invalide.
  imageUrl: string | null
  // Haute définition pour l'agrandissement (ZoomableCardImage).
  zoomImageUrl: string | null
  priceMinor: number | null
  holding: { holdingId: string; qty: number; finish: Finish; condition: Condition } | null
  inCollection: Array<{ containerId: string; containerName: string; qty: number }>
  // Nombre de decks montés de la collection qui utilisent cette carte (par
  // oracle, toutes impressions confondues) — la ligne « Used in N built
  // decks ».
  builtDeckCount: number
  otherPrintings: Array<{
    cardId: string
    setCode: string
    thumbUrl: string
    priceMinor: number | null
  }>
}

// Six vignettes au plus.
const MAX_OTHER_PRINTINGS = 6

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

function toMinor(raw: string | null): number | null {
  return raw === null ? null : Math.round(Number(raw) * 100)
}

// Prix unitaire du jour le plus récent connu, selon la finition et la
// devise du compte — même sémantique que `unitPriceMinor` de
// `holdings-data.ts`, lue ici sur une seule carte.
function pickPrice(
  row: { usd: string | null; usdFoil: string | null; eur: string | null; eurFoil: string | null } | undefined,
  currency: Currency,
  finish: Finish,
): number | null {
  if (!row) return null
  if (finish === 'nonfoil') return toMinor(currency === 'usd' ? row.usd : row.eur)
  return toMinor(currency === 'usd' ? row.usdFoil : row.eurFoil)
}

export async function getCardPreview(
  userId: string,
  cardId: string,
  containerId: string,
): Promise<CardPreview> {
  // Unique chemin d'autorisation (docs/development.md) — il rend aussi la collection
  // dont dépend le bloc `In your collection` ci-dessous : jamais une seconde
  // résolution à partir d'un `collectionId` reçu du client.
  const access = await requireContainerAccess(userId, containerId, 'read')

  const [card] = await db
    .select({
      id: cards.id,
      oracleId: cards.oracleId,
      name: cards.name,
      manaCost: cards.manaCost,
      typeLine: cards.typeLine,
      setCode: cards.setCode,
      setName: sets.name,
      setIconUri: sets.iconSvgUri,
      collectorNumber: cards.collectorNumber,
      rarity: cards.rarity,
      oracleText: cards.oracleText,
      artist: cards.artist,
      imageUris: cards.imageUris,
    })
    .from(cards)
    .innerJoin(sets, eq(sets.code, cards.setCode))
    .where(eq(cards.id, cardId))
    .limit(1)

  if (!card) throw new Error(`Card ${cardId} not found.`)

  const [priceSourceRow] = await db
    .select({ priceSource: users.priceSource })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const currency = toCurrency(priceSourceRow?.priceSource ?? 'cardmarket_eur')

  // La ligne du container courant. Un container peut détenir la même carte
  // en plusieurs finitions/états (`holdings_container_card_finish_idx`) :
  // l'ordre est explicite pour que cette lecture soit déterministe,
  // et les contrôles éditables du panneau se lient de toute façon à la
  // ligne réellement sélectionnée dans la liste — elle seule sait de
  // quelle finition il s'agit.
  const [holdingRow] = await db
    .select({
      holdingId: holdings.id,
      qty: holdings.qty,
      finish: holdings.finish,
      condition: holdings.condition,
    })
    .from(holdings)
    .where(and(eq(holdings.containerId, containerId), eq(holdings.cardId, cardId)))
    .orderBy(asc(holdings.finish), asc(holdings.condition), asc(holdings.addedAt), asc(holdings.id))
    .limit(1)

  const finish: Finish = holdingRow?.finish ?? 'nonfoil'

  const [priceRow] = await db
    .select({
      usd: cardPrices.usd,
      usdFoil: cardPrices.usdFoil,
      eur: cardPrices.eur,
      eurFoil: cardPrices.eurFoil,
    })
    .from(cardPrices)
    .where(eq(cardPrices.cardId, cardId))
    .orderBy(desc(cardPrices.day))
    .limit(1)

  // Où la carte est détenue ailleurs dans la **collection** (jamais au-delà :
  // `containers.collection_id` est le seul lien, il n'existe pas de
  // `user_id` sur `containers` — docs/development.md). Agrégé en une requête, une
  // ligne par container, pas une requête par container.
  // Par oracle, toutes impressions confondues : les copies sont comptées par
  // nom de carte, pas par impression.
  const inCollectionRows = await db
    .select({
      containerId: containers.id,
      containerName: containers.name,
      qty: sql<number>`sum(${holdings.qty})::int`,
    })
    .from(holdings)
    .innerJoin(containers, eq(containers.id, holdings.containerId))
    .innerJoin(cards, eq(cards.id, holdings.cardId))
    .where(and(eq(containers.collectionId, access.collectionId), eq(cards.oracleId, card.oracleId)))
    .groupBy(containers.id, containers.name, containers.sortOrder, containers.createdAt)
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))

  // « Used in N built decks » : decks montés de la collection qui tiennent
  // au moins une impression de cette carte.
  const [deckUsageRow] = await db
    .select({ count: sql<number>`count(distinct ${containers.id})::int` })
    .from(holdings)
    .innerJoin(containers, eq(containers.id, holdings.containerId))
    .innerJoin(cards, eq(cards.id, holdings.cardId))
    .where(
      and(
        eq(containers.collectionId, access.collectionId),
        eq(containers.kind, 'deck'),
        eq(containers.deckState, 'built'),
        eq(cards.oracleId, card.oracleId),
      ),
    )

  // Autres impressions de la même carte : `oracle_id` est ce qui les relie
  // — jamais le nom, qui n'est pas une clé. Trois au plus, avec leur
  // prix du jour lu par une jointure latérale bornée, pas par une requête
  // supplémentaire par vignette.
  const printingRows = await db
    .select({
      cardId: cards.id,
      setCode: cards.setCode,
      usd: cardPrices.usd,
      usdFoil: cardPrices.usdFoil,
      eur: cardPrices.eur,
      eurFoil: cardPrices.eurFoil,
    })
    .from(cards)
    .leftJoin(
      cardPrices,
      sql`${cardPrices.cardId} = ${cards.id} and ${cardPrices.day} = (
        select max(day) from card_prices where card_prices.card_id = ${cards.id}
      )`,
    )
    .where(and(eq(cards.oracleId, card.oracleId), ne(cards.id, cardId)))
    .orderBy(asc(cards.setCode), asc(cards.collectorNumber))
    .limit(MAX_OTHER_PRINTINGS)

  return {
    cardId: card.id,
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    setCode: card.setCode,
    setName: card.setName,
    setIconUri: card.setIconUri,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    oracleText: card.oracleText,
    artist: card.artist,
    imageUrl: largeUrl(card, 'normal'),
    zoomImageUrl: largeUrl(card, 'png'),
    priceMinor: pickPrice(priceRow, currency, finish),
    holding: holdingRow ?? null,
    inCollection: inCollectionRows,
    builtDeckCount: deckUsageRow?.count ?? 0,
    // Vignettes de liste ⇒ proxy interne, jamais le CDN — l'inverse exact de
    // `imageUrl` ci-dessus.
    otherPrintings: printingRows.map((row) => ({
      cardId: row.cardId,
      setCode: row.setCode,
      thumbUrl: thumbUrl(row.cardId, 'small'),
      priceMinor: pickPrice(row, currency, 'nonfoil'),
    })),
  }
}
