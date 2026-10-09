// Ligne de carte en densité `compact` (défaut de `users.density`) — 58px de
// haut (padding 7px + vignette 42px + bordures). `CardRow` porte
// le même stepper en ligne ; `GridTile` seule reste à la puce `×N` (jamais
// de stepper en grille).
//
// `onQtyChange` optionnel : absent en mode sélection (`container-view.tsx`
// ne le passe pas alors), la ligne replie sur une puce `×N` en lecture
// seule — un stepper dans une sélection est du bruit, la feuille d'édition
// groupée possède déjà la quantité.
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

import { QtyStepper } from '@/components/cards/qty-stepper'
import { ManaCost } from '@/components/cards/mana-cost'
import type { Condition } from '@spellcache/db/schema'

export function CompactRow({
  holdingId,
  thumbUrl,
  name,
  manaCost,
  setCode,
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
  holdingId: string
  thumbUrl: string
  name: string
  manaCost: string | null
  setCode: string
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
  // Voir la note d'en-tête : `undefined` en mode sélection replie sur une
  // puce `×N`.
  onQtyChange?: (next: number) => void
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
  const setLine = `${setCode.toUpperCase()} #${collectorNumber} · ${condition.toUpperCase()}${
    reserved ? ` · ${available} available` : ''
  }`

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
          {isFoil && (
            <span className="flex-shrink-0 text-badge-foil font-bold tracking-badge-foil text-accent-text">
              FOIL
            </span>
          )}
        </div>
        {/* `truncate` : sans lui, un numéro de collection composite ajouté
            au suffixe `available` casse la hauteur fixe de 58px de cette
            ligne virtualisée (docs/development.md, anti-pattern) — mesuré à 358px de
            large, `PLST #DMR-34 · NM · 3 available` rendait 70.25px. Même
            garde que le nom de carte juste au-dessus, qui la porte déjà. */}
        <div className="mt-1 truncate whitespace-nowrap text-subline-compact text-text-2">{setLine}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-7" onClick={(event) => event.stopPropagation()}>
        {onQtyChange ? (
          <QtyStepper holdingId={holdingId} qty={qty} onChange={onQtyChange} />
        ) : (
          <span className="font-mono text-body font-bold text-text">×{qty}</span>
        )}
        <span className="min-w-price-compact text-right font-mono text-body font-bold text-accent-text">
          {priceLabel}
        </span>
      </div>
    </div>
  )
}
