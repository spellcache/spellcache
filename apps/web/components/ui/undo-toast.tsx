'use client'

// Toast `Undo` temporisé 6 s (toute action destructive laisse un Undo de 6
// secondes). Le compte à rebours vit ici (composant), le jeton et la
// restauration côté serveur vivent chez l'appelant (`undoAction`).
//
// Gouttière fluide, entrée en glissant de 8px, icône paramétrable, bouton
// `Undo` optionnel, et sur desktop il se range en bas à droite (420px max)
// au lieu de traverser la fenêtre. z-45 : toujours sous une sheet ouverte
// (z-50), toujours au-dessus des barres flottantes.
import { Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

const UNDO_WINDOW_MS = 6_000

export function UndoToast({
  token,
  message,
  icon: Icon = Trash2,
  onUndo,
  onExpire,
}: {
  // Identifie l'occurrence d'un `Undo` (le jeton serveur, unique par
  // suppression). Le minuteur ne dépend que de `token`, jamais de `onExpire`
  // : `onExpire` est une fermeture recréée à chaque rendu du parent —
  // en dépendre redémarrerait les 6 secondes à chaque rendu. La
  // dernière version de `onExpire` est lue via une ref.
  token: string
  message: string
  icon?: LucideIcon
  onUndo?: () => void
  onExpire: () => void
}) {
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    const timer = setTimeout(() => onExpireRef.current(), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [token])

  return (
    <div
      role="status"
      className="fixed inset-x-gutter bottom-toast-offset z-45 flex animate-undo-toast-in items-center gap-12 rounded-toast border border-border-device bg-surface-3 px-14 py-12 shadow-toast desktop:bottom-toast-bottom-desktop desktop:left-auto desktop:right-toast-right-desktop desktop:max-w-toast-desktop"
    >
      <Icon width={17} height={17} strokeWidth={1.75} className="flex-shrink-0 text-text-2" />
      <span className="min-w-0 flex-1 text-body font-semibold text-text">{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} className="flex-shrink-0 text-body font-extrabold text-accent-text">
          Undo
        </button>
      )}
    </div>
  )
}
