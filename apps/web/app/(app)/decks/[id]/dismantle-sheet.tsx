'use client'

// Écran `Dismantle`, au pixel du design validé : feuille de confirmation
// du démontage d'un deck `built`, choix du binder de destination, retour des
// cartes, `deck_state = 'dismantled'`.
//
// Les deux modes sont deux vrais chemins serveur — `keep` (les cartes
// retournent dans la collection) et `discard` (elles la quittent pour de
// bon) — jamais un bouton dessiné puis désactivé. Le mode choisi retombe sur
// le paramètre `mode` de `dismantleDeckAction` (`lib/decks/assemble.ts`,
// `dismantleDeck`), qui règle le stock physique différemment selon le cas
// plutôt que d'ignorer la distinction.
//
// Le select « Return to » (choix du binder de destination) n'est utile
// qu'en mode `keep`.
import { Archive, BookCopy, Check, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { formatMoney } from '@/lib/format/money'
import type { Currency } from '@/lib/format/money'

import { dismantleDeckAction, listDismantleTargetsAction, type DismantleTarget } from './lifecycle-actions'

type DismantleMode = 'keep' | 'discard'

const MODES: Array<{ value: DismantleMode; Icon: typeof Archive; label: string; hint: string }> = [
  {
    value: 'keep',
    Icon: Archive,
    label: 'Return the cards to the collection',
    hint: 'They go back loose, and the deck stays as a planning list.',
  },
  {
    value: 'discard',
    Icon: Trash2,
    label: 'Remove the cards from the collection',
    hint: 'They leave your collection for good — for a deck you sold or traded away.',
  },
]

export function DismantleSheet({
  open,
  onOpenChange,
  deckId,
  deckName,
  cardCount,
  valueMinor,
  currency,
  onDismantled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deckId: string
  deckName: string
  cardCount: number
  valueMinor: number
  currency: Currency
  onDismantled: () => void
}) {
  const [mode, setMode] = useState<DismantleMode>('keep')
  const [targets, setTargets] = useState<DismantleTarget[]>([])
  const [targetId, setTargetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void listDismantleTargetsAction({ deckId }).then((result) => {
      if ('error' in result) return
      setTargets(result)
      setTargetId((current) => current ?? result[0]?.id ?? null)
    })
  }, [open, deckId])

  function handleClose() {
    if (busy) return
    setError(null)
    onOpenChange(false)
  }

  async function handleDismantle() {
    if (!targetId) return
    setBusy(true)
    setError(null)
    const result = await dismantleDeckAction({ deckId, targetBinderId: targetId, mode })
    setBusy(false)
    if (!result.ok) {
      setError('Could not dismantle this deck. Please try again.')
      return
    }
    onOpenChange(false)
    onDismantled()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}
      title="Dismantle deck"
      closeLabel="Close dismantle sheet"
    >
      <p className="mb-16 text-meta leading-normal text-text-2">
        &ldquo;{deckName}&rdquo; goes back to the Decks tab as a plan. What should happen to its cards?
      </p>

      <div className="mb-16 flex flex-col gap-9">
        {MODES.map(({ value, Icon, label, hint }) => {
          const active = mode === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(value)}
              className={`flex items-start gap-12 rounded-card border-thin px-14 py-13 text-left ${
                active ? 'border-accent bg-accent-bg' : 'border-border-style-picker'
              }`}
            >
              <span
                className={`mt-1 flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin ${
                  active ? 'border-accent bg-accent' : 'border-text-3'
                }`}
              >
                {active && <Check width={10} height={10} strokeWidth={4} className="text-on-accent" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-7">
                  <Icon
                    width={16}
                    height={16}
                    strokeWidth={1.75}
                    className={`flex-shrink-0 ${value === 'discard' ? 'text-danger' : 'text-text-2'}`}
                  />
                  <span
                    className={`text-card-name-compact font-bold ${
                      value === 'discard' ? 'text-danger' : 'text-text'
                    }`}
                  >
                    {label}
                  </span>
                </span>
                <span className="mt-3 block text-value-caption leading-normal text-text-2">{hint}</span>
                {/* Le compteur rend les deux issues concrètes : combien de
                    cartes, quelle valeur, elles bougent ou elles partent. */}
                <span
                  className={`mt-5 block text-value-caption font-bold ${
                    value === 'discard' ? 'text-danger' : 'text-accent-text'
                  }`}
                >
                  {cardCount} cards · {formatMoney(valueMinor, currency)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mb-16 flex items-center gap-12 rounded-control border border-border bg-surface-2 px-13 py-12">
        <BookCopy width={17} height={17} strokeWidth={1.75} className="flex-shrink-0 text-text-2" />
        <span className="min-w-0 flex-1 text-intensity-label font-semibold text-text">Return to</span>
        <select
          value={targetId ?? ''}
          onChange={(event) => setTargetId(event.target.value)}
          aria-label="Return to"
          className="rounded-chip border border-border bg-surface-1 px-10 py-7 text-meta font-semibold text-text"
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mb-9 text-meta text-danger">{error}</p>}

      <div className="flex gap-10">
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          className="flex-1 rounded-control bg-surface-2 py-13 text-confirm-button font-bold text-text disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleDismantle()}
          disabled={busy || !targetId}
          className={`flex-1 rounded-control py-13 text-confirm-button font-bold text-on-accent disabled:opacity-60 ${
            mode === 'discard' ? 'bg-danger' : 'bg-accent'
          }`}
        >
          {busy ? 'Working...' : 'Dismantle'}
        </button>
      </div>
    </Sheet>
  )
}
