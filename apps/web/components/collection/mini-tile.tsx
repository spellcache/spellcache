// Tuile d'illustration pure, 76×106, utilisée par la
// section `Recently added` de l'accueil Shelves.
// `lazy` (`loading="lazy"` sur les tuiles au-delà de la première rangée
// visible) : la rangée `Recently added` est elle-même la
// toute première rangée de tuiles de l'écran, avant même la première
// étagère (`shelves-view.tsx` passe `lazy={false}`) — le paramètre existe
// pour que l'appelant décide explicitement plutôt que de laisser l'attribut
// absent.
//
// Rendue en `<button>` (taper une tuile ouvre la feuille de carte), comme `GridTileShelf`
// (`mf-grid-tile.tsx`) : `shelves-view.tsx` passe le même contrat
// `ShelfTile` (`cardId`/`name`/`artUrl`/`priceMinor`) que les tuiles
// d'étagère à la même `CardPreviewSheet` déjà montée, aucune obstacle de
// contrat. `type="button"` et le reset universel `*` du preflight Tailwind
// (`margin/padding/border: 0`) laissent la boîte 76×106 inchangée — voir
// `tests/unit/row-heights.test.tsx`.
//
// Deuxième taille, propre au desktop : les trois vignettes `Other printings`
// du panneau d'aperçu font 46×64. Une variante de taille sur ce même
// composant plutôt qu'une seconde tuile : le design utilise littéralement
// `MiniTile` aux deux endroits.
export function MiniTile({
  artUrl,
  name,
  onOpen,
  lazy = false,
  size = 'shelf',
  disabled = false,
}: {
  artUrl: string
  name: string
  onOpen: () => void
  lazy?: boolean
  size?: 'shelf' | 'printing'
  // Vignette montrée mais sans destination (les trois `Other printings` du
  // panneau d'aperçu) : `disabled` la sort de l'ordre de
  // tabulation et l'estompe, au même titre que les autres affordances
  // inertes de cet écran — plutôt qu'un bouton cliquable sans effet.
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`flex-shrink-0 overflow-hidden rounded-tile-art bg-surface-2 text-left disabled:opacity-60 ${
        size === 'printing' ? 'h-printing-tile w-printing-tile' : 'h-mini-tile w-mini-tile'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
      <img
        src={artUrl}
        alt={name}
        loading={lazy ? 'lazy' : 'eager'}
        className="h-full w-full object-contain"
      />
    </button>
  )
}
