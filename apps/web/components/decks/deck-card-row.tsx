'use client'

// Une carte d'une liste de deck : vignette, nom et coût, code de set, les
// trois zones, le compteur d'exemplaires et la suppression.
//
// C'est une ligne d'**édition**, pas une ligne de lecture : `SlotRow`
// (`components/decks/slot-row.tsx`) reste la ligne inerte des écrans qui ne
// modifient rien — la page publique de partage en particulier, où aucun de
// ces contrôles n'a le droit d'exister.
import { Trash2 } from 'lucide-react'

import { ManaCost } from '@/components/cards/mana-cost'
import type { DeckZone } from '@spellcache/db/schema'
import { useCanEdit } from '@/lib/collections/access-context'

const ZONES: Array<{ value: DeckZone; label: string }> = [
  { value: 'main', label: 'Main' },
  { value: 'side', label: 'Side' },
  { value: 'commander', label: 'CMDR' },
]

export function DeckCardRow({
  thumbUrl,
  name,
  manaCost,
  setLine,
  qty,
  zone,
  onQtyChange,
  onZoneChange,
  onRemove,
  onOpen,
}: {
  thumbUrl: string
  name: string
  manaCost: string | null
  setLine: string
  qty: number
  zone: DeckZone
  onQtyChange: (next: number) => void
  onZoneChange: (next: DeckZone) => void
  onRemove: () => void
  // Vignette et nom ouvrent la feuille de la carte ; les puces de zone, le
  // compteur et la corbeille gardent leur propre geste.
  onOpen?: () => void
}) {
  // Lecture seule (`viewer`) : ni zones, ni compteur, ni corbeille — la
  // quantité seule, comme `QtyStepper`. La zone se lit déjà au titre de
  // section (Commander / Mainboard / Sideboard).
  const canEdit = useCanEdit()
  return (
    <div className="flex items-center gap-12 rounded-card border border-border bg-surface-1 px-12 py-10">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        tabIndex={-1}
        aria-hidden="true"
        className="h-thumb-deck-row w-thumb-deck-row flex-shrink-0 overflow-hidden rounded-thumb-row bg-surface-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne */}
        <img src={thumbUrl} alt="" draggable={false} className="h-full w-full object-contain" />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          aria-label={`Open ${name}`}
          className="block w-full min-w-0 text-left"
        >
          <span className="flex min-w-0 items-center gap-6">
            <span className="min-w-0 truncate text-deck-row-name font-bold text-text">{name}</span>
            <ManaCost cost={manaCost} size={14} />
          </span>
          <span className="mt-2 block text-deck-row-set text-text-2">{setLine}</span>
        </button>
        {canEdit && (
        <div className="mt-6 flex gap-5">
          {ZONES.map((entry) => {
            const active = entry.value === zone
            return (
              <button
                key={entry.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) onZoneChange(entry.value)
                }}
                className={`rounded-pill px-7 py-2 text-zone-chip font-bold tracking-zone-chip ${
                  active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-text-2'
                }`}
              >
                {entry.label}
              </button>
            )
          })}
        </div>
        )}
      </div>

      {!canEdit ? (
        <span className="min-w-stepper-count text-center font-mono text-deck-row-qty font-bold text-text">
          ×{qty}
        </span>
      ) : (
      <div className="flex flex-shrink-0 items-center gap-8">
        <button
          type="button"
          aria-label={`One less ${name}`}
          // Le compteur ne descend pas à zéro : retirer une carte de la liste
          // est la corbeille à côté, un geste distinct d'une décrémentation.
          onClick={() => onQtyChange(Math.max(1, qty - 1))}
          className="flex h-stepper-round w-stepper-round items-center justify-center rounded-full bg-surface-2 text-body font-bold text-text"
        >
          −
        </button>
        <span className="min-w-stepper-count text-center font-mono text-deck-row-qty font-bold text-text">
          {qty}
        </span>
        <button
          type="button"
          aria-label={`One more ${name}`}
          onClick={() => onQtyChange(qty + 1)}
          className="flex h-stepper-round w-stepper-round items-center justify-center rounded-full bg-surface-2 text-body font-bold text-text"
        >
          +
        </button>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="ml-2 flex p-4 text-text-3"
        >
          <Trash2 width={16} height={16} strokeWidth={1.75} />
        </button>
      </div>
      )}
    </div>
  )
}
