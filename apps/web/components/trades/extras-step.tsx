'use client'

// Étape « Cash & notes » : l'argent qui équilibre l'échange et une note. En
// personne, l'argent peut aller dans un sens ou dans l'autre ; entre deux
// comptes, chacun ne saisit que ce qu'il paie.
import { useId, useState } from 'react'

import { Segmented } from '@/components/ui/segmented'
import { SectionLabel } from '@/components/ui/sheet-controls'
import { parsePriceMinor } from '@/lib/trades/pricing'
import type { TradeView } from '@/lib/trades/trades'

export interface ExtrasDraft {
  // Montant payé par moi (`give`) et par l'autre partie (`get`), en centimes.
  giveCashMinor: number
  getCashMinor: number
  notes: string
}

function toInput(amountMinor: number): string {
  return amountMinor > 0 ? (amountMinor / 100).toFixed(2) : ''
}

export function ExtrasStep({
  trade,
  onChange,
}: {
  trade: TradeView
  onChange: (draft: ExtrasDraft | null) => void
}) {
  const amountId = useId()
  const notesId = useId()
  const bothWays = trade.mode === 'in_person'
  const [payer, setPayer] = useState<'them' | 'me'>(
    trade.give.cashMinor > 0 ? 'me' : 'them',
  )
  const [amount, setAmount] = useState(
    toInput(payer === 'me' || !bothWays ? trade.give.cashMinor : trade.get.cashMinor),
  )
  const [notes, setNotes] = useState(trade.give.notes ?? '')

  function emit(next: { payer?: 'them' | 'me'; amount?: string; notes?: string }) {
    const nextPayer = next.payer ?? payer
    const nextAmount = next.amount ?? amount
    const minor = nextAmount.trim() === '' ? 0 : parsePriceMinor(nextAmount)
    if (minor === null) {
      onChange(null)
      return
    }
    const mePays = !bothWays || nextPayer === 'me'
    onChange({
      giveCashMinor: mePays ? minor : 0,
      getCashMinor: mePays ? (bothWays ? 0 : trade.get.cashMinor) : minor,
      notes: next.notes ?? notes,
    })
  }

  const invalid = amount.trim() !== '' && parsePriceMinor(amount) === null

  return (
    <div className="flex flex-col gap-22">
      <div>
        <SectionLabel>Cash (optional)</SectionLabel>
        <div className="flex flex-col gap-12 rounded-row border border-border bg-surface-1 p-12">
          {bothWays && (
            <Segmented
              options={[
                { value: 'them', label: `${trade.partnerName} pays me` },
                { value: 'me', label: `I pay ${trade.partnerName}` },
              ]}
              value={payer}
              onChange={(value) => {
                setPayer(value)
                emit({ payer: value })
              }}
            />
          )}
          <div>
            <label
              htmlFor={amountId}
              className="mb-8 block text-body font-semibold text-text-2"
            >
              {bothWays ? 'Amount' : `You pay ${trade.partnerName}`} (
              {trade.currency === 'usd' ? '$' : '€'})
            </label>
            <input
              id={amountId}
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(event) => {
                setAmount(event.target.value)
                emit({ amount: event.target.value })
              }}
              className="w-full rounded-control border border-border bg-surface-2 px-12 py-11 font-mono text-settings-input text-text outline-none"
            />
            {invalid && (
              <p className="mt-6 text-meta text-danger">
                Enter an amount like 5 or 5.50.
              </p>
            )}
            <p className="mt-8 text-meta text-text-3">
              Counted at face value; the value % only applies to cards.
            </p>
          </div>
        </div>
      </div>

      <div>
        <label
          htmlFor={notesId}
          className="mb-10 ml-2 block text-section-label font-semibold uppercase tracking-section-label text-text-2"
        >
          Notes (optional)
        </label>
        <textarea
          id={notesId}
          rows={4}
          maxLength={2000}
          value={notes}
          placeholder="What was discussed or promised"
          onChange={(event) => {
            setNotes(event.target.value)
            emit({ notes: event.target.value })
          }}
          className="w-full resize-none rounded-row border border-border bg-surface-1 px-14 py-12 text-body leading-normal text-text outline-none"
        />
      </div>
    </div>
  )
}
