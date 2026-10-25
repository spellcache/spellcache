'use client'

// Ref tenue à jour avec la dernière valeur rendue, lisible depuis un rappel ou
// un minuteur sans le recréer à chaque rendu. Écrite après le commit (jamais
// pendant le rendu, qu'un rendu abandonné laisserait périmée) : aucun
// gestionnaire d'événement ne peut s'exécuter entre les deux.
import { useLayoutEffect, useRef } from 'react'

export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
