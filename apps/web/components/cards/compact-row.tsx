// Ligne de carte en densité `compact` (défaut de `users.density`) — 58px de
// haut (padding 7px + vignette 42px + bordures).
//
// Quantité en lecture seule (`×N`), comme `CardRow` et `GridTile` : un
// stepper en ligne se déclenchait au défilement d'un simple effleurement. La
// quantité se modifie dans la feuille d'édition (`EditCardSheet`), jamais
// dans la feuille de détail.
//
// `selectable`/`selected` : case ronde 18px — fond/bordure de la ligne et de
// la case repris du design validé
// (`sel` ⇒ `#161d2e`/`rgba(61,123,255,0.55)` pour la ligne, `#3d7bff` plein
// pour la case ; sans `sel`, la case reste vide — bordure `#4a505e`, coche
// `opacity:0`). Aucun gestionnaire de clic propre à la case : le geste
// (appui long pour entrer, appui simple pour basculer) vit entièrement dans
// `components/cards/virtual-list.tsx`, qui intercepte le clic en phase de
// capture avant qu'il n'atteigne `onClick={onOpen}` ci-dessous — la case
// n'est donc que la représentation visuelle de `selected`, jamais une
// seconde source de vérité du geste (même case, prête pour l'entrée par clic
// direct sur desktop).
import { Check } from 'lucide-react'

import { ManaCost } from '@/components/cards/mana-cost'
import type { Condition } from '@spellcache/db/schema'
import { SetIcon } from '@/components/cards/set-icon'

export function CompactRow({
  thumbUrl,
  name,
  manaCost,
  setCode,
  setIconUri,
  collectorNumber,
  condition,
  isFoil,
  qty,
  available,
  priceLabel,
  onOpen,
  selectable = false,
  selected = false,
  current = false,
}: {
  thumbUrl: string
  name: string
  manaCost: string | null
  setCode: string
  setIconUri?: string | null
  collectorNumber: string
  condition: Condition
  isFoil: boolean
  qty: number
  // Quantité disponible de cette ligne —
  // optionnelle, `undefined` équivaut à « rien de réservé » (aucun appelant
  // hors `container-view.tsx` n'a besoin de la calculer, ex. les fixtures de
  // `tests/integration/quantities.test.ts`). N'ajoute une mention que quand
  // une partie de `qty` est effectivement réservée par un deck `built` —
  // jamais de texte redondant sur une ligne qui n'a rien de réservé.
  available?: number
  priceLabel: string
  onOpen: () => void
  selectable?: boolean
  selected?: boolean
  // Ligne courante du panneau d'aperçu desktop — fond et bordure de
  // `selected`, jamais sa coche : voir `components/selection/
  // row-visual-state.ts`, seul endroit où la règle est écrite.
  current?: boolean
}) {
  const highlighted = selected || current
  const reserved = available !== undefined && available < qty
  const setLine = `${setCode.toUpperCase()} #${collectorNumber} · ${condition.toUpperCase()}`
  const reservedSuffix = reserved ? ` · ${available} available` : ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen()
      }}
      className={
        highlighted
          ? 'flex items-center gap-10 rounded-row-compact border border-border-accent bg-accent-bg px-10 py-7 text-left'
          : 'flex items-center gap-10 rounded-row-compact border border-border bg-surface-1 px-10 py-7 text-left'
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
      <div className="h-thumb-compact w-thumb-compact flex-shrink-0 overflow-hidden rounded-thumb bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-6">
          <div className="min-w-0 truncate text-card-name-compact font-bold text-text">{name}</div>
          <ManaCost cost={manaCost} size={12} gap={1} />
        </div>
        {/* `truncate` : sans lui, un numéro de collection composite ajouté
            au suffixe `available` casse la hauteur fixe de 58px de cette
            ligne virtualisée (docs/development.md, anti-pattern) — mesuré à 358px de
            large, `PLST #DMR-34 · NM · 3 available` rendait 70.25px. Même
            garde que le nom de carte juste au-dessus, qui la porte déjà.
            `FOIL` suit la condition : sur la ligne du nom, il tronquait les
            noms longs. */}
        <div className="mt-1 flex min-w-0 items-center gap-5 text-subline-compact text-text-2">
          <SetIcon uri={setIconUri} />
          <span className="min-w-0 truncate whitespace-nowrap">
            {setLine}
            {isFoil && (
              <>
                {' · '}
                <span className="font-bold tracking-badge-foil text-accent-text">FOIL</span>
              </>
            )}
            {reservedSuffix}
          </span>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-7">
        <span className="font-mono text-body font-bold text-text">×{qty}</span>
        <span className="min-w-price-compact text-right font-mono text-body font-bold text-accent-text">
          {priceLabel}
        </span>
      </div>
    </div>
  )
}
