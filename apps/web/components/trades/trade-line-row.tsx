'use client'

// Ligne d'un échange : même gabarit que `SearchRow` (vignette, nom, ligne de
// set, prix en mono). Le prix ouvre sa correction ; un prix saisi à la main
// garde le prix du marché en dessous, pour qu'on voie toujours l'écart.
import { X } from 'lucide-react'

import { QtyStepper } from '@/components/cards/qty-stepper'
import { formatMoney, type Currency } from '@/lib/format/money'
import { unitPriceMinor } from '@/lib/trades/pricing'
import type { TradeLineView } from '@/lib/trades/trades'

const FINISH_LABEL = { nonfoil: null, foil: 'Foil', etched: 'Etched' } as const

export function TradeLineRow({
  line,
  currency,
  editQty,
  editPrice,
  onQtyChange,
  onRemove,
  onPrice,
  disabled = false,
}: {
  line: TradeLineView
  currency: Currency
  editQty: boolean
  editPrice: boolean
  // Une écriture est en cours : pas de second tap sur la même ligne.
  disabled?: boolean
  onQtyChange: (next: number) => void
  onRemove: () => void
  onPrice: () => void
}) {
  const unit = unitPriceMinor(line)
  const unitLabel = unit === null ? 'no price' : formatMoney(unit, currency)
  const details = [
    `${line.setCode.toUpperCase()} #${line.collectorNumber}`,
    FINISH_LABEL[line.finish],
    line.condition.toUpperCase(),
    line.language.toUpperCase(),
    line.sourceName,
  ]
    .filter(Boolean)
    .join(' · ')

  const price = (
    <span className="flex flex-col items-end">
      <span className="whitespace-nowrap font-mono text-card-name-search font-bold text-accent-text">
        {unit === null ? '—' : formatMoney(unit, currency)}
      </span>
      {line.priceOverrideMinor !== null && (
        <span className="whitespace-nowrap text-meta-mono text-text-3">
          Market{' '}
          {line.marketPriceMinor === null
            ? '—'
            : formatMoney(line.marketPriceMinor, currency)}
        </span>
      )}
    </span>
  )

  return (
    <div
      className="flex flex-col gap-10 rounded-row border border-border bg-surface-1 px-12 py-10"
      data-trade-line={line.id}
    >
      <div className="flex items-center gap-12">
        <div className="h-thumb-search w-thumb-search flex-shrink-0 overflow-hidden rounded-thumb bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
          <img src={line.thumbUrl} alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-card-name-search font-bold text-text">
            {line.name}
          </div>
          <div className="mt-2 truncate text-meta-search text-text-2">{details}</div>
        </div>
        {editPrice ? (
          <button
            type="button"
            onClick={onPrice}
            disabled={disabled}
            aria-label={`${line.name}, ${unitLabel} each. Set price`}
          >
            {price}
          </button>
        ) : (
          price
        )}
      </div>
      <div className="flex items-center justify-between pl-2">
        {editQty ? (
          <QtyStepper
            holdingId={line.id}
            qty={line.qty}
            min={1}
            disabled={disabled}
            // Le stepper n'a pas de borne haute : on ne donne pas plus de
            // copies qu'on n'en possède.
            onChange={(next) => {
              if (line.maxQty !== null && next > line.maxQty) return
              onQtyChange(next)
            }}
          />
        ) : (
          <span className="font-mono text-body font-bold text-text">×{line.qty}</span>
        )}
        {line.maxQty !== null && editQty && (
          <span className="text-meta text-text-3">{line.maxQty} owned</span>
        )}
        {editQty && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${line.name}`}
            className="flex h-touch-target w-touch-target items-center justify-center text-text-2"
          >
            <X width={17} height={17} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  )
}
