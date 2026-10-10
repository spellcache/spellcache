// Lectures du Playtest : la liste des decks de la collection active (écran de
// choix) et les cartes d'un deck (écran de test). Deux requêtes courtes,
// distinctes de `listDecks`/`getDeck` : le Playtest n'a besoin ni de
// légalité, ni de prix, ni de disponibilité — seulement des noms, des
// vignettes et des quantités.
import { sql } from 'drizzle-orm'

import { thumbUrl } from '@spellcache/core/images'
import { db } from '@spellcache/db'
import { activeCollectionIdSql } from '@/lib/collections/active'
import { resolveAccess } from '@/lib/collections/authorize'
import { FORMAT_LABELS, isDeckFormat } from '@/lib/decks/legality'
import type { PlaytestCard, PlaytestDeck } from '@/lib/tools/playtest-state'

export interface PlaytestDeckSummary {
  id: string
  name: string
  formatLabel: string | null
  // Cartes du mainboard seul : celles qui forment la bibliothèque.
  mainboardCount: number
}

interface DeckListSqlRow extends Record<string, unknown> {
  id: string
  name: string
  format: string | null
  mainboardCount: number
}

function formatLabelOf(format: string | null): string | null {
  if (!format) return null
  return isDeckFormat(format) ? FORMAT_LABELS[format] : format
}

export async function listPlaytestDecks(userId: string): Promise<PlaytestDeckSummary[]> {
  const { rows } = await db.execute<DeckListSqlRow>(sql`
    select
      c.id, c.name, c.format,
      coalesce((
        select sum(h.qty)::int from holdings h
        where h.container_id = c.id and h.zone = 'main' and h.is_commander = false
      ), 0) as "mainboardCount"
    from containers c
    where c.collection_id = ${activeCollectionIdSql(sql`${userId}::uuid`)}
      and c.kind = 'deck'
    order by c.sort_order, c.created_at
  `)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    formatLabel: formatLabelOf(row.format),
    mainboardCount: row.mainboardCount,
  }))
}

export interface PlaytestDeckDetail {
  id: string
  name: string
  formatLabel: string | null
  deck: PlaytestDeck
}

interface DeckSqlRow extends Record<string, unknown> {
  kind: string
  name: string
  format: string | null
}

interface SlotSqlRow extends Record<string, unknown> {
  holdingId: string
  cardId: string
  name: string
  qty: number
  zone: string
  isCommander: boolean
}

function expand(row: SlotSqlRow): PlaytestCard[] {
  return Array.from({ length: row.qty }, (_, n) => ({
    id: `${row.holdingId}:${n}`,
    cardId: row.cardId,
    name: row.name,
    thumbUrl: thumbUrl(row.cardId, 'small'),
  }))
}

// `null` : deck introuvable ou hors des collections du compte — la page
// répond 404 dans les deux cas, sans dire lequel.
export async function getPlaytestDeck(
  userId: string,
  deckId: string,
): Promise<PlaytestDeckDetail | null> {
  // Lecture seule : un `viewer` peut tester un deck qu'il ne peut pas
  // modifier.
  const access = await resolveAccess(userId, deckId)
  if (!access) return null

  const { rows: deckRows } = await db.execute<DeckSqlRow>(sql`
    select kind, name, format from containers where id = ${deckId}
  `)
  const deckRow = deckRows[0]
  if (!deckRow || deckRow.kind !== 'deck') return null

  const { rows: slots } = await db.execute<SlotSqlRow>(sql`
    select
      h.id as "holdingId", h.card_id as "cardId", cd.name, h.qty, h.zone,
      h.is_commander as "isCommander"
    from holdings h
    join cards cd on cd.id = h.card_id
    where h.container_id = ${deckId} and h.qty > 0
    order by cd.name asc, h.id asc
  `)

  // `is_commander` reste la source de vérité du commandant, comme dans
  // `getDeck` (`app/(app)/decks/[id]/deck-data.ts`).
  const commanders = slots.filter((row) => row.isCommander || row.zone === 'commander')
  const mainboard = slots.filter(
    (row) => !row.isCommander && row.zone !== 'commander' && row.zone !== 'side',
  )

  return {
    id: deckId,
    name: deckRow.name,
    formatLabel: formatLabelOf(deckRow.format),
    deck: {
      cards: mainboard.flatMap(expand),
      commanders: commanders.flatMap(expand),
      freeFirstMulligan: deckRow.format === 'commander',
    },
  }
}
