// Ligne de carte, densité `rows` — 84px de haut
// (`ROW_HEIGHT.rows`). Contrôle de quantité en ligne : la puce `×N` cède la
// place à un stepper quand `onQtyChange` est fourni — absent en mode sélection,
// où la puce reste la seule lecture, cf. `container-view.tsx`.
//
// La ligne n'a pas de hauteur forcée : elle additionne exactement à 84px
// (bordure 2px + padding 10px×2 + vignette 44×61 en flux), la vignette
// dominant de peu une colonne de texte qui culmine à ~62px. C'est le nombre que
// rend le design validé lui-même, dont aucune boîte ne déclare de hauteur.
//
// Une première version visait 76px, obtenus en sortant la vignette du flux
// par une marge négative et en écrasant chaque ligne de texte en
// `leading-none` : deux compensations d'un `line-height: 1.5` que seul le
// preflight Tailwind introduisait, absent du design. Le socle
// `line-height: normal` d'`app/globals.css` supprime la cause, donc les
// deux compensations avec.
import { Check } from 'lucide-react'

import { QtyStepper } from '@/components/cards/qty-stepper'
import { ManaCost } from '@/components/cards/mana-cost'
import type { Condition } from '@spellcache/db/schema'

// `selectable`/`selected` : même case ronde 18px et mêmes tokens de
// fond/bordure que `CompactRow` — la seule densité dessinée pour la
// sélection groupée. `VirtualList` bascule
// pourtant la sélection quelle que soit la densité (`SelectableItem`
// enveloppe toutes les rangées, `components/cards/virtual-list.tsx`) ; sans
// cet état visuel ici, un appui long en densité `rows` entrerait en
// sélection sans qu'aucune ligne ne le montre. Réutilise les tokens
// existants plutôt que d'inventer un traitement propre à cette densité
// (docs/development.md : ne pas inventer de langage visuel).
export function CardRow({
  holdingId,
  thumbUrl,
  name,
  manaCost,
  setCode,
  setName,
  collectorNumber,
  condition,
  isFoil,
  qty,
  available,
  priceLabel,
  onQtyChange,
  onOpen,
  selectable = false,
  selected = false,
  current = false,
}: {
  // Requis seulement quand `onQtyChange` est fourni (le stepper en a besoin,
  // même contrat que `CompactRow`) — laissé optionnel pour ne pas forcer
  // les rares appelants sans quantité éditable à en inventer un.
  holdingId?: string
  thumbUrl: string
  name: string
  manaCost: string | null
  setCode: string
  // Nom complet du set — `null`/absent replie sur le seul code, jamais une
  // chaîne vide qui laisserait un « · » orphelin.
  setName?: string | null
  collectorNumber: string
  condition: Condition
  isFoil: boolean
  qty: number
  // Voir `CompactRow` : même règle — une
  // puce verte « IN DECK » remplace désormais le suffixe textuel « · N
  // available » (badge `tone="deck"`), affichée dès qu'une partie de `qty`
  // est réservée par un deck `built`.
  available?: number
  priceLabel: string
  // Stepper en ligne à la place de la puce `×N` — absent en mode sélection
  // (`container-view.tsx` ne le passe pas alors), où la puce redevient une
  // simple lecture.
  onQtyChange?: (next: number) => void
  onOpen: () => void
  selectable?: boolean
  selected?: boolean
  // Voir `CompactRow` : ligne courante du panneau d'aperçu desktop,
  // fond et bordure de `selected` sans sa coche.
  current?: boolean
}) {
  const highlighted = selected || current
  const reserved = available !== undefined && available < qty
  const setLine = `${setCode.toUpperCase()}${setName ? ` · ${setName}` : ''} #${collectorNumber}`

  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        highlighted
          ? 'flex w-full items-center gap-12 rounded-row border border-border-accent bg-accent-bg px-12 py-10 text-left'
          : 'flex w-full items-center gap-12 rounded-row border border-border bg-surface-1 px-12 py-10 text-left'
      }
    >
      {selectable && (
        <span
          aria-hidden="true"
          className={
            selected
              ? 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-accent bg-accent'
              : 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-text-3 bg-transparent'
          }
        >
          {selected && <Check width={11} height={11} strokeWidth={3.5} className="text-on-accent" />}
        </span>
      )}
      <div className="h-thumb-row w-thumb-row flex-shrink-0 overflow-hidden rounded-thumb-row bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-6">
          <div className="min-w-0 truncate text-card-name-row font-bold text-text">{name}</div>
          <ManaCost cost={manaCost} size={14} />
        </div>
        <div className="mt-2 text-setline-row text-text-2">{setLine}</div>
        <div className="mt-6 flex gap-6">
          <span className="rounded-pill bg-surface-2 px-7 py-2 text-pill-badge font-bold tracking-pill-badge text-text-2">
            {condition.toUpperCase()}
          </span>
          {isFoil && (
            <span className="rounded-pill bg-surface-2 px-7 py-2 text-pill-badge font-bold tracking-pill-badge text-accent-text">
              FOIL
            </span>
          )}
          {onQtyChange && holdingId ? (
            <span onClick={(event) => event.stopPropagation()}>
              <QtyStepper holdingId={holdingId} qty={qty} onChange={onQtyChange} />
            </span>
          ) : (
            <span className="rounded-pill bg-surface-2 px-7 py-2 text-pill-badge font-bold tracking-pill-badge text-text-2">
              ×{qty}
            </span>
          )}
          {reserved && (
            <span className="rounded-pill bg-surface-2 px-7 py-2 text-pill-badge font-bold tracking-pill-badge text-success">
              IN DECK
            </span>
          )}
        </div>
      </div>
      <div className="whitespace-nowrap font-mono text-price-row font-bold text-accent-text">
        {priceLabel}
      </div>
    </button>
  )
}
