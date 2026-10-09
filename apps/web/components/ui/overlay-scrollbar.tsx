'use client'

// Barre de défilement en surimpression, posée sur le contenu plutôt qu'à
// côté de lui. Les barres natives sont masquées partout (app/globals.css) et
// remplacées par celle-ci.
//
// Pourquoi ne pas simplement habiller la native : elle ne sait pas
// s'effacer. `scrollbar-width` et `::-webkit-scrollbar` savent l'amincir, la
// colorer et lui retirer ses flèches, mais sous Chromium/Windows elle reste
// alors visible en permanence dès que la boîte défile. Elle réserve aussi de
// la largeur de mise en page, ce qui décale le contenu et désaligne un
// en-tête fixe du corps qui défile dessous. La surimpression règle les trois
// d'un coup.
//
// Le curseur est SAISISSABLE : c'est la
// seule chose qu'une surimpression perdrait sinon face à une barre native.
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_THUMB_HEIGHT = 28
// Piste la plus courte qu'un `trackTop` peut laisser.
const MIN_TRACK_HEIGHT = 120
const FADE_OUT_DELAY_MS = 900

export function OverlayScrollbar({
  target,
  trackTop,
}: {
  target: React.RefObject<HTMLElement | null>
  // Haut de la piste dans la boîte, relu à chaque mesure : sur un écran à
  // bannière, la piste démarre au niveau des cartes au lieu du haut de la
  // bannière, qu'on ne perçoit pas comme du contenu à faire défiler.
  trackTop?: (node: HTMLElement) => number
}) {
  const [thumb, setThumb] = useState<{ top: number; height: number; travel: number } | null>(
    null,
  )
  const trackTopRef = useRef(trackTop)
  useEffect(() => {
    trackTopRef.current = trackTop
  })
  const [visible, setVisible] = useState(false)
  const [dragging, setDragging] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStart = useRef<{ pointerY: number; scrollTop: number } | null>(null)

  const measure = useCallback(() => {
    const node = target.current
    if (!node) return
    const { scrollTop, scrollHeight, clientHeight } = node
    // Rien à montrer tant que le contenu tient dans la boîte.
    if (scrollHeight <= clientHeight + 1) {
      setThumb((previous) => (previous === null ? previous : null))
      return
    }
    const start = Math.min(
      Math.max(0, trackTopRef.current?.(node) ?? 0),
      Math.max(0, clientHeight - MIN_TRACK_HEIGHT),
    )
    const track = clientHeight - start
    const height = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * track)
    const travel = track - height
    const progress = scrollTop / (scrollHeight - clientHeight)
    const next = {
      top: Math.round(start + travel * progress),
      height: Math.round(height),
      travel: Math.round(travel),
    }
    // Garde d'égalité : `measure` tourne à chaque rendu (voir l'effet sans
    // dépendances ci-dessous) — sans elle, chaque rendu déclencherait un
    // nouveau setState et donc un rendu de plus.
    setThumb((previous) =>
      previous &&
      previous.top === next.top &&
      previous.height === next.height &&
      previous.travel === next.travel
        ? previous
        : next,
    )
  }, [target])

  // Re-mesure à CHAQUE rendu : un filtre
  // qui rétrécit la liste redimensionne le curseur sans qu'aucun événement de
  // défilement ni de resize ne se produise.
  useEffect(() => {
    measure()
  })

  useEffect(() => {
    const node = target.current
    if (!node) return

    const show = () => {
      measure()
      setVisible(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setVisible(false), FADE_OUT_DELAY_MS)
    }

    measure()
    node.addEventListener('scroll', show, { passive: true })
    // La hauteur du contenu bouge sans qu'on ait défilé : une liste qui
    // charge sa page suivante, une feuille qui s'ouvre, une rotation.
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)

    return () => {
      node.removeEventListener('scroll', show)
      observer.disconnect()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [measure, target])

  if (!thumb) return null

  return (
    <div
      aria-hidden="true"
      className={`absolute right-2 z-10 w-scroll-thumb rounded-full bg-scroll-thumb transition-opacity duration-220 ${
        // Invisible, le curseur ne prend aucun toucher : il couvre le bord
        // droit des listes, là où vivent les steppers de quantité.
        visible || dragging ? 'opacity-100' : 'pointer-events-none opacity-0'
      } ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ top: thumb.top, height: thumb.height, touchAction: 'none' }}
      onPointerDown={(event) => {
        const node = target.current
        if (!node) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = { pointerY: event.clientY, scrollTop: node.scrollTop }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const node = target.current
        const start = dragStart.current
        if (!node || !start) return
        const trackTravel = thumb.travel
        if (trackTravel <= 0) return
        const scrollable = node.scrollHeight - node.clientHeight
        const delta = event.clientY - start.pointerY
        node.scrollTop = start.scrollTop + (delta / trackTravel) * scrollable
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        dragStart.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        dragStart.current = null
        setDragging(false)
      }}
    />
  )
}
