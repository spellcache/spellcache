// Nom de l'artiste d'une carte du catalogue, pour créditer une illustration
// `art_crop` affichée en grand fond (en-tête de deck, de binder, page
// publique). L'`art_crop` ne porte ni l'artiste ni le copyright de la carte :
// les directives d'image de Scryfall demandent alors de créditer l'artiste
// ailleurs sur la page.
import { eq } from 'drizzle-orm'

import { cards } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export async function getCardArtist(cardId: string | null): Promise<string | null> {
  if (!cardId) return null
  const [row] = await db
    .select({ artist: cards.artist })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1)
  return row?.artist ?? null
}
