'use client'

// Bouton de copie du lien. Seul enfant client de la page
// publique, et volontairement **sans prop** : il lit `window.location.href`
// plutôt que de recevoir une URL calculée côté serveur. Rien du container ne
// transite donc par la charge utile RSC à cause de ce bouton, et l'URL
// copiée est exactement celle de la barre d'adresse, quel
// que soit le domaine servant l'application.
//
// Gabarit repris tel quel du bouton secondaire déjà livré (`Find a card` de
// l'accueil, `app/(app)/collection/collection-view.tsx`) — aucun langage
// visuel neuf.
import { Check, Link2 } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '@/lib/clipboard'

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!(await copyText(window.location.href))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="flex w-full items-center justify-center gap-7 rounded-control border border-border bg-surface-1 py-11 text-body font-bold text-text"
    >
      {copied ? (
        <Check width={15} height={15} strokeWidth={1.75} />
      ) : (
        <Link2 width={15} height={15} strokeWidth={1.75} />
      )}
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  )
}
