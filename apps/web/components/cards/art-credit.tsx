// Crédit de l'artiste sous le titre d'un écran dont le fond est une
// illustration `art_crop` (lib/cards/artist.ts). Mêmes tokens que la ligne
// de méta voisine : aucun élément visuel nouveau.
export function ArtCredit({ artist }: { artist: string | null }) {
  if (!artist) return null
  return <div className="mt-4 text-meta text-text-2">Art by {artist}</div>
}
