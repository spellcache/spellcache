'use client'

// Sélecteur de densité à trois icônes de la barre de commande (dessiné pour
// la barre desktop, réutilisé tel quel sur mobile : il ne compose que des
// tokens déjà livrés). Écrase la vue courante (paramètre d'URL porté par
// `ViewState.density`) sans jamais modifier
// `users.density` (docs/development.md — préférence de compte, seule `getContainerHeader`
// y lit une valeur par défaut quand `density` est `null`).
import { LayoutGrid, List, Rows3 } from 'lucide-react'

import type { Density } from '@/lib/view-state/parse'

const OPTIONS: Array<{ value: Density; label: string; Icon: typeof Rows3 }> = [
  { value: 'rows', label: 'Rows', Icon: Rows3 },
  { value: 'compact', label: 'Compact', Icon: List },
  { value: 'grid', label: 'Grid', Icon: LayoutGrid },
]

export function DensityPicker({
  value,
  onChange,
  translucent = false,
}: {
  value: Density
  onChange: (value: Density) => void
  // Pad translucide (`rgba(20,24,33,0.9)`) — même bascule que
  // `CommandBar`/`translucent`, posée sur le fond du sélecteur seul (les
  // boutons individuels gardent leurs couleurs `bg-accent`/`bg-transparent`
  // habituelles).
  translucent?: boolean
}) {
  return (
    <div
      className={`flex flex-shrink-0 gap-3 rounded-control p-3 ${
        translucent ? 'bg-command-bar-translucent-pad' : 'bg-surface-2'
      }`}
    >
      {OPTIONS.map(({ value: optionValue, label, Icon }) => {
        const active = optionValue === value
        return (
          <button
            key={optionValue}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
            // 30×30 — pas les 32×32 de `--width-density-button`/
            // `--height-density-button` (la hauteur de la rangée entière :
            // champ, déclencheur de tri, conteneur du sélecteur).
            className={`flex h-density-icon-button w-density-icon-button items-center justify-center rounded-segment ${
              active ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'
            }`}
          >
            <Icon width={16} height={16} strokeWidth={1.75} />
          </button>
        )
      })}
    </div>
  )
}
