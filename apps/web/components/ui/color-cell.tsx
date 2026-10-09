'use client'

// Case de couleur de la feuille `Filters` : 44×44, symbole de `public/mana/`
// — mêmes assets que `ManaCost` (`components/cards/mana-cost.tsx`),
// gris/atténués tant que la case n'est pas sélectionnée.
import type { Color } from '@/lib/view-state/parse'

const COLOR_LABELS: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

export function ColorCell({
  color,
  selected,
  onClick,
}: {
  color: Color
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={COLOR_LABELS[color]}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-color-cell w-color-cell flex-shrink-0 items-center justify-center rounded-control border-thin ${
        selected ? 'border-accent bg-accent-bg' : 'border-border bg-surface-2'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/ */}
      <img
        src={`/mana/${color}.svg`}
        alt=""
        className={`h-icon-color-cell w-icon-color-cell ${selected ? '' : 'color-cell-muted'}`}
      />
    </button>
  )
}
