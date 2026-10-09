'use client'

// Feuille `New deck` : nom et format, avec la même liste déroulante que
// `Edit deck` (`components/decks/edit-deck-sheet.tsx`) — sans elle, il
// fallait rouvrir `Edit deck` juste après la création pour changer de
// format. Le format est pré-réglé sur `commander` (demande produit,
// 2026-09-06 : c'est le format courant). Le commandant se choisit depuis le
// tiroir d'ajout (zone `Cmdr`), jamais à la création. Nom pré-rempli
// `New deck`, puis NAVIGATION immédiate vers `/decks/{id}` : aucun
// brouillon local n'est inséré dans l'étagère, le deck créé s'ouvre
// directement.
//
// `folderId` : un deck créé depuis la tuile d'une étagère atterrit
// dans ce dossier. `createDeckAction` ne connaît pas les dossiers ; le
// rangement passe donc par `moveDeckToFolderAction` juste après, la seule
// voie d'écriture de `containers.folder_id`. Si ce second appel échoue, le
// deck existe et reste dans `Unsorted` — jamais perdu.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { createDeckAction } from '@/app/(app)/decks/actions'
import { moveDeckToFolderAction } from '@/app/(app)/decks/folder-actions'
import { FORMAT_LABELS, isDeckFormat, type DeckFormat } from '@/lib/decks/legality'

const DEFAULT_NEW_DECK_FORMAT: DeckFormat = 'commander'

export function NewDeckSheet({
  open,
  onOpenChange,
  folderId = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folderId?: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState('New deck')
  // `''` : « No format », comme dans `Edit deck`.
  const [format, setFormat] = useState<DeckFormat | ''>(DEFAULT_NEW_DECK_FORMAT)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('New deck')
    setFormat(DEFAULT_NEW_DECK_FORMAT)
    setError(null)
    setCreating(false)
  }

  async function handleCreateDeck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    setCreating(true)
    setError(null)

    const result = await createDeckAction({
      name: trimmed,
      format: format === '' ? null : format,
      commanderCardId: null,
    })
    if (!result.ok) {
      setError('Could not create that deck. Try a different name.')
      setCreating(false)
      return
    }

    if (folderId) {
      await moveDeckToFolderAction({ deckId: result.deckId, folderId })
    }

    reset()
    onOpenChange(false)
    router.push(`/decks/${result.deckId}`)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      title="New deck"
    >
      <form onSubmit={handleCreateDeck}>
        {/* Label visible au-dessus du champ + bouton « Create » /
            « Working... ». */}
        <div className="mb-8 text-body font-semibold text-text-2">Deck name</div>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Deck name"
          className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
        />

        <div className="mb-8 mt-14 text-body font-semibold text-text-2">Format</div>
        <select
          value={format}
          onChange={(event) => {
            const value = event.target.value
            setFormat(isDeckFormat(value) ? value : '')
          }}
          aria-label="Format"
          className="w-full appearance-none rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
        >
          {(Object.keys(FORMAT_LABELS) as DeckFormat[]).map((value) => (
            <option key={value} value={value}>
              {FORMAT_LABELS[value]}
            </option>
          ))}
          <option value="">No format</option>
        </select>

        {error && <p className="mt-8 text-meta text-danger">{error}</p>}
        <button
          type="submit"
          disabled={creating || name.trim().length === 0}
          className="mt-18 w-full rounded-control bg-accent py-14 text-button-primary font-bold text-on-accent disabled:opacity-60"
        >
          {creating ? 'Working...' : 'Create'}
        </button>
      </form>
    </Sheet>
  )
}
