'use client'

// Rangée quantité / condition / foil d'un holding — **un seul composant
// pour les deux écrans** (deux implémentations parallèles mobile/desktop
// divergent en quelques semaines ; les écrans partagent les mêmes
// composants). Extraite telle quelle de
// `components/cards/card-sheet.tsx` avec le layout desktop : la feuille mobile et le
// panneau d'aperçu desktop montent désormais cette rangée, pas deux copies
// qui se ressembleraient au jour de la livraison.
//
// Purement contrôlée, comme `QtyStepper` (le parent gère le rollback) —
// aucune mutation, aucun accès au cache : l'écran appelant
// détient `qtyMutation`/`patchMutation` et leur mise à jour optimiste.
import { Sparkles } from 'lucide-react'

import { QtyStepper } from '@/components/cards/qty-stepper'
import type { Condition, Finish } from '@spellcache/db/schema'

const CONDITIONS: Condition[] = ['nm', 'lp', 'mp', 'hp', 'dmg']
// Exportée pour que `CardSheet` (lecture seule, `card-sheet.tsx`)
// affiche le même texte long sans le réénumérer — une seconde table à cet
// endroit serait exactement la « seconde implémentation » à éviter, même si
// elle ne rend qu'une valeur plutôt qu'un contrôle.
export const CONDITION_LABEL: Record<Condition, string> = {
  nm: 'Near mint',
  lp: 'Lightly played',
  mp: 'Moderately played',
  hp: 'Heavily played',
  dmg: 'Damaged',
}

export function CardEditControls({
  holdingId,
  qty,
  condition,
  finish,
  onQtyChange,
  onConditionChange,
  onFoilChange,
}: {
  holdingId: string
  qty: number
  condition: Condition
  finish: Finish
  onQtyChange: (next: number) => void
  onConditionChange: (condition: Condition) => void
  onFoilChange: (isFoil: boolean) => void
}) {
  const isFoil: boolean = finish !== 'nonfoil'
  const nextFinish: Finish = isFoil ? 'nonfoil' : 'foil'

  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="flex items-center gap-9 rounded-control border border-border bg-surface-2 px-9 py-5">
        <QtyStepper holdingId={holdingId} qty={qty} onChange={onQtyChange} />
      </div>
      <select
        value={condition}
        onChange={(event) => onConditionChange(event.target.value as Condition)}
        aria-label="Condition"
        className="rounded-control border border-border bg-surface-2 px-11 py-8 text-meta font-semibold text-text"
      >
        {CONDITIONS.map((value) => (
          <option key={value} value={value}>
            {CONDITION_LABEL[value]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onFoilChange(nextFinish !== 'nonfoil')}
        className={
          isFoil
            ? 'flex items-center gap-6 rounded-control border border-border-accent bg-accent-bg px-12 py-8 text-meta font-bold text-accent-text'
            : 'flex items-center gap-6 rounded-control border border-border bg-surface-2 px-12 py-8 text-meta font-bold text-text-2'
        }
      >
        <Sparkles width={14} height={14} strokeWidth={1.75} />
        Foil
      </button>
    </div>
  )
}
