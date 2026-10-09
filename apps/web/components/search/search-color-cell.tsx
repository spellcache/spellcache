'use client'

// Case de couleur de `SearchFiltersSheet` (48×48, symbole 26px), distincte
// de `ColorCell` (`components/ui/color-cell.tsx`, 44×44) : deux feuilles
// de filtres, deux tailles — un second composant plutôt qu'un prop de taille
// sur un composant socle partagé.
import type { SearchColor } from './search-filters-sheet'

const COLOR_LABELS: Record<SearchColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

export function SearchColorCell({
  color,
  selected,
  onClick,
}: {
  color: SearchColor
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={COLOR_LABELS[color]}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-color-cell-search w-color-cell-search flex-shrink-0 items-center justify-center rounded-control border-thin ${
        selected ? 'border-accent bg-accent-bg' : 'border-border bg-surface-2'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/ */}
      <img
        src={`/mana/${color}.svg`}
        alt=""
        className={`h-icon-color-cell-search w-icon-color-cell-search ${selected ? '' : 'color-cell-muted'}`}
      />
    </button>
  )
}
