'use client'

// Feuille de confirmation du partage public, qui explique ce qui devient
// visible. Un seul fichier pour les deux points d'entrée — le menu `···`
// d'un binder (`components/binders/container-action-sheets.tsx`) et celui
// d'un deck (`app/(app)/decks/[id]/deck-view.tsx`) : la même explication et la
// même bascule, jamais deux copies qui divergeraient.
//
// Aucun langage visuel neuf : `Sheet`, le bloc monospace de la feuille
// d'export pour le lien, et les gabarits de bouton primaire/secondaire
// déjà livrés.
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Sheet } from '@/components/ui/sheet'

import {
  getSharingStateAction,
  setVisibilityAction,
  type SharingState,
} from '@/app/(app)/container/[id]/sharing-actions'
import { copyText } from '@/lib/clipboard'

export function ShareSheet({
  open,
  onOpenChange,
  containerId,
  kindLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string
  kindLabel: 'deck' | 'binder'
}) {
  const [state, setState] = useState<SharingState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setState(null)
    void getSharingStateAction({ containerId }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError('Could not read the sharing state. Try again.')
        return
      }
      setState(result.state)
    })
    return () => {
      cancelled = true
    }
  }, [open, containerId])

  // Construit côté client à partir de l'origine réellement servie : aucune
  // variable d'environnement d'URL publique à tenir à jour, et le lien copié
  // est toujours celui qui marche depuis ce navigateur.
  const shareUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/s/${containerId}`
  const isPublic = state?.visibility === 'public'

  async function handleToggle() {
    if (!state) return
    setBusy(true)
    setError(null)
    const result = await setVisibilityAction({
      containerId,
      visibility: isPublic ? 'private' : 'public',
    })
    setBusy(false)
    if (!result.ok) {
      setError(
        result.error === 'not_owner'
          ? 'Only the collection owner can share.'
          : result.error === 'not_shareable'
            ? 'Only decks and binders can be shared.'
            : 'Could not change the sharing state. Try again.',
      )
      return
    }
    setState({ ...state, visibility: result.visibility })
  }

  async function handleCopy() {
    setCopied((await copyText(shareUrl)) ? 'done' : 'failed')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isPublic ? 'Shared with a link' : `Share this ${kindLabel}`}
      closeLabel="Close share sheet"
    >
      <div className="flex flex-col gap-14">
        <p className="text-meta leading-normal text-text-2">
          Anyone with the link sees this {kindLabel}&apos;s name, its cover, its card list and its
          total value — and nothing else. The rest of your collection, the copies you own elsewhere
          and the cards you are still missing stay private.
        </p>

        {isPublic && (
          <>
            <div className="rounded-control border border-border bg-surface-1 px-14 py-12 font-mono text-meta-mono leading-normal break-all text-text select-text">
              {shareUrl}
            </div>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex w-full items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-13 text-meta font-bold text-text"
            >
              <Copy width={16} height={16} strokeWidth={1.75} />
              {copied === 'done' ? 'Copied!' : copied === 'failed' ? "Couldn't copy" : 'Copy link'}
            </button>
          </>
        )}

        {state && !state.canShare && (
          // Rendue mais inerte pour un `editor`, plutôt que retirée — même
          // traitement que les autres commandes sans droit d'usage.
          // La garde réelle est serveur
          // (`setContainerVisibility`), celle-ci n'est que l'explication.
          <p className="text-meta text-text-2">
            Only the collection owner can publish a {kindLabel}.
          </p>
        )}

        {error && <p className="text-meta text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={busy || state === null || !state.canShare || !state.shareable}
          className={
            isPublic
              ? 'w-full rounded-control border border-border bg-surface-2 py-14 text-button-primary font-bold text-text disabled:opacity-60'
              : 'w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60'
          }
        >
          {busy ? 'Saving...' : isPublic ? 'Remove share' : 'Make it public'}
        </button>
      </div>
    </Sheet>
  )
}
