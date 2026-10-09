// Ligne de résultat de recherche. La vignette ne vient jamais de l'API Scryfall
// en direct : elle passe par le proxy sur disque (`thumbUrl`) —
// jamais construite à la main (docs/development.md).
//
// Comportement :
//   - `onClick` optionnel rend la ligne cliquable (bouton) plutôt qu'un
//     simple conteneur — un résultat de recherche ouvre `AddCardSheet`
//     préchargée.
//   - sous-titre `CODE · Set name · #num`, sans la rareté.
//   - le prix passe par `formatMoney`/`currency`, jamais `$` en dur.
//   - les symboles de mana passent par le composant partagé `ManaCost`,
//     qui couvre les 75 symboles + repli lettré.
import { ManaCost } from '@/components/cards/mana-cost'
import type { Currency } from '@/lib/format/money'
import { formatMoney } from '@/lib/format/money'
import type { CardSearchItem } from '@/lib/search/search-cards'

function formatPrice(price: number | null, currency: Currency): string {
  return price === null ? '—' : formatMoney(Math.round(price * 100), currency)
}

export function SearchRow({
  item,
  currency,
  onClick,
}: {
  item: CardSearchItem
  currency: Currency
  onClick?: () => void
}) {
  const setLine = `${item.setCode.toUpperCase()} · ${item.setName} · #${item.collectorNumber}`

  const content = (
    <>
      <div className="h-thumb-search w-thumb-search flex-shrink-0 overflow-hidden rounded-thumb bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={item.thumbUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-6">
          <div className="truncate text-card-name-search font-bold text-text">{item.name}</div>
          <ManaCost cost={item.manaCost} size={14} />
        </div>
        <div className="mt-2 text-meta-search text-text-2">{setLine}</div>
      </div>
      <div className="whitespace-nowrap font-mono text-card-name-search font-bold text-accent-text">
        {formatPrice(item.price, currency)}
      </div>
    </>
  )

  const className = 'flex items-center gap-12 rounded-row border border-border bg-surface-1 px-12 py-10'

  if (!onClick) {
    return <div className={className}>{content}</div>
  }

  return (
    <button type="button" onClick={onClick} className={`w-full text-left ${className}`}>
      {content}
    </button>
  )
}
