'use client'

// Étape « What do you give? » : sa propre collection, groupée par container
// (racine, binders, decks). Une recherche porte sur tous les containers ;
// sans recherche, on ouvre un container pour voir ses cartes. « Select all »
// met un binder entier dans l'échange. Un deck s'affiche mais se défait
// d'abord : ses lignes sont des réservations, pas des exemplaires.
import { Check, ChevronDown, ChevronRight, Layers, Library } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  addContainerLinesAction,
  addHoldingLineAction,
  browseTradeableAction,
  removeLineAction,
} from '@/app/(app)/tools/trade/actions'
import { Chip } from '@/components/ui/chip'
import { SearchField } from '@/components/ui/search-field'
import { formatCount, formatMoney } from '@/lib/format/money'
import type { BrowseGroup, BrowseScope, TradeView } from '@/lib/trades/trades'
import type { RunAction } from '@/components/trades/use-trade'

const SCOPES: Array<{ value: BrowseScope; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'binders', label: 'Binders' },
  { value: 'decks', label: 'Decks' },
]

const FINISH_LABEL = { nonfoil: null, foil: 'Foil', etched: 'Etched' } as const

function DeckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.6" y="8.4" width="11" height="13" rx="2" />
      <path d="M5.6 8.4V7.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
      <path d="M8.6 5.4V4.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
    </svg>
  )
}

export function CardsStep({
  trade,
  pending,
  onChanged,
  run,
}: {
  trade: TradeView
  pending: boolean
  onChanged: () => void
  run: RunAction
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<BrowseScope>('all')
  const [groups, setGroups] = useState<BrowseGroup[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(
    next: { query?: string; scope?: BrowseScope; open?: string | null } = {},
  ) {
    const nextQuery = next.query ?? query
    const nextScope = next.scope ?? scope
    const nextOpen = next.open === undefined ? open : next.open
    setLoading(true)
    const result = await browseTradeableAction({
      tradeId: trade.id,
      query: nextQuery || undefined,
      scope: nextScope,
      containerId: !nextQuery && nextOpen ? nextOpen : undefined,
    })
    setLoading(false)
    if (result.ok) setGroups(result.groups)
  }

  useEffect(() => {
    void load()
    // Chargé une fois ; la saisie, le filtre et l'ouverture rechargent eux-mêmes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function after(ok: boolean) {
    if (ok) onChanged()
    await load()
  }

  return (
    <div className="flex min-w-0 flex-col gap-14">
      <SearchField
        placeholder="Search your cards..."
        onSearch={(value) => {
          setQuery(value.trim())
          void load({ query: value.trim() })
        }}
      />
      <div role="group" aria-label="Where to look" className="flex flex-wrap gap-6">
        {SCOPES.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            selected={scope === entry.value}
            onClick={() => {
              setScope(entry.value)
              void load({ scope: entry.value })
            }}
          />
        ))}
      </div>

      {!loading && groups.length === 0 && (
        <p className="px-2 text-meta text-text-2">
          {query ? 'No card of yours matches.' : 'Nothing to trade here yet.'}
        </p>
      )}

      {groups.map((group) => {
        const expanded = query !== '' || open === group.containerId
        return (
          <div
            key={group.containerId}
            className="overflow-hidden rounded-row border border-border bg-surface-1"
            data-trade-group={group.name}
          >
            <div className="flex items-center gap-10 bg-surface-2 px-12 py-11">
              <button
                type="button"
                disabled={!group.tradeable || query !== ''}
                onClick={() => {
                  const next = open === group.containerId ? null : group.containerId
                  setOpen(next)
                  void load({ open: next })
                }}
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-10 text-left"
              >
                <span className="text-text-2">
                  {group.kind === 'deck' ? (
                    <DeckIcon />
                  ) : group.kind === 'collection' ? (
                    <Library width={16} height={16} strokeWidth={1.75} />
                  ) : (
                    <Layers width={16} height={16} strokeWidth={1.75} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-row-value font-bold text-text">
                    {group.name}
                  </span>
                  <span className="block text-meta-search text-text-2">
                    {group.tradeable
                      ? `${formatCount(group.cardCount)} cards${group.selectedCount > 0 ? ` · ${group.selectedCount} selected` : ''}`
                      : 'Built deck · dismantle it first to trade its cards'}
                  </span>
                </span>
                {group.tradeable && query === '' && (
                  <span className="text-text-3">
                    {expanded ? (
                      <ChevronDown width={16} height={16} strokeWidth={1.75} />
                    ) : (
                      <ChevronRight width={16} height={16} strokeWidth={1.75} />
                    )}
                  </span>
                )}
              </button>
              {group.tradeable && group.cardCount > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      addContainerLinesAction({
                        tradeId: trade.id,
                        containerId: group.containerId,
                      }),
                    ).then(after)
                  }
                  className="flex-shrink-0 rounded-pill border border-border px-11 py-6 text-chip-toggle font-bold text-text"
                >
                  Select all
                </button>
              )}
            </div>

            {expanded && group.holdings && (
              <div>
                {group.holdings.length === 0 && (
                  <p className="border-t border-border px-12 py-10 text-meta text-text-2">
                    No cards here.
                  </p>
                )}
                {group.holdings.map((holding) => {
                  const selected = holding.lineId !== null
                  const details = [
                    holding.setCode.toUpperCase(),
                    FINISH_LABEL[holding.finish],
                    holding.condition.toUpperCase(),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <button
                      key={holding.holdingId}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={`${holding.name}, ${details}`}
                      disabled={pending}
                      onClick={() =>
                        void run(() =>
                          holding.lineId
                            ? removeLineAction({
                                tradeId: trade.id,
                                lineId: holding.lineId,
                              })
                            : addHoldingLineAction({
                                tradeId: trade.id,
                                holdingId: holding.holdingId,
                                qty: 1,
                              }),
                        ).then(after)
                      }
                      className="flex w-full items-center gap-10 border-t border-border px-12 py-9 text-left"
                    >
                      <span
                        className={`flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-thumb ${
                          selected ? 'bg-accent text-on-accent' : 'border border-text-3'
                        }`}
                      >
                        {selected && <Check width={13} height={13} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-row-value font-semibold text-text">
                          {holding.name}
                        </span>
                        <span className="block text-meta-search text-text-2">
                          {details}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-meta-mono font-bold ${selected ? 'text-text' : 'text-text-3'}`}
                      >
                        {selected
                          ? `${holding.inTrade}/${holding.qty}`
                          : `×${holding.qty}`}
                      </span>
                      <span className="w-touch-target text-right font-mono text-row-price font-bold text-accent-text">
                        {holding.marketPriceMinor === null
                          ? '—'
                          : formatMoney(holding.marketPriceMinor, trade.currency)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
