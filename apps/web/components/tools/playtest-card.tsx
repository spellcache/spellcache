// Carte du Playtest : la vignette entière au ratio 5:7, sans prix ni pied
// de set — on teste une main, pas une collection. Tokens de `GridTile`
// (bordure, rayon, état sélectionné), jamais une nouvelle forme
// (docs/development.md : aucun nouveau langage visuel).
//
// Sans `onClick`, la carte est une simple image (zone de commandement).
import { Check } from 'lucide-react'

export function PlaytestCardTile({
  name,
  thumbUrl,
  onClick,
  actionLabel,
  selectable = false,
  selected = false,
}: {
  name: string
  thumbUrl: string
  onClick?: () => void
  // Ce que fait le tap, lu par les lecteurs d'écran (« Play Lightning Bolt »).
  actionLabel?: string
  // Phase de fond : la carte devient un bouton bascule (`aria-pressed`).
  selectable?: boolean
  selected?: boolean
}) {
  const className = `relative block w-full overflow-hidden rounded-row border text-left ${
    selected ? 'border-border-accent bg-accent-bg' : 'border-border bg-surface-1'
  }`

  const body = (
    <span className="relative block aspect-card bg-surface-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
      <img
        src={thumbUrl}
        alt={onClick ? '' : name}
        className="h-full w-full object-contain"
      />
      {selected && (
        <span
          aria-hidden="true"
          className="absolute left-6 top-6 flex h-selection-circle w-selection-circle items-center justify-center rounded-full border-thin border-accent bg-accent"
        >
          <Check width={11} height={11} strokeWidth={3.5} className="text-on-accent" />
        </span>
      )}
    </span>
  )

  if (!onClick) return <span className={className}>{body}</span>

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel ? `${actionLabel} ${name}` : name}
      aria-pressed={selectable ? selected : undefined}
      className={className}
    >
      {body}
    </button>
  )
}
