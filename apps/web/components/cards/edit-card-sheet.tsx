'use client'

// Feuille d'édition d'une carte — ouverte depuis le bouton `Edit` de
// `CardSheet` (lecture seule). Quantité/condition/foil sont des mutations
// optimistes IMMÉDIATES (`CardEditControls` — docs/development.md « mises à
// jour optimistes sur toutes les quantités, avec retour arrière en cas
// d'échec »), jamais regroupées dans un unique bouton `Save changes`
// différé : un second modèle d'écriture pour cette seule feuille divergerait
// du reste de l'écran de container. Langue/notes/binder suivent le même
// principe : chacun s'écrit dès qu'on le change, pas de bouton `Save` qui
// laisserait croire qu'un champ non touché pourrait être perdu.
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CardEditControls } from '@/components/cards/card-edit-controls'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PickerSheet } from '@/components/ui/picker-sheet'
import { Sheet } from '@/components/ui/sheet'
import type { Condition } from '@spellcache/db/schema'

import {
  getHoldingDetailAction,
  listHoldingBindersAction,
  moveHoldingAction,
  updateHoldingAction,
  type HoldingBinderOption,
  type HoldingDetail,
} from '@/app/(app)/container/[id]/actions'
import type { HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

export function EditCardSheet({
  open,
  onOpenChange,
  containerId,
  holding,
  // Nom du binder courant — le container ouvert EST le binder de cette
  // ligne sur un écran de binder (modèle disjoint), ou celui du HOLDING
  // lui-même sur la racine (une ligne peut y venir d'un binder), `null` sinon
  // (liste/deck) — même donnée que `CardSheet.binderName`, affichée telle
  // quelle avant tout choix dans le picker.
  currentBinderName,
  onQtyChange,
  onConditionChange,
  onFoilChange,
  onDelete,
  // Rappelé après un déplacement de binder réussi — la
  // ligne quitte la vue courante, l'écran de container doit relire
  // holdings/en-tête et fermer cette feuille comme la feuille de détail
  // au-dessus d'elle.
  onMoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string
  holding: HoldingRow | null
  currentBinderName: string | null
  onQtyChange: (next: number) => void
  onConditionChange: (condition: Condition) => void
  onFoilChange: (isFoil: boolean) => void
  onDelete: () => void
  onMoved: () => void
}) {
  const [detail, setDetail] = useState<HoldingDetail | null>(null)
  const [language, setLanguage] = useState('')
  const [notes, setNotes] = useState('')
  const [binderPickerOpen, setBinderPickerOpen] = useState(false)
  const [binderOptions, setBinderOptions] = useState<HoldingBinderOption[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
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
      setLanguage(result.language)
      setNotes(result.notes ?? '')
    })
    void listHoldingBindersAction(containerId).then((options) => {
      if (!cancelled) setBinderOptions(options)
    })
    return () => {
      cancelled = true
    }
  }, [open, holding, containerId])

  if (!holding) return null

  async function commitLanguage(next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === detail?.language) return
    const result = await updateHoldingAction({ holdingId: holding!.holdingId, language: trimmed })
    if (!result.ok) setError('Could not save the language. Try again.')
  }

  async function commitNotes(next: string) {
    if (next === (detail?.notes ?? '')) return
    const result = await updateHoldingAction({
      holdingId: holding!.holdingId,
      notes: next.trim() === '' ? null : next,
    })
    if (!result.ok) setError('Could not save the notes. Try again.')
  }

  async function handlePickBinder(targetContainerId: string) {
    const result = await moveHoldingAction({ holdingId: holding!.holdingId, targetContainerId })
    if (!result.ok) {
      setError('Could not move this card. Try again.')
      return
    }
    onMoved()
    onOpenChange(false)
  }

  function handleDelete() {
    setConfirmingDelete(false)
    onDelete()
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
            <div className="mb-8 text-body font-semibold text-text-2">Language</div>
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              onBlur={(event) => void commitLanguage(event.target.value)}
              className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
            />
          </div>

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

          <button
            type="button"
            onClick={() => setBinderPickerOpen(true)}
            className="flex items-center justify-between rounded-control border border-border bg-surface-2 px-14 py-12 text-left"
          >
            <span className="text-body font-semibold text-text-2">Binder</span>
            <span className="text-body font-semibold text-text">
              {currentBinderName ?? 'No binder'}
            </span>
          </button>

          {error && <p className="text-meta text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="flex items-center justify-center gap-8 rounded-control border border-border bg-surface-2 py-13 text-body font-bold text-danger"
          >
            <Trash2 width={16} height={16} strokeWidth={1.75} />
            Delete card
          </button>
        </div>
      </Sheet>

      <PickerSheet
        open={binderPickerOpen}
        onClose={() => setBinderPickerOpen(false)}
        title="Binder"
        options={binderOptions.map((option) => ({
          value: option.id,
          label: option.name,
          hint: option.isRoot ? 'Loose in the collection' : undefined,
        }))}
        onPick={(value) => void handlePickBinder(value)}
        emptyMessage="No binder yet — create one from the Collection tab."
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete card?"
        message={`Remove ${holding.name} from your collection. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  )
}
