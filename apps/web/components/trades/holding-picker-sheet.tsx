'use client'

// Ce qu'on donne : choisi dans sa propre collection (racine et binders), une
// copie par tap. La feuille reste ouverte pour en ajouter d'autres.
import { useEffect, useState } from 'react'

import {
  addHoldingLineAction,
  searchTradeableHoldingsAction,
} from '@/app/(app)/tools/trade/actions'
import { SearchField } from '@/components/ui/search-field'
import { Sheet } from '@/components/ui/sheet'
import { formatMoney, type Currency } from '@/lib/format/money'
import type { TradeableHolding } from '@/lib/trades/trades'

const FINISH_LABEL = { nonfoil: null, foil: 'Foil', etched: 'Etched' } as const

export function HoldingPickerSheet({
  open,
  onOpenChange,
  tradeId,
  currency,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tradeId: string
  currency: Currency
  onAdded: () => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<TradeableHolding[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(nextQuery: string) {
    setQuery(nextQuery)
    setLoading(true)
    const result = await searchTradeableHoldingsAction({ tradeId, query: nextQuery })
    setLoading(false)
    if (result.ok) setItems(result.holdings)
    else setError('Could not load your cards.')
  }

  useEffect(() => {
    if (open) void load('')
    // Rechargé à chaque ouverture seulement : la saisie relance `load` elle-même.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleAdd(item: TradeableHolding) {
    setError(null)
    setItems((current) =>
      current.map((entry) =>
        entry.holdingId === item.holdingId
          ? { ...entry, inTrade: entry.inTrade + 1 }
          : entry,
      ),
    )
    const result = await addHoldingLineAction({
      tradeId,
      holdingId: item.holdingId,
      qty: 1,
    })
    if (!result.ok) {
      setError('Could not add this card.')
      void load(query)
      return
    }
    onAdded()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setItems([])
          setError(null)
        }
        onOpenChange(next)
      }}
      title="Add from your collection"
      fixedHeight
    >
      <div className="flex flex-col gap-10">
        <SearchField
          placeholder="Search your cards..."
          onSearch={(value) => void load(value.trim())}
          autoFocus
        />
        {error && <p className="px-2 text-meta text-danger">{error}</p>}
        {!loading && items.length === 0 && (
          <p className="px-2 text-meta text-text-2">
            {query
              ? 'No card of yours matches.'
              : 'Your collection and binders are empty.'}
          </p>
        )}
        <div className="flex flex-col gap-8">
          {items.map((item) => {
            const left = item.qty - item.inTrade
            const details = [
              `${item.setCode.toUpperCase()} #${item.collectorNumber}`,
              FINISH_LABEL[item.finish],
              item.condition.toUpperCase(),
              item.language.toUpperCase(),
              item.containerName,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={item.holdingId}
                type="button"
                disabled={left <= 0}
                onClick={() => void handleAdd(item)}
                className={`flex w-full items-center gap-12 rounded-row border border-border bg-surface-1 px-12 py-10 text-left ${
                  left <= 0 ? 'opacity-60' : ''
                }`}
              >
                <div className="h-thumb-search w-thumb-search flex-shrink-0 overflow-hidden rounded-thumb bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
                  <img
                    src={item.thumbUrl}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-card-name-search font-bold text-text">
                    {item.name}
                  </div>
                  <div className="mt-2 truncate text-meta-search text-text-2">
                    {details}
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="whitespace-nowrap font-mono text-card-name-search font-bold text-accent-text">
                    {item.marketPriceMinor === null
                      ? '—'
                      : formatMoney(item.marketPriceMinor, currency)}
                  </span>
                  <span className="whitespace-nowrap text-meta text-text-3">
                    {left > 0 ? `${left} left` : 'All in trade'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </Sheet>
  )
}
