// Carte de valeur totale, au pixel du design validé. Les chiffres du bloc de
// valeur sont en Inter, jamais en mono (la mono reste
// réservée aux prix/quantités/numéros de collecteur/codes de set d'ailleurs
// dans l'app).
//
// La puce de variation reste dans le même blanc que le reste du bandeau
// (`rgba(255,255,255,0.85)`, `--color-value-band-chip`) que la tendance soit
// positive ou négative — seule l'icône bascule entre `trending-up` et
// `trending-down` (le rouge `--color-danger` d'une première version est
// délibérément retiré — une tendance négative n'est pas une erreur). Absente
// quand `delta7d` vaut `null`.
import { TrendingDown, TrendingUp } from 'lucide-react'

import { formatCount, formatMoney, type Currency } from '@/lib/format/money'

export function ValueCard(props: {
  amountMinor: number
  currency: Currency
  delta7d: number | null
  cards: number
  unique: number
  addedThisWeek: number
}) {
  const { amountMinor, currency, delta7d, cards, unique, addedThisWeek } = props

  return (
    <div className="mb-14 rounded-card bg-gradient-value-band p-20">
      <div className="text-meta font-semibold tracking-value-label text-value-band-label">
        TOTAL COLLECTION VALUE
      </div>
      <div className="mt-5 flex items-baseline gap-10">
        <div className="text-value-total font-extrabold tracking-value-amount text-on-accent">
          {formatMoney(amountMinor, currency)}
        </div>
        {delta7d !== null && (
          <div className="flex items-center gap-3 text-body font-bold text-value-band-chip">
            {delta7d < 0 ? (
              <TrendingDown width={14} height={14} strokeWidth={1.75} />
            ) : (
              <TrendingUp width={14} height={14} strokeWidth={1.75} />
            )}
            {delta7d >= 0 ? '+' : ''}
            {delta7d}%
          </div>
        )}
      </div>
      <div className="mt-14 flex gap-20">
        <div>
          <div className="text-value-stat font-bold text-on-accent">{formatCount(cards)}</div>
          <div className="text-value-caption text-value-band-caption">cards</div>
        </div>
        <div>
          <div className="text-value-stat font-bold text-on-accent">{formatCount(unique)}</div>
          <div className="text-value-caption text-value-band-caption">unique</div>
        </div>
        <div>
          <div className="text-value-stat font-bold text-on-accent">{formatCount(addedThisWeek)}</div>
          <div className="text-value-caption text-value-band-caption">added this week</div>
        </div>
      </div>
    </div>
  )
}
