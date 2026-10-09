'use client'

// Feuille d'édition d'une ligne de liste : quantité/condition/foil (immédiates,
// `CardEditControls`, même principe que `EditCardSheet`) + notes (commit au
// blur) + retrait, confirmé — une liste n'a ni binder ni undo de 6s sur ses
// lignes (« Cards in a list are not part of your collection »),
// retirer une carte demande donc une confirmation explicite plutôt qu'un
// toast annulable.
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CardEditControls } from '@/components/cards/card-edit-controls'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'
import type { Condition } from '@spellcache/db/schema'

import {
  getHoldingDetailAction,
  updateHoldingAction,
  type HoldingDetail,
} from '@/app/(app)/container/[id]/actions'
import type { HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

export function EditListCardSheet({
  open,
  onOpenChange,
  holding,
  onQtyChange,
  onConditionChange,
  onFoilChange,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  holding: HoldingRow | null
  onQtyChange: (next: number) => void
  onConditionChange: (condition: Condition) => void
  onFoilChange: (isFoil: boolean) => void
  onRemove: () => void
}) {
  const [detail, setDetail] = useState<HoldingDetail | null>(null)
  const [notes, setNotes] = useState('')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !holding) {
      setDetail(null)
      return
    }
    let cancelled = false
    void getHoldingDetailAction(holding.holdingId).then((result) => {
      if (cancelled || !result) return
      setDetail(result)
      setNotes(result.notes ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [open, holding])

  if (!holding) return null

  async function commitNotes(next: string) {
    if (next === (detail?.notes ?? '')) return
    const result = await updateHoldingAction({
      holdingId: holding!.holdingId,
      notes: next.trim() === '' ? null : next,
    })
    if (!result.ok) setError('Could not save the notes. Try again.')
  }

  function handleRemove() {
    setConfirmingRemove(false)
    onRemove()
    onOpenChange(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={holding.name}>
        <div className="flex flex-col gap-16">
          <CardEditControls
            holdingId={holding.holdingId}
            qty={holding.qty}
            condition={holding.condition}
            finish={holding.finish}
            onQtyChange={onQtyChange}
            onConditionChange={onConditionChange}
            onFoilChange={onFoilChange}
          />

          <div>
            <div className="mb-8 text-body font-semibold text-text-2">Notes</div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={(event) => void commitNotes(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
            />
          </div>

          {error && <p className="text-meta text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="flex items-center justify-center gap-8 rounded-control border border-border bg-surface-2 py-13 text-body font-bold text-danger"
          >
            <Trash2 width={16} height={16} strokeWidth={1.75} />
            Remove card
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmingRemove}
        title="Remove card?"
        message={`Remove ${holding.name} from this list. Your collection is not affected.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onClose={() => setConfirmingRemove(false)}
      />
    </>
  )
}
