'use client'

// Saisie libre de la valeur d'un côté : un pourcentage du prix du marché
// (borné par `RATE_MIN_PCT`/`RATE_MAX_PCT`) ou un montant fixe pour toutes les
// cartes de ce côté. L'argent du côté s'ajoute toujours à part.
import { useId, useState } from 'react'

import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton } from '@/components/ui/sheet-controls'
import { formatMoney, type Currency } from '@/lib/format/money'
import { parsePriceMinor, RATE_MAX_PCT, RATE_MIN_PCT } from '@/lib/trades/pricing'

export type SideValue =
  { kind: 'rate'; ratePct: number } | { kind: 'fixed'; amountMinor: number }

export function ValueSheet({
  open,
  onClose,
  title,
  currency,
  ratePct,
  fixedMinor,
  marketMinor,
  pending,
  onSave,
}: {
  open: boolean
  onClose: () => void
  title: string
  currency: Currency
  ratePct: number
  fixedMinor: number | null
  // Valeur des cartes au prix du marché, pour situer la saisie.
  marketMinor: number
  pending: boolean
  onSave: (value: SideValue) => void
}) {
  const inputId = useId()
  const [kind, setKind] = useState<SideValue['kind']>(
    fixedMinor !== null ? 'fixed' : 'rate',
  )
  const [rate, setRate] = useState(String(ratePct))
  const [amount, setAmount] = useState(
    fixedMinor !== null ? (fixedMinor / 100).toFixed(2) : '',
  )

  const parsedRate = /^\d{1,3}$/.test(rate.trim()) ? Number(rate.trim()) : null
  const rateValid =
    parsedRate !== null && parsedRate >= RATE_MIN_PCT && parsedRate <= RATE_MAX_PCT
  const parsedAmount = parsePriceMinor(amount)
  const valid = kind === 'rate' ? rateValid : parsedAmount !== null

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <form
        className="flex flex-col gap-14"
        onSubmit={(event) => {
          event.preventDefault()
          if (kind === 'rate' && rateValid) onSave({ kind: 'rate', ratePct: parsedRate! })
          if (kind === 'fixed' && parsedAmount !== null)
            onSave({ kind: 'fixed', amountMinor: parsedAmount })
        }}
      >
        <Segmented
          options={[
            { value: 'rate', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed amount' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <div>
          <label
            htmlFor={inputId}
            className="mb-8 block text-body font-semibold text-text-2"
          >
            {kind === 'rate'
              ? `Percentage of the market price (${RATE_MIN_PCT}–${RATE_MAX_PCT})`
              : `Value of all these cards (${currency === 'usd' ? '$' : '€'})`}
          </label>
          <input
            id={inputId}
            autoFocus
            inputMode={kind === 'rate' ? 'numeric' : 'decimal'}
            value={kind === 'rate' ? rate : amount}
            placeholder={kind === 'rate' ? '100' : '0.00'}
            onChange={(event) =>
              (kind === 'rate' ? setRate : setAmount)(event.target.value)
            }
            className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 font-mono text-settings-input text-text outline-none"
          />
          <p className="mt-8 text-meta text-text-3">
            Market price of these cards: {formatMoney(marketMinor, currency)}. Cash is
            always added on top.
          </p>
        </div>
        <PrimaryButton type="submit" disabled={pending || !valid}>
          {pending ? 'Working...' : 'Set value'}
        </PrimaryButton>
      </form>
    </Sheet>
  )
}
