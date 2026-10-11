// Lecture d'un deck pour la partie de test : la liste des cartes seule, sans
// prix ni disponibilité — `getDeck` calcule tout l'écran du deck, la partie
// n'en a pas besoin. Lecture seule : un `viewer` peut tester un deck qu'il ne
// peut pas modifier.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { cards, containers, holdings } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { largeUrl, thumbUrl } from '@spellcache/core/images'
import { resolveAccess } from '@/lib/collections/authorize'
import type { PlaytestCard, PlaytestDeck } from '@/lib/tools/playtest-state'

// `null` pour un deck introuvable, hors de portée du compte ou qui n'est pas
// un deck : la page répond 404 dans les trois cas, sans dire lequel.
export async function getPlaytestDeck(userId: string, deckId: string): Promise<PlaytestDeck | null> {
  // Paramètre d'URL : validé avant d'atteindre une colonne `uuid`.
  if (!z.string().uuid().safeParse(deckId).success) return null
  const access = await resolveAccess(userId, deckId)
  if (!access) return null

  const [deck] = await db
    .select({ id: containers.id, name: containers.name, kind: containers.kind })
    .from(containers)
    .where(eq(containers.id, deckId))
    .limit(1)
  if (!deck || deck.kind !== 'deck') return null

  const rows = await db
    .select({
      cardId: holdings.cardId,
      qty: holdings.qty,
      zone: holdings.zone,
      isCommander: holdings.isCommander,
      name: cards.name,
      typeLine: cards.typeLine,
      manaCost: cards.manaCost,
      cmc: cards.cmc,
      imageUris: cards.imageUris,
    })
    .from(holdings)
    .innerJoin(cards, eq(cards.id, holdings.cardId))
    .where(and(eq(holdings.containerId, deckId), inArray(holdings.zone, ['main', 'commander'])))
    .orderBy(asc(cards.name), asc(holdings.id))

  const main = new Map<string, number>()
  const commanders: string[] = []
  const deckCards: Record<string, PlaytestCard> = {}

  for (const row of rows) {
    deckCards[row.cardId] ??= {
      cardId: row.cardId,
      name: row.name,
      typeLine: row.typeLine,
      manaCost: row.manaCost,
      cmc: Number(row.cmc),
      thumbUrl: thumbUrl(row.cardId, 'small'),
      imageUrl: largeUrl(row, 'normal'),
    }
    // `is_commander` l'emporte sur `zone`, comme dans `getDeck` : un
    // commandant n'est jamais aussi mélangé dans la bibliothèque. Plusieurs
    // lignes d'une même carte (une par finition) s'additionnent.
    if (row.isCommander || row.zone === 'commander') {
      if (!commanders.includes(row.cardId)) commanders.push(row.cardId)
    } else {
      main.set(row.cardId, (main.get(row.cardId) ?? 0) + row.qty)
    }
  }

  return {
    id: deck.id,
    name: deck.name,
    main: [...main].map(([cardId, qty]) => ({ cardId, qty })),
    commanders,
    cards: deckCards,
  }
}
