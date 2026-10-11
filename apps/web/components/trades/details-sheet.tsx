'use client'

// Feuille « View details » d'un côté : chaque carte avec sa vignette, sa
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
          {side.lines.map((line) => (
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
                          line.finish !== finish.value &&
                          onKey(line, { finish: finish.value })
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
                        onClick={() =>
                          line.condition !== condition && onKey(line, { condition })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
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
