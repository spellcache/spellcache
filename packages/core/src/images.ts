// Seule façon d'obtenir une URL d'image de carte dans l'app. Les
// vignettes passent par le proxy sur disque ; les grandes images sont servies
// directement par le CDN Scryfall, dont les URLs viennent du bulk (jamais
// construites à la main — docs/development.md).
//
// Partagé avec le worker : aucune dépendance au schéma de base, la carte est
// typée par sa seule forme utile.
import type { ScryfallImageUris } from './scryfall/schemas.ts'

export type ThumbVariant = 'small' | 'art_crop'
export type LargeVariant = 'normal' | 'png'

export function thumbUrl(cardId: string, variant: ThumbVariant): string {
  return `/api/card-image/${cardId}/${variant}`
}

export function largeUrl(
  card: { imageUris: ScryfallImageUris | null },
  variant: LargeVariant,
): string | null {
  return card.imageUris?.[variant] ?? null
}
