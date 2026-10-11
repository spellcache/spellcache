// Liste compacte d'un côté d'un échange : une ligne de texte par carte
// (quantité, nom, set et état, valeur de la ligne), et l'argent en dernière
// ligne. La vue détaillée (feuille « View details ») porte le reste.
import { formatMoney, type Currency } from '@/lib/format/money'
import { unitPriceMinor } from '@/lib/trades/pricing'
import type { TradeLineView } from '@/lib/trades/trades'

const FINISH_SHORT = { nonfoil: null, foil: 'F', etched: 'E' } as const

export function CompactCardList({
  lines,
  currency,
  cash,
}: {
  lines: TradeLineView[]
  currency: Currency
  cash?: { amountMinor: number; label: string }
}) {
  if (lines.length === 0 && !cash) {
    return (
      <p className="rounded-control bg-bg px-12 py-10 text-meta text-text-2">
        No cards yet.
      </p>
    )
  }
  return (
    <ul
      className="m-0 list-none rounded-control bg-bg px-12 py-8 font-mono text-meta leading-normal"
      data-testid="trade-compact-list"
    >
      {lines.map((line) => {
        const unit = unitPriceMinor(line)
        const tags = [
          line.setCode.toUpperCase(),
          FINISH_SHORT[line.finish],
          line.condition.toUpperCase(),
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <li key={line.id} className="flex gap-8">
            <span className="text-text-2">{line.qty}</span>
            <span className="min-w-0 flex-1 truncate text-text">
              {line.name} <span className="text-text-3">{tags}</span>
            </span>
            <span className="text-accent-text">
              {unit === null ? '—' : formatMoney(unit * line.qty, currency)}
            </span>
          </li>
        )
      })}
      {cash && cash.amountMinor > 0 && (
        <li
          className={`flex gap-8 ${lines.length > 0 ? 'mt-4 border-t border-dashed border-border pt-4' : ''}`}
        >
          <span className="text-text-2">$</span>
          <span className="min-w-0 flex-1 truncate text-text">{cash.label}</span>
          <span className="text-accent-text">
            {formatMoney(cash.amountMinor, currency)}
          </span>
        </li>
      )}
    </ul>
  )
}
