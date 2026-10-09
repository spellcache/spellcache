'use client'

// Menu contextuel d'appui long, rendu par la coquille Radix déjà livrée du
// projet — `Sheet` (`components/ui/sheet.tsx`, un `@radix-ui/react-dialog`),
// pas `@radix-ui/react-context-menu` : cette dépendance n'est pas installée,
// et son déclencheur natif est l'évènement `contextmenu` (clic droit), inadapté
// de toute façon — le glisser-déposer sur une piste horizontale entre en
// conflit avec le défilement tactile, d'où un seuil de déplacement comme pour
// l'appui long de la liste de cartes. Le geste est donc posé par l'appelant
// (même patron que `useSelectionGesture`, `components/cards/virtual-list.tsx`)
// et ce composant n'est que la surface ouverte à l'arrivée.
//
// Aucun langage visuel neuf : les lignes reprennent le gabarit de ligne déjà
// livré (surface, bordure, rayon, typographie), et un élément sans flux
// livré est rendu désactivé plutôt qu'absent — même traitement que les
// boutons `Add to deck`/`Binder` de la feuille de carte et que la ligne
// `Binder` de la feuille `Filters`.
import type { ReactNode } from 'react'

import { Sheet } from './sheet'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect?: () => void
  // Rendu mais inerte, faute de flux cible livré (voir le commentaire de
  // tête).
  disabled?: boolean
}

export function ContextMenu({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  items: ContextMenuItem[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-8">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              onOpenChange(false)
              item.onSelect?.()
            }}
            className="flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text disabled:opacity-60"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
