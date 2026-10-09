'use client'

// Balayage horizontal au doigt (carte précédente / suivante d'une liste).
// Évènements tactiles plutôt que pointeur : le navigateur coupe un geste
// pointeur (`pointercancel`) dès qu'il le prend pour un défilement vertical de
// la feuille, alors que `touchend` arrive toujours. La souris n'est pas
// concernée : sur desktop, les flèches du clavier font le même travail.
import { useEffect, useRef, type TouchEvent } from 'react'

// Assez long pour ne pas partir d'un tap ou d'un défilement qui dérive, et
// franchement horizontal : un défilement vertical n'est jamais un balayage.
const MIN_DISTANCE_PX = 60
const MIN_RATIO = 1.5

// Doigt vers la gauche : la carte suivante arrive de la droite.
export function swipeDirection(dx: number, dy: number): 'previous' | 'next' | null {
  if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * MIN_RATIO) return null
  return dx < 0 ? 'next' : 'previous'
}

export interface SwipeHandlers {
  onTouchStart: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
}

export function useSwipe({
  onPrevious,
  onNext,
  keyboard = false,
}: {
  // `undefined` : rien de ce côté (début ou fin de liste).
  onPrevious?: () => void
  onNext?: () => void
  // `←`/`→` tant que la vue est ouverte — jamais pendant une saisie.
  keyboard?: boolean
}): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef({ onPrevious, onNext })
  useEffect(() => {
    latest.current = { onPrevious, onNext }
  })

  useEffect(() => {
    if (!keyboard) return
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) {
        return
      }
      if (event.key === 'ArrowLeft') latest.current.onPrevious?.()
      else if (event.key === 'ArrowRight') latest.current.onNext?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [keyboard])

  return {
    onTouchStart: (event) => {
      const touch = event.touches[0]
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null
    },
    onTouchEnd: (event) => {
      const from = start.current
      start.current = null
      const touch = event.changedTouches[0]
      if (!from || !touch) return
      const direction = swipeDirection(touch.clientX - from.x, touch.clientY - from.y)
      if (direction === 'next') onNext?.()
      else if (direction === 'previous') onPrevious?.()
    },
  }
}
