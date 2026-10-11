// Carte d'une partie de test : la vignette du proxy, au ratio 5:7, posée sur
// un bouton. Deux tailles — `hand` (celle de `MiniTile`) et `battlefield`,
// plus petite pour tenir cinq cartes par rangée. Engagée, la boîte pivote
// d'un quart de tour : largeur et hauteur s'échangent, la rangée garde son
// alignement au lieu de voir la carte déborder sur sa voisine.
import type { PlaytestCard as PlaytestCardData } from '@/lib/tools/playtest-state'

const SIZE = {
  hand: 'w-mini-tile h-mini-tile',
  battlefield: 'w-playtest-card h-playtest-card',
  tapped: 'w-playtest-card-tapped h-playtest-card-tapped',
}

export function PlaytestCard({
  card,
  size,
  tapped = false,
  onClick,
}: {
  card: PlaytestCardData
  size: 'hand' | 'battlefield'
  tapped?: boolean
  onClick: () => void
}) {
  const box = size === 'battlefield' && tapped ? SIZE.tapped : SIZE[size]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tapped ? `${card.name} (tapped)` : card.name}
      className={`relative flex-shrink-0 overflow-hidden ${box}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
      <img
        src={card.thumbUrl}
        alt=""
        draggable={false}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-thumb bg-surface-2 object-contain ${
          size === 'hand' ? SIZE.hand : SIZE.battlefield
        } ${tapped ? 'rotate-90 opacity-72' : ''}`}
      />
    </button>
  )
}
