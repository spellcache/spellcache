'use client'

// Mécanique de piste horizontale d'une étagère, partagée par les deux
// onglets (snap, scrollbar masquée, chargement paresseux ; la réécrire
// ferait diverger les deux onglets, qui doivent se comporter à l'identique).
// Extraite de `Shelf`, qui la portait en ligne, plutôt que recopiée : `Shelf`
// (onglet Collection) et `FolderShelf` (onglet Decks) montent désormais
// exactement le même élément défilant, avec le même rôle ARIA, le même
// `snap-x snap-proximity`, la même barre masquée et la même navigation aux
// flèches.
//
// Seuls l'entrefer et le padding latéral diffèrent d'un onglet à l'autre
// (Collection : `gap-8 pl-2` ; Decks : `gap-10 px-16 pb-22`) — passés
// en `className` par l'appelant, en classes littérales pour que Tailwind les
// voie à la compilation. Le pas de défilement au clavier diffère de même
// (largeur d'une tuile + entrefer, propre à chaque gabarit).
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

export function ShelfTrack({
  label,
  scrollStep,
  className = '',
  trackRef: externalRef,
  children,
}: {
  // Libellé du groupe ARIA — la piste garde `tabindex` et répond aux
  // flèches, sinon l'écran devient inaccessible.
  label: string
  scrollStep: number
  className?: string
  // Référence optionnelle sur l'élément défilant, pour un appelant qui doit
  // le mesurer (`FolderShelf` : la bascule stub / tuile `New deck` dépend du
  // débordement réel des cartes). `Shelf` ne la passe pas et garde la
  // référence interne — aucun changement de comportement de son côté.
  trackRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const internalRef = useRef<HTMLDivElement>(null)
  const trackRef = externalRef ?? internalRef

  function onTrackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') {
      trackRef.current?.scrollBy({ left: scrollStep, behavior: 'smooth' })
      event.preventDefault()
    } else if (event.key === 'ArrowLeft') {
      trackRef.current?.scrollBy({ left: -scrollStep, behavior: 'smooth' })
      event.preventDefault()
    }
  }

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onTrackKeyDown}
      className={`scrollbar-hide flex snap-x snap-proximity overflow-x-auto ${className}`}
    >
      {children}
    </div>
  )
}
