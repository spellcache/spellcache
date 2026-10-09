'use client'

// Retour Android (bouton ou geste) : referme la feuille, la visionneuse ou la
// sélection ouverte au lieu de quitter l'écran — ou la PWA entière quand
// l'écran est le premier de l'historique.
//
// Chaque couche ouverte pousse une entrée d'historique (même URL, état de
// Next.js recopié : son routeur ignore l'entrée et reste sur la page). Le
// retour dépile cette entrée et referme la couche du dessus.
//
// Une couche refermée par l'interface (croix, voile, Échap) laisse son
// entrée en place, sans `history.back()` : un `back()` lancé pendant qu'un
// lien de la feuille navigue annulerait la navigation (l'action `restore`
// de Next.js écarte la navigation en cours). L'entrée orpheline est sautée
// au retour suivant, ou réutilisée par la prochaine couche ouverte.
import { useEffect, useRef } from 'react'

const STATE_KEY = '__overlay'

interface Layer {
  id: string
  close: () => void
}

// Couches ouvertes, de la plus ancienne à celle du dessus.
const layers: Layer[] = []
// URL de l'entrée orpheline laissée au sommet par une fermeture d'interface.
let orphanHref: string | null = null
let sequence = 0
let listening = false

function overlayIdOf(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !(STATE_KEY in state))
    return undefined
  return String((state as Record<string, unknown>)[STATE_KEY])
}

function isLive(id: string): boolean {
  return layers.some((layer) => layer.id === id)
}

function handlePopState(event: PopStateEvent) {
  const landed = overlayIdOf(event.state)

  // Entrée orpheline atteinte (couche fermée par l'interface, ou entrée
  // d'avant un rechargement) : rien à refermer, on continue vers l'entrée
  // précédente.
  if (landed !== undefined && !isLive(landed)) {
    orphanHref = null
    window.history.back()
    return
  }

  // On vient de quitter l'entrée orpheline du sommet : la page n'a pas
  // bougé, le retour n'a encore rien fait de visible.
  if (orphanHref !== null && orphanHref === window.location.href) {
    orphanHref = null
    window.history.back()
    return
  }
  orphanHref = null

  const index =
    landed === undefined ? -1 : layers.findIndex((layer) => layer.id === landed)
  const closing = layers.splice(index + 1)
  for (const layer of closing.reverse()) layer.close()
}

export function openLayer(close: () => void): () => void {
  if (!listening) {
    window.addEventListener('popstate', handlePopState)
    listening = true
  }

  sequence += 1
  const layer: Layer = { id: `layer-${sequence}`, close }
  const current: unknown = window.history.state
  const state = {
    ...(typeof current === 'object' ? current : null),
    [STATE_KEY]: layer.id,
  }
  const topId = overlayIdOf(current)
  if (topId !== undefined && !isLive(topId)) window.history.replaceState(state, '')
  else window.history.pushState(state, '')
  orphanHref = null
  layers.push(layer)

  return () => {
    const index = layers.indexOf(layer)
    // Déjà dépilée par le retour.
    if (index === -1) return
    layers.splice(index, 1)
    if (overlayIdOf(window.history.state) === layer.id) orphanHref = window.location.href
  }
}

export function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!open) return
    return openLayer(() => closeRef.current())
  }, [open])
}
