'use client'

// Un côté de l'échange dans le résumé : sa valeur totale (argent compris),
// le nombre de cartes, la liste compacte, les actions (ajouter, argent,
// détails), l'ajustement de valeur et les notes de ce côté.
import { Banknote, List, Plus } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'

import { CompactCardList } from '@/components/trades/compact-card-list'
import { RateChips } from '@/components/trades/rate-chips'
import { useChanged } from '@/components/ui/use-changed'
import { formatMoney, type Currency } from '@/lib/format/money'
import { sideTotalMinor } from '@/lib/trades/pricing'
import type { TradeSideView } from '@/lib/trades/trades'

function ActionLink({
  href,
  onClick,
  icon,
  label,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  label: string
}) {
  const className =
    'flex items-center justify-center gap-6 rounded-control bg-surface-2 py-11 text-body font-bold text-text'
  return href ? (
    <Link href={href} className={className}>
      {icon}
      {label}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {icon}
      {label}
    </button>
  )
}

export function SideZone({
  title,
  side,
  currency,
  cashLabel,
  addHref,
  cashHref,
  onDetails,
  canRate,
  pending,
  onRate,
  onCustomRate,
  notesLabel,
  onSaveNotes,
}: {
  title: string
  side: TradeSideView
  currency: Currency
  cashLabel: string
  addHref?: string
  cashHref?: string
  onDetails: () => void
  canRate: boolean
  pending: boolean
  onRate: (ratePct: number) => void
  onCustomRate: () => void
  notesLabel: string
  onSaveNotes: (notes: string) => Promise<boolean>
}) {
  const notesId = useId()
  const total = sideTotalMinor(side)
  const count = side.lines.reduce((sum, line) => sum + line.qty, 0)
  const [notes, setNotes] = useState(side.notes ?? '')
  const [saved, setSaved] = useState(false)

  // Les notes de l'autre partie arrivent par la relecture périodique.
  const notesChanged = useChanged(side.notes)
  const canEditNotesChanged = useChanged(side.canEditNotes)
  if (!side.canEditNotes && (notesChanged || canEditNotesChanged))
    setNotes(side.notes ?? '')

  const actions = [
    addHref && side.canEdit && (
      <ActionLink
        key="add"
        href={addHref}
        icon={<Plus width={15} height={15} strokeWidth={2} />}
        label="Add cards"
      />
    ),
    cashHref && side.canEdit && (
      <ActionLink
        key="cash"
        href={cashHref}
        icon={<Banknote width={15} height={15} strokeWidth={1.75} />}
        label="Cash"
      />
    ),
    <ActionLink
      key="details"
      onClick={onDetails}
      icon={<List width={15} height={15} strokeWidth={1.75} />}
      label="Details"
    />,
  ].filter(Boolean)

  return (
    <section
      aria-label={title}
      className="rounded-card border border-border bg-surface-1 p-16"
      data-testid={`trade-zone-${side.giver}`}
    >
      <div className="flex items-end justify-between gap-12">
        <div>
          <div className="text-section-label font-semibold uppercase tracking-section-label text-text-2">
            {title}
          </div>
          <div className="mt-4 text-value-total font-extrabold tracking-value-amount text-text">
            {formatMoney(total.valueMinor, currency)}
          </div>
        </div>
        <div className="text-right text-body text-text-2">
          {count} {count === 1 ? 'card' : 'cards'}
          {side.cashMinor > 0 && (
            <>
              <br />+ {formatMoney(side.cashMinor, currency)} cash
            </>
          )}
        </div>
      </div>

      <div className="mt-12">
        <CompactCardList
          lines={side.lines}
          currency={currency}
          cash={{ amountMinor: side.cashMinor, label: cashLabel }}
        />
      </div>

      <div
        className={`mt-12 grid gap-8 ${actions.length === 3 ? 'grid-cols-3' : actions.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
      >
        {actions}
      </div>

      <div className="mt-14 flex flex-wrap items-center gap-10">
        <span className="text-meta text-text-2">Value at</span>
        <RateChips
          value={side.ratePct}
          fixedMinor={side.fixedMinor}
          currency={currency}
          disabled={!canRate || pending}
          onChange={onRate}
          onCustom={onCustomRate}
        />
      </div>
      {side.cashMinor > 0 && (
        <p className="mt-6 ml-2 text-meta-search text-text-3">
          Applies to cards only, never to cash.
        </p>
      )}

      {side.canEditNotes ? (
        <label htmlFor={notesId} className="mt-14 mb-6 ml-2 block text-meta text-text-2">
          {notesLabel}
          {saved && <span className="ml-6 text-text-3">· Saved</span>}
        </label>
      ) : (
        <div className="mt-14 mb-6 ml-2 text-meta text-text-2">{notesLabel}</div>
      )}
      {side.canEditNotes ? (
        <textarea
          id={notesId}
          rows={2}
          maxLength={2000}
          value={notes}
          placeholder="Anything about this side"
          onChange={(event) => {
            setNotes(event.target.value)
            setSaved(false)
          }}
          onBlur={() => {
            if ((side.notes ?? '') !== notes.trim())
              void onSaveNotes(notes).then(setSaved)
          }}
          className="w-full resize-y rounded-control border border-border bg-bg px-12 py-10 text-body leading-normal text-text outline-none"
        />
      ) : (
        <p className="rounded-control bg-bg px-12 py-10 text-body leading-normal text-text">
          {side.notes || <span className="text-text-3">No notes.</span>}
        </p>
      )}
    </section>
  )
}
