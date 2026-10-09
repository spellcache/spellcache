'use client'

// Demande un nom, un seul. Remplace `window.prompt` (cassait le langage de
// l'app et est silencieusement supprimé dans certaines webviews) : label 13px au-dessus du champ, champ
// pré-rempli au montage (l'appelant remonte le composant par `key` à chaque
// usage), bouton plein accent `Create` / `Working...`.
import { useId, useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton } from '@/components/ui/sheet-controls'

export function NameSheet({
  open,
  title,
  label = 'Name',
  initialValue = '',
  confirmLabel = 'Create',
  pending = false,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  label?: string
  initialValue?: string
  confirmLabel?: string
  pending?: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputId = useId()

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const name = value.trim()
          if (!name) return
          onSubmit(name)
        }}
      >
        <label htmlFor={inputId} className="mb-8 block text-body font-semibold text-text-2">
          {label}
        </label>
        <input
          id={inputId}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
        />
        <div className="mt-18">
          <PrimaryButton type="submit" disabled={pending || value.trim() === ''}>
            {pending ? 'Working...' : confirmLabel}
          </PrimaryButton>
        </div>
      </form>
    </Sheet>
  )
}
