// Habillage d'un deck, une seule règle pour la ligne de liste (`DeckRow`), la
// tuile d'étagère (`DeckCard`) et le fond de l'écran du deck
// (`DeckBackdropArt`) — sans elle, un deck changeait d'image en s'ouvrant.
//
// Ordre de `lookFromHeader` (components/binders/container-action-sheets.tsx),
// celui que la feuille `Deck look` affiche : la carte choisie, puis le dégradé
// choisi (des données anciennes portent les deux : la carte l'emporte), puis
// l'illustration du commandant. Rien de tout cela : à chaque vue son repli
// (identité colorée pour la liste et la tuile, aucun fond pour l'écran).
import { thumbUrl } from '@spellcache/core/images'

import { isGradientKey, type GradientKey } from '@/lib/binders/gradients'

export interface DeckLook {
  artUrl: string | null
  coverGradient: GradientKey | null
}

export function resolveDeckLook(input: {
  coverCardId: string | null
  coverGradient: string | null
  commanderCardId: string | null
}): DeckLook {
  if (input.coverCardId) return { artUrl: thumbUrl(input.coverCardId, 'art_crop'), coverGradient: null }
  if (input.coverGradient && isGradientKey(input.coverGradient)) {
    return { artUrl: null, coverGradient: input.coverGradient }
  }
  if (input.commanderCardId) {
    return { artUrl: thumbUrl(input.commanderCardId, 'art_crop'), coverGradient: null }
  }
  return { artUrl: null, coverGradient: null }
}
