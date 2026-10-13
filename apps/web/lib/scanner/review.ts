// Lectures de l'écran de revue du scanner : les cartes scannées telles que
// la recherche les montre, et les containers où les ranger.
import { asc, sql } from 'drizzle-orm'

import { containerStats, containers, type Finish } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { largeUrl, thumbUrl } from '@spellcache/core/images'
import type { ScryfallImageUris } from '@spellcache/core/scryfall/schemas'
import { textArray, uuidArray } from '@spellcache/db/array-param'
import type { Currency } from '@/lib/format/money'
import type { CardSearchItem } from '@/lib/search/search-cards'

// Une pile scannée d'un coup : un booster, un classeur, une boîte de bulk.
export const MAX_SCANNED_LINES = 500

export interface ScannedCard extends CardSearchItem {
  // Finitions de l'impression : la bascule foil n'est proposée que si elle existe.
  finishes: Finish[]
}

interface ScannedCardRow extends Record<string, unknown> {
  id: string
  name: string
  set_code: string
  set_name: string
  set_icon_uri: string | null
  collector_number: string
  rarity: string
  mana_cost: string | null
  type_line: string
  color_identity: string[]
  finishes: Finish[]
  image_uris: ScryfallImageUris | null
  price: string | null
}

export async function getScannedCards(cardIds: string[], currency: Currency): Promise<ScannedCard[]> {
  if (cardIds.length === 0) return []
  const price = currency === 'usd' ? sql`latest_price.usd` : sql`latest_price.eur`
  const { rows } = await db.execute<ScannedCardRow>(sql`
    select
      cards.id,
      cards.name,
      cards.set_code,
      sets.name as set_name,
      sets.icon_svg_uri as set_icon_uri,
      cards.collector_number,
      cards.rarity,
      cards.mana_cost,
      cards.type_line,
      cards.color_identity,
      cards.finishes,
      cards.image_uris,
      ${price} as price
    from cards
    join sets on sets.code = cards.set_code
    left join lateral (
      select usd, eur from card_prices
      where card_prices.card_id = cards.id
      order by day desc
      limit 1
    ) as latest_price on true
    where cards.id = any(${uuidArray(cardIds)})
  `)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    setIconUri: row.set_icon_uri,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    manaCost: row.mana_cost,
    typeLine: row.type_line,
    thumbUrl: thumbUrl(row.id, 'small'),
    imageUrl: largeUrl({ imageUris: row.image_uris }, 'normal'),
    price: row.price === null ? null : Number(row.price),
    colorIdentity: row.color_identity,
    finishes: row.finishes,
  }))
}

// Destinations d'un ajout scanné : la racine de la collection, ses binders
// et ses listes. Jamais un deck : une carte y entre par son écran (zone,
// commandant, verrou d'un deck monté).
export type ScanDestinationKind = 'collection' | 'binder' | 'list'
export const SCAN_DESTINATION_KINDS: ScanDestinationKind[] = ['collection', 'binder', 'list']

export interface ScanDestination {
  id: string
  name: string
  kind: ScanDestinationKind
  cardCount: number
}

const KIND_ORDER: Record<ScanDestinationKind, number> = { collection: 0, binder: 1, list: 2 }

export async function listScanDestinations(collectionId: string): Promise<ScanDestination[]> {
  const rows = await db
    .select({
      id: containers.id,
      name: containers.name,
      kind: containers.kind,
      cardCount: sql<number>`coalesce(${containerStats.cardCount}, 0)`.mapWith(Number),
    })
    .from(containers)
    .leftJoin(containerStats, sql`${containerStats.containerId} = ${containers.id}`)
    .where(
      sql`${containers.collectionId} = ${collectionId} and ${containers.kind} = any(${textArray(SCAN_DESTINATION_KINDS)})`,
    )
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))

  return rows
    .map((row) => ({ ...row, kind: row.kind as ScanDestinationKind }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}
