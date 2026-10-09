'use client'

// Image de carte d'une vue détail, agrandissable d'un clic (demande
// produit) : la carte s'ouvre en plein écran par-dessus tout, au plus haut
// format disponible (`png` du bulk, repli sur l'image affichée). Un clic
// n'importe où ou Échap referme. Aucune nouvelle surface : le voile des
// feuilles (`bg-modal-veil`) et la carte seule, détourée par son PNG.
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'

import { useBackToClose } from '@/components/ui/use-back-to-close'
import { useSwipe } from '@/components/ui/use-swipe'

// Un balayage dans la vue agrandie passe à la carte voisine ; la feuille
// parente peut alors se reconstruire (recherche : une `AddCardSheet` par
// carte, `key` oblige) et démonter cette image. La vue agrandie se rouvre
// d'elle-même sur la nouvelle carte si elle est remontée dans la foulée
// (le temps de charger le détail de la carte suivante).
const ZOOM_CARRY_MS = 3_000
let zoomCarriedUntil = 0

export function ZoomableCardImage({
  src,
  zoomSrc,
  alt,
  className,
  onError,
  onPrevious,
  onNext,
}: {
  src: string
  // Version haute définition pour le plein écran ; `src` sinon.
  zoomSrc?: string | null
  alt: string
  className?: string
  onError?: () => void
  // Carte voisine de la liste d'où vient la vue détail ; absentes, pas de
  // balayage.
  onPrevious?: () => void
  onNext?: () => void
}) {
  const [open, setOpen] = useState(() => {
    const carried = Date.now() < zoomCarriedUntil
    zoomCarriedUntil = 0
    return carried
  })
  const carry = (go?: () => void) =>
    go
      ? () => {
          zoomCarriedUntil = Date.now() + ZOOM_CARRY_MS
          go()
        }
      : undefined
  const swipe = useSwipe({ onPrevious: carry(onPrevious), onNext: carry(onNext) })
  useBackToClose(open, () => setOpen(false))

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={`Enlarge ${alt}`} className="block h-full w-full cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN Scryfall direct (packages/core/src/images.ts#largeUrl), jamais le proxy */}
          <img
            src={src}
            alt={alt}
            onError={onError}
            className={className ?? 'h-full w-full object-contain'}
          />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-60 bg-modal-veil" />
        <Dialog.Content
          {...swipe}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-60 flex cursor-zoom-out items-center justify-center p-16 outline-none"
        >
          <Dialog.Title className="sr-only">{alt}</Dialog.Title>
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN Scryfall direct (packages/core/src/images.ts#largeUrl), jamais le proxy */}
          <img src={zoomSrc ?? src} alt={alt} className="max-h-card-zoom max-w-full object-contain" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
