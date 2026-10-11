'use client'

// Correction du prix unitaire d'une ligne : un montant saisi, ou le retour au
// prix du marché. La devise est celle de l'échange, jamais convertie.
import { useId, useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton, SecondaryButton } from '@/components/ui/sheet-controls'
import { formatMoney, type Currency } from '@/lib/format/money'
import { parsePriceMinor } from '@/lib/trades/pricing'

export function PriceSheet({
  open,
  onClose,
  cardName,
  currency,
  marketPriceMinor,
  priceOverrideMinor,
  pending,
  onSave,
}: {
  open: boolean
  onClose: () => void
  cardName: string
  currency: Currency
  marketPriceMinor: number | null
  priceOverrideMinor: number | null
  pending: boolean
  onSave: (priceOverrideMinor: number | null) => void
}) {
  const inputId = useId()
  const [value, setValue] = useState(
    priceOverrideMinor === null ? '' : (priceOverrideMinor / 100).toFixed(2),
  )
  const parsed = parsePriceMinor(value)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={cardName}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (parsed !== null) onSave(parsed)
        }}
        className="flex flex-col gap-14"
      >
        <div>
          <label
            htmlFor={inputId}
            className="mb-8 block text-body font-semibold text-text-2"
          >
            Unit price ({currency === 'usd' ? '$' : '€'})
          </label>
          <input
            id={inputId}
            autoFocus
            inputMode="decimal"
            value={value}
            placeholder={
              marketPriceMinor === null ? '0.00' : (marketPriceMinor / 100).toFixed(2)
            }
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 font-mono text-settings-input text-text outline-none"
          />
          <p className="mt-8 text-meta text-text-3">
            Market price:{' '}
            {marketPriceMinor === null
              ? 'unknown'
              : formatMoney(marketPriceMinor, currency)}
          </p>
        </div>
        <PrimaryButton type="submit" disabled={pending || parsed === null}>
          {pending ? 'Working...' : 'Set price'}
        </PrimaryButton>
        {priceOverrideMinor !== null && (
          <SecondaryButton onClick={() => onSave(null)} disabled={pending}>
            Use market price
          </SecondaryButton>
        )}
      </form>
    </Sheet>
  )
}
