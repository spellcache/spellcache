'use client'

// Enregistrement du service worker de `public/sw.js` (installation PWA).
// Sans cet enregistrement, `sw.js` serait un fichier
// mort dans `public/` et l'application ne serait pas installable.
//
// Production seulement : en développement, un service worker interpose son
// cache entre le navigateur et le rechargement à chaud de Next, ce qui donne
// des recompilations qui « ne prennent pas ». Rien à mettre en cache non plus
// en dev — les fichiers n'y sont pas hachés.
import { useEffect } from 'react'

export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    // Après le chargement : l'enregistrement ne doit pas concurrencer le
    // premier rendu pour la bande passante.
    const register = (): void => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('[pwa] service worker registration failed', error)
      })
    }

    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
