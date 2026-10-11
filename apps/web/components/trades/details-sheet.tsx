'use client'

// Feuille « Details » d'un côté : chaque carte avec sa vignette, sa
// quantité, son prix (corrigible) et sa suppression. Une carte reçue en
// personne, venue du catalogue, se règle aussi en finition et en état.
import { CollectionAccessProvider } from '@/lib/collections/access-context'
import { Chip } from '@/components/ui/chip'
import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton, SecondaryButton } from '@/components/ui/sheet-controls'
import { TradeLineRow } from '@/components/trades/trade-line-row'
import { formatMoney, type Currency } from '@/lib/format/money'
import { sideTotalMinor } from '@/lib/trades/pricing'
import type { Condition, Finish } from '@spellcache/db/schema'
import { DeckIcon } from '@/components/trades/deck-icon'
import type { TradeLineView, TradeSideView } from '@/lib/trades/trades'

const CONDITIONS: Condition[] = ['nm', 'lp', 'mp', 'hp', 'dmg']
const FINISHES: Array<{ value: Finish; label: string }> = [
  { value: 'nonfoil', label: 'Non-foil' },
  { value: 'foil', label: 'Foil' },
  { value: 'etched', label: 'Etched' },
]

export function DetailsSheet({
  open,
  onClose,
  title,
  side,
  currency,
  editPrice,
  pending,
  onQty,
  onRemove,
  onPrice,
  onKey,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  title: string
  side: TradeSideView
  currency: Currency
  editPrice: boolean
  pending: boolean
  onQty: (line: TradeLineView, qty: number) => void
  onRemove: (line: TradeLineView) => void
  onPrice: (line: TradeLineView) => void
  onKey: (line: TradeLineView, patch: { finish?: Finish; condition?: Condition }) => void
  onAdd?: () => void
}) {
  const total = sideTotalMinor({ ...side, cashMinor: 0 })
  const count = side.lines.reduce((sum, line) => sum + line.qty, 0)
  // Les cartes d'un deck cédé entier se regroupent sous le deck, qui porte
  // seul le retrait.
  const looseLines = side.lines.filter((line) => line.deck === null)
  const decks: Array<{ id: string; name: string; lines: TradeLineView[] }> = []
  for (const line of side.lines) {
    if (!line.deck) continue
    const group = decks.find((entry) => entry.id === line.deck!.id)
    if (group) group.lines.push(line)
    else decks.push({ ...line.deck, lines: [line] })
  }

  const renderLine = (line: TradeLineView) => (
    <div key={line.id} className="flex flex-col gap-8">
      <TradeLineRow
        line={line}
        currency={currency}
        editQty={side.canEdit}
        editPrice={editPrice}
        disabled={pending}
        onQtyChange={(qty) => onQty(line, qty)}
        onRemove={() => onRemove(line)}
        onPrice={() => onPrice(line)}
      />
      {line.fromCatalog && side.canEdit && (
        <div className="flex flex-col gap-6 px-4">
          <div
            role="group"
            aria-label={`Finish of ${line.name}`}
            className="flex flex-wrap gap-6"
          >
            {FINISHES.map((finish) => (
              <Chip
                key={finish.value}
                variant="toggle"
                label={finish.label}
                selected={line.finish === finish.value}
                disabled={pending}
                onClick={() =>
                  line.finish !== finish.value && onKey(line, { finish: finish.value })
                }
              />
            ))}
          </div>
          <div
            role="group"
            aria-label={`Condition of ${line.name}`}
            className="flex flex-wrap gap-6"
          >
            {CONDITIONS.map((condition) => (
              <Chip
                key={condition}
                variant="toggle"
                label={condition.toUpperCase()}
                selected={line.condition === condition}
                disabled={pending}
                onClick={() => line.condition !== condition && onKey(line, { condition })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      fixedHeight
    >
      <CollectionAccessProvider canEdit={side.canEdit}>
        <div className="flex flex-col gap-10">
          <p className="text-meta text-text-2">
            {count} {count === 1 ? 'card' : 'cards'} ·{' '}
            {formatMoney(total.valueMinor, currency)}
          </p>
          {side.lines.length === 0 && (
            <p className="text-meta text-text-2">No cards yet.</p>
          )}
          {looseLines.map(renderLine)}
          {decks.map((deck) => {
            const deckValue = sideTotalMinor({
              lines: deck.lines,
              ratePct: 100,
            }).valueMinor
            const deckCount = deck.lines.reduce((sum, line) => sum + line.qty, 0)
            return (
              <section
                key={deck.id}
                aria-label={`Whole deck ${deck.name}`}
                className="mt-6 flex flex-col gap-8 border-t border-border pt-12"
              >
                <div className="flex items-center gap-10 px-2">
                  <span className="text-text-2">
                    <DeckIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-row-value font-bold text-text">
                      {deck.name}
                    </div>
                    <div className="text-meta-search text-text-2">
                      Whole deck · {deckCount} {deckCount === 1 ? 'card' : 'cards'} ·{' '}
                      {formatMoney(deckValue, currency)}
                    </div>
                  </div>
                  {side.canEdit && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onRemove(deck.lines[0]!)}
                      className="flex-shrink-0 rounded-pill border border-border px-11 py-6 text-chip-toggle font-bold text-text"
                    >
                      Remove deck
                    </button>
                  )}
                </div>
                {deck.lines.map(renderLine)}
              </section>
            )
          })}
          <div className="mt-8 grid grid-cols-2 gap-8">
            {onAdd && side.canEdit ? (
              <SecondaryButton onClick={onAdd}>Add cards</SecondaryButton>
            ) : (
              <span />
            )}
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </div>
        </div>
      </CollectionAccessProvider>
    </Sheet>
  )
}
