'use client'

// `−` / quantité / `+` optimiste. Purement contrôlé : `qty` vient du parent,
// `onChange` transmet la valeur absolue suivante — c'est au parent de mettre à
// jour le cache TanStack Query de façon optimiste et de gérer le retour
// arrière.
//
// Borne basse (`min`, 0 par défaut — le `−` se désactive et passe en
// `text-3` au plancher), `stopPropagation` sur les boutons et le conteneur
// (un stepper dans une ligne cliquable n'ouvre jamais la carte), et un prop
// `disabled`.
//
// Chaque bouton porte une zone tactile de 44×44px (`--width/height-touch-target`)
// autour d'un cercle visuel de 22px (`--width/height-qty-button`). La zone
// tactile est portée par le `<button>` lui-même, positionné `absolute`
// (`-inset-11`), plutôt que par un wrapper en flux.
import type { MouseEvent } from 'react'

import { useCanEdit } from '@/lib/collections/access-context'

function QtyButton({
  label,
  symbol,
  onClick,
  disabled = false,
}: {
  label: string
  symbol: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <span className="relative h-qty-button w-qty-button flex-shrink-0">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        className="absolute -inset-11 flex items-center justify-center"
      >
        <span
          aria-hidden
          className={`flex h-qty-button w-qty-button items-center justify-center rounded-full bg-surface-2 text-body font-bold ${
            disabled ? 'text-text-3' : 'text-text'
          }`}
        >
          {symbol}
        </span>
      </button>
    </span>
  )
}

export function QtyStepper({
  holdingId,
  qty,
  onChange,
  min = 0,
  disabled = false,
}: {
  holdingId: string
  qty: number
  onChange: (next: number) => void
  min?: number
  disabled?: boolean
}) {
  const stop = (event: MouseEvent) => event.stopPropagation()
  // Lecture seule (`viewer`) : la quantité seule, sans boutons.
  const canEdit = useCanEdit()
  if (!canEdit) {
    return (
      <span className="min-w-qty-value text-center font-mono text-body font-bold text-text">
        ×{qty}
      </span>
    )
  }
  return (
    <div data-holding-id={holdingId} className="flex items-center gap-7" onClick={stop}>
      <QtyButton
        label="Decrease quantity"
        symbol="−"
        disabled={disabled || qty <= min}
        onClick={() => onChange(qty - 1)}
      />
      <span className="min-w-qty-value text-center font-mono text-body font-bold text-text">{qty}</span>
      <QtyButton
        label="Increase quantity"
        symbol="+"
        disabled={disabled}
        onClick={() => onChange(qty + 1)}
      />
    </div>
  )
}
