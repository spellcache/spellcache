'use client'

// Écran d'erreur des frontières `error.tsx` / `global-error.tsx`. Installée,
// la PWA n'a ni barre d'adresse ni « tirer pour actualiser » : sans ce
// bouton, une erreur client laisserait l'app bloquée jusqu'à la fermer de
// force.
import { useEffect } from 'react'

const CHUNK_RELOAD_KEY = 'spellcache-chunk-reload'

// Après un déploiement, une app restée ouverte réclame des fragments JS qui
// n'existent plus : un rechargement unique suffit. L'horodatage évite la
// boucle si l'erreur persiste.
function reloadOnceForStaleChunk(error: Error): boolean {
  if (
    error.name !== 'ChunkLoadError' &&
    !/Loading chunk [\w-]+ failed/.test(error.message)
  ) {
    return false
  }
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!reloadOnceForStaleChunk(error)) console.error(error)
  }, [error])

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center-safe gap-14 overflow-y-auto px-16 py-24 text-center">
      <div className="text-title-subscreen font-extrabold text-text">
        Something went wrong
      </div>
      <p className="max-w-auth-card-copy text-auth-copy text-text-2">
        The page could not be displayed. Reload to try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 w-full max-w-auth-card rounded-control bg-accent px-16 py-15 text-auth-button font-bold text-on-accent"
      >
        Reload
      </button>
    </div>
  )
}
