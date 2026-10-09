'use client'

// Une zone défilante et sa barre en surimpression. C'est la brique de tout
// défilement de l'application : le corps d'un écran, celui d'une feuille.
// La boîte extérieure porte le positionnement du curseur, l'intérieure fait
// le défilement — le curseur reste ainsi collé au bord droit de la zone,
// par-dessus le contenu, sans jamais lui prendre de largeur.
import { useRef } from 'react'

import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar'

export function ScrollArea({
  children,
  className = '',
  outerClassName = '',
}: {
  children: React.ReactNode
  // Appliquée à la zone défilante (padding, mise en page du contenu).
  className?: string
  // Appliquée à la boîte qui positionne le curseur — pour l'élargir au-delà
  // du contenu (voir `SHEET_SCROLL_BLEED`).
  outerClassName?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)

  return (
    <div className={`relative flex min-h-0 min-w-0 flex-1 ${outerClassName}`}>
      <div
        ref={viewport}
        // Arriver au bout d'une liste ne doit pas se mettre à tirer ce qui
        // est derrière elle.
        className={`min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain ${className}`}
      >
        {children}
      </div>
      <OverlayScrollbar target={viewport} />
    </div>
  )
}
