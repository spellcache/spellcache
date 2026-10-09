'use client'

// L'art complet d'une carte au ratio 5:7 — le moment « c'est cette carte-là »
// des feuilles d'ajout et de détail. Repli `ImageOff` quand l'impression n'a pas d'image ou que le
// chargement échoue — jamais un rectangle vide.
import { ImageOff } from 'lucide-react'
import { useState } from 'react'

import { ZoomableCardImage } from '@/components/cards/zoomable-card-image'

export function CardImage({
  src,
  alt,
  maxWidth = 240,
  onPrevious,
  onNext,
}: {
  src: string | null
  alt: string
  maxWidth?: number
  // Balayage dans la vue agrandie (voir `ZoomableCardImage`).
  onPrevious?: () => void
  onNext?: () => void
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div
      className="mx-auto flex aspect-card w-full items-center justify-center overflow-hidden rounded-card-image bg-surface-2 text-text-3"
      style={{ maxWidth }}
    >
      {src && !failed ? (
        // Agrandissable d'un clic, comme toute image de vue détail.
        <ZoomableCardImage
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          onPrevious={onPrevious}
          onNext={onNext}
          className="block h-full w-full object-contain"
        />
      ) : (
        <ImageOff size={26} strokeWidth={1.5} />
      )}
    </div>
  )
}
