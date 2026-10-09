'use client'

// Le clavier virtuel recouvre la page au lieu de la redimensionner : rien ne
// bouge sous l'utilisateur quand il s'ouvre (ni la barre d'onglets, ni le
// contenu, ni les hauteurs en `dvh`). Seuls les éléments ancrés en bas qui
// portent un champ — feuilles (`components/ui/sheet.tsx`) et tiroir d'ajout —
// se posent sur le clavier, via `--keyboard-inset` (`bottom-keyboard-inset`).
//
// Chrome Android : API VirtualKeyboard (`overlaysContent`), qui donne la
// hauteur exacte du clavier. Ailleurs, repli sur `visualViewport` : la
// fenêtre visuelle rétrécit et se décale, l'écart avec la fenêtre de mise en
// page est la place prise par le clavier.
//
// App Android : la coque publie elle-même `--keyboard-inset` à partir des
// insets du clavier (apps/android, `MainActivity.publishKeyboardInset`).
import { useEffect } from 'react'

interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean
  boundingRect: DOMRect
}

function virtualKeyboard(): VirtualKeyboardLike | null {
  const candidate: unknown = (navigator as unknown as { virtualKeyboard?: unknown }).virtualKeyboard
  if (!candidate || typeof candidate !== 'object' || !('overlaysContent' in candidate)) return null
  return candidate as VirtualKeyboardLike
}

function setInset(px: number) {
  document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(px))}px`)
}

export function KeyboardInset() {
  useEffect(() => {
    const keyboard = virtualKeyboard()
    if (keyboard) {
      keyboard.overlaysContent = true
      const onGeometryChange = () => {
        setInset(keyboard.boundingRect.height)
        // La page ne défile plus d'elle-même vers le champ : un champ que le
        // clavier recouvre est ramené en vue.
        const active = document.activeElement
        if (keyboard.boundingRect.height > 0 && active instanceof HTMLElement) {
          const limit = window.innerHeight - keyboard.boundingRect.height
          if (active.getBoundingClientRect().bottom > limit) {
            active.scrollIntoView({ block: 'center' })
          }
        }
      }
      keyboard.addEventListener('geometrychange', onGeometryChange)
      return () => {
        keyboard.removeEventListener('geometrychange', onGeometryChange)
        keyboard.overlaysContent = false
        setInset(0)
      }
    }

    const viewport = window.visualViewport
    if (!viewport) return
    // Zoom au pincement : la fenêtre visuelle bouge aussi, sans clavier.
    const onViewportChange = () =>
      setInset(
        viewport.scale > 1.01 ? 0 : window.innerHeight - viewport.height - viewport.offsetTop,
      )
    viewport.addEventListener('resize', onViewportChange)
    viewport.addEventListener('scroll', onViewportChange)
    return () => {
      viewport.removeEventListener('resize', onViewportChange)
      viewport.removeEventListener('scroll', onViewportChange)
      setInset(0)
    }
  }, [])

  return null
}
