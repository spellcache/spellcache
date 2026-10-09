// Bande de valeur collante de l'accueil Shelves (`font-size:12px;
// color:#5a90ff;font-weight:700;font-family:'Geist Mono'`) — format
// `<montant> · <variation>`, la variation disparaît quand `delta7d` est
// `null` (même contrat que la puce de `ValueCard`). Ne porte que la ligne
// mono : le titre `Collection` et les trois boutons ronds de l'en-tête
// restent assemblés par `shelves-view.tsx`, qui pose aussi le
// `position: sticky` du conteneur (en sticky dans le conteneur de scroll,
// pas en fixed).
//
// Contrairement à `ValueCard`, le design validé ne dessine ici ni icône ni
// second ton : un seul exemple de variation positive, dans le même bleu que
// le montant. Seule la teinte de la variation bascule vers `--color-danger`
// quand `delta7d` est négatif — le montant, lui, reste fixé au bleu du pixel
// (`#5a90ff` = `--color-accent-text`) dans les deux cas : le design ne
// dessine jamais le montant en rouge (le `<div>` englobant les deux ne doit
// pas porter `text-danger`, seule la variation le peut), sans inventer d'icône absente de ce pixel précis.
import { formatMoney, type Currency } from '@/lib/format/money'

export function ValueStrip({
  amountMinor,
  currency,
  delta7d,
}: {
  amountMinor: number
  currency: Currency
  delta7d: number | null
}) {
  const amount = formatMoney(amountMinor, currency)
  const delta = delta7d === null ? null : `${delta7d >= 0 ? '+' : ''}${delta7d}%`

  return (
    <div className="font-mono text-value-strip font-bold text-accent-text">
      {amount}
      {delta !== null && (
        <>
          {' · '}
          <span className={delta7d !== null && delta7d < 0 ? 'text-danger' : undefined}>{delta}</span>
        </>
      )}
    </div>
  )
}
