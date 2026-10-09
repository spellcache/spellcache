'use client'

// Confirmation d'action destructrice réutilisable, bâtie sur la `Sheet`
// partagée — une action destructrice ne part jamais sans un tap de
// confirmation explicite. Message 14px en `text-2`, deux boutons `flex-1`
// (annuler sur `surface-2`, confirmer en `danger` — ou `accent` via
// `destructive={false}` pour une confirmation qui n'est pas une
// suppression).
import { useState } from 'react'

import { Sheet } from '@/components/ui/sheet'

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  pending = false,
  destructive = true,
  requiredText,
}: {
  open: boolean
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
  pending?: boolean
  destructive?: boolean
  // Confirmation renforcée (comme la suppression d'un dépôt GitHub) : le
  // bouton ne s'active qu'une fois ce texte exact recopié dans le champ.
  requiredText?: string
}) {
  const [typed, setTyped] = useState('')
  const locked = requiredText !== undefined && typed !== requiredText
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      {message && <p className="mb-18 text-confirm-message leading-normal text-text-2">{message}</p>}
      {requiredText !== undefined && (
        <label className="mb-18 block">
          <span className="mb-8 block text-confirm-message text-text-2">
            Type <span className="font-bold text-text">{requiredText}</span> to confirm.
          </span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${requiredText} to confirm`}
            className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
          />
        </label>
      )}
      <div className="flex gap-10">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-control bg-surface-2 py-13 text-confirm-button font-bold text-text"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending || locked}
          className={`flex-1 rounded-control py-13 text-confirm-button font-bold text-on-accent ${
            destructive ? 'bg-danger' : 'bg-accent'
          } ${pending || locked ? 'opacity-70' : ''}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
