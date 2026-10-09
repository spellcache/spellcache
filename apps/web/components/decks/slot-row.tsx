// Ligne de slot d'un deck, 58px de haut — même gabarit que `CompactRow`
// (padding 7px/10px, vignette 30×42, `gap-10`), pas une approximation
// recopiée : les deux composants partagent la même formule de hauteur,
// prouvée par `tests/unit/row-heights.test.tsx` pour `CompactRow`.
//
// `checkable`/`checked` portent la case de sélection (utilisée par la
// feuille `Assemble`) — l'écran `Planning deck` ne les active jamais, donc
// `onOpen` n'est pas câblé ici : aucun geste n'est prévu sur une ligne de
// slot en dehors de la case à cocher.
import { Check } from 'lucide-react'

import { ManaCost } from '@/components/cards/mana-cost'

export function SlotRow({
  thumbUrl,
  name,
  manaCost,
  setLine,
  need,
  state,
  priceLabel,
  checkable = false,
  checked = false,
  onToggle,
}: {
  thumbUrl: string
  name: string
  manaCost: string | null
  setLine: string
  need: number
  // `'unknown'` : la ligne ne dit rien de la possession — ni puce
  // `Owned`/`Missing`, ni traitement d'alerte. C'est le seul état admissible
  // sur la page publique `/s/<id>`, qui ne doit exposer ni les quantités
  // possédées ailleurs ni les emplacements manquants : afficher `Owned` sur
  // chaque ligne y serait à la fois faux
  // (le lecteur n'est pas le propriétaire) et une affirmation sur l'état de
  // la collection. Membre ajouté à l'union, pas prop supplémentaire : les
  // appelants privés (builder, assemblage) passent toujours `'owned'`/`'missing'` et
  // rendent exactement ce qu'ils rendaient.
  state: 'owned' | 'missing' | 'unknown'
  priceLabel: string
  checkable?: boolean
  checked?: boolean
  onToggle?: () => void
}) {
  const missing = state === 'missing'

  // Cochable : la tuile entière est le bouton (demande produit), pas
  // seulement le rond — qui devient un simple indicateur visuel, un bouton ne
  // pouvant pas en contenir un autre.
  const Row = checkable ? 'button' : 'div'

  return (
    <Row
      {...(checkable ? { type: 'button' as const, 'aria-pressed': checked, onClick: onToggle } : {})}
      className={`flex w-full items-center gap-10 rounded-row-compact border bg-surface-1 px-10 py-7 text-left ${
        missing ? 'border-border-deck-status-warn' : 'border-border'
      }`}
    >
      {checkable && (
        <span
          aria-hidden
          className={
            checked
              ? 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-accent bg-accent'
              : 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-text-3 bg-transparent'
          }
        >
          {checked && <Check width={11} height={11} strokeWidth={3.5} className="text-on-accent" />}
        </span>
      )}
      <div
        className={`h-thumb-compact w-thumb-compact flex-shrink-0 overflow-hidden rounded-thumb bg-surface-2 ${
          missing ? 'opacity-55' : ''
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-6">
          <span className="flex-shrink-0 font-mono text-slot-need font-extrabold text-text-2">{need}×</span>
          <div className="min-w-0 truncate text-card-name-compact font-bold text-text">{name}</div>
          <ManaCost cost={manaCost} size={12} gap={1} />
        </div>
        <div className="mt-1 flex items-center gap-7">
          <span className="min-w-0 truncate text-subline-compact text-text-2">{setLine}</span>
          {state !== 'unknown' && (
            <span
              className={`flex-shrink-0 text-status-badge font-bold uppercase tracking-status-badge ${
                missing ? 'text-warning' : 'text-success'
              }`}
            >
              {missing ? 'Missing' : 'Owned'}
            </span>
          )}
        </div>
      </div>
      <span
        className={`flex-shrink-0 font-mono text-row-price font-bold ${missing ? 'text-warning' : 'text-accent-text'}`}
      >
        {priceLabel}
      </span>
    </Row>
  )
}
