// Résultat du tiroir d'ajout du deck builder, 62px de haut. Un seul tap sur le
// bouton rond ajoute la carte, le tiroir ne se ferme pas
// (`components/decks/add-drawer.tsx` gère l'état d'ouverture, pas ce
// composant). Le bouton n'est jamais désactivé : chaque tap est optimiste et
// indépendant côté `AddDrawer`, un round-trip serveur en cours ne doit donc
// jamais avaler le tap suivant.
//
// `onOpenPrintingPicker` (sélecteur d'impression uniquement à la demande)
// ouvre le sélecteur sans ajouter d'icône ni de contrôle absent du design :
// la zone vignette + texte devient elle-même le déclencheur — même vocabulaire
// que les autres lignes de l'app qui ouvrent une feuille au tap de la ligne
// (`CompactRow`), pas un langage visuel inventé (docs/development.md). Le
// bouton rond `+` reste séparé et ajoute toujours au tap unique par défaut
// (`nonfoil`) — le sélecteur ne remplace jamais ce geste rapide, il n'apparaît
// que si on le demande. `undefined` (aucune finition alternative pour cette
// impression) rend la zone inerte.
import { Plus } from 'lucide-react'

import { ManaCost } from '@/components/cards/mana-cost'
import { formatMoney, type Currency } from '@/lib/format/money'

function formatPrice(price: number | null, currency: Currency): string {
  // Devise du compte, jamais `$` en dur (même règle que `SearchRow`).
  return price === null ? '—' : formatMoney(Math.round(price * 100), currency)
}

export function AddRow({
  thumbUrl,
  name,
  manaCost,
  setLine,
  price,
  currency,
  ownedElsewhere,
  inDeckQty,
  onAdd,
  onOpenPrintingPicker,
}: {
  thumbUrl: string
  name: string
  manaCost: string | null
  setLine: string
  price: number | null
  currency: Currency
  ownedElsewhere: number
  inDeckQty: number
  onAdd: () => void
  onOpenPrintingPicker?: () => void
}) {
  const cardContent = (
    <>
      <div className="h-thumb-add w-thumb-add flex-shrink-0 overflow-hidden rounded-thumb bg-surface-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-6">
          <div className="min-w-0 truncate text-card-name-compact font-bold text-text">
            {name}
          </div>
          <ManaCost cost={manaCost} size={12} gap={1} />
        </div>
        <div className="mt-2 flex items-center gap-7">
          <span className="min-w-0 truncate text-subline-compact text-text-2">
            {setLine}
          </span>
          {ownedElsewhere > 0 && (
            <span className="flex-shrink-0 text-status-badge font-bold tracking-status-badge text-success">
              {ownedElsewhere} owned
            </span>
          )}
          {inDeckQty > 0 && (
            <span className="flex-shrink-0 text-status-badge font-bold tracking-status-badge text-accent-text">
              in deck ×{inDeckQty}
            </span>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="flex items-center gap-10 rounded-control border border-border bg-surface-2 px-10 py-8">
      {onOpenPrintingPicker ? (
        <button
          type="button"
          aria-label={`${name} — choose printing`}
          onClick={onOpenPrintingPicker}
          className="flex min-w-0 flex-1 items-center gap-10 text-left"
        >
          {cardContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-10">{cardContent}</div>
      )}
      <span className="flex-shrink-0 whitespace-nowrap font-mono text-row-price font-bold text-accent-text">
        {formatPrice(price, currency)}
      </span>
      <button
        type="button"
        aria-label={`Add ${name}`}
        onClick={onAdd}
        className="flex h-add-row-button w-add-row-button flex-shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
      >
        <Plus width={17} height={17} strokeWidth={2.2} />
      </button>
    </div>
  )
}
