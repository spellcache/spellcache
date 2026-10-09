'use client'

// Coquille commune aux feuilles `Filters`/`Sort & group`. Un seul modèle
// d'overlay : bottom sheet sous le point de bascule, modale centrée au-delà —
// et c'est `Sheet` qui porte cette bascule (via `desktop:`). Le composant ne
// garde que le câblage du déclencheur.
import { cloneElement, type ReactElement, type ReactNode } from 'react'

import { Sheet } from './sheet'

// Ré-exportée : les feuilles bâties sur cette coquille ne dépendent que d'elle.
export { SHEET_SCROLL_BLEED } from './sheet'

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  headerAction,
  trigger,
  maxHeight = false,
  scrollBody = true,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  headerAction?: ReactNode
  // Le bouton qui ouvre la coquille — jamais son propre `onClick` : câblé
  // ici par clonage.
  trigger: ReactElement<{ onClick?: () => void }>
  maxHeight?: boolean
  // Voir `Sheet` : `false` quand le contenu pose sa propre `ScrollArea`.
  scrollBody?: boolean
  children: ReactNode
}) {
  return (
    <>
      {cloneElement(trigger, { onClick: () => onOpenChange(!open) })}
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        headerAction={headerAction}
        maxHeight={maxHeight}
        scrollBody={scrollBody}
      >
        {children}
      </Sheet>
    </>
  )
}
