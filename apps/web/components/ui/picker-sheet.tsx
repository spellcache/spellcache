'use client'

// Une liste de destinations à choix unique — quel binder, quel deck, quel
// format. Options `{ value, label, hint }`, coche accent sur l'entrée
// courante, chevron
// discret sinon ; choisir ferme la feuille.
import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'

export type PickerOption<T extends string | null> = {
  value: T
  label: string
  hint?: string
}

export function PickerSheet<T extends string | null>({
  open,
  onClose,
  title,
  options,
  value,
  onPick,
  emptyMessage = 'Nothing to pick yet.',
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  options: PickerOption<T>[]
  value?: T
  onPick: (value: T) => void
  emptyMessage?: string
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      {options.length === 0 ? (
        <div className="px-2 pb-12 pt-4 text-row-value text-text-2">{emptyMessage}</div>
      ) : (
        <SheetGroup>
          {options.map((option) => (
            <SheetRow
              key={String(option.value)}
              label={option.label}
              hint={option.hint}
              onClick={() => {
                onPick(option.value)
                onClose()
              }}
              value={
                option.value === value ? (
                  <Check width={17} height={17} strokeWidth={1.75} className="text-accent-text" />
                ) : (
                  <ChevronRight width={16} height={16} strokeWidth={1.75} className="text-text-3" />
                )
              }
            />
          ))}
        </SheetGroup>
      )}
      {footer && <div className="mt-14">{footer}</div>}
    </Sheet>
  )
}
