'use client'

// L'onglet `Infos` d'un deck, sous ses deux cartes de statut : ce que la
// liste vaut, et ce qu'on veut se rappeler d'elle.
//
// Les notes sont la colonne `containers.description` — rien de nouveau n'est
// stocké, et rien d'autre ne les lit. Elles ne s'enregistrent pas à la
// frappe : un champ libre qui écrit à chaque caractère envoie une centaine de
// requêtes pour une note qu'on tape d'un trait, et l'état « enregistré » ne
// veut alors plus rien dire.
import { useState } from 'react'

import { saveDeckNotesAction } from '@/app/(app)/decks/actions'
import { useCanEdit } from '@/lib/collections/access-context'
import { formatMoney, type Currency } from '@/lib/format/money'

export function DeckInfos({
  deckId,
  totalValueMinor,
  currency,
  initialNotes,
}: {
  deckId: string
  totalValueMinor: number
  currency: Currency
  initialNotes: string
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [saved, setSaved] = useState(initialNotes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = notes !== saved
  // Lecture seule (`viewer`) : notes lisibles, ni saisie ni enregistrement.
  const canEdit = useCanEdit()

  async function handleSave() {
    setBusy(true)
    setError(null)
    const result = await saveDeckNotesAction({ deckId, description: notes })
    setBusy(false)
    if (result.ok) setSaved(notes)
    else setError('Could not save these notes.')
  }

  return (
    <div>
      <div className="mb-18 flex items-center justify-between rounded-card border border-border bg-surface-1 px-17 py-13">
        <span className="text-stat-card-title font-semibold uppercase tracking-section-label text-text-2">
          Total value
        </span>
        <span className="text-deck-total-value font-extrabold text-accent-text">
          {formatMoney(totalValueMinor, currency)}
        </span>
      </div>

      <div className="mb-8 text-row-value font-semibold text-text-2">Notes</div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={8}
        readOnly={!canEdit}
        aria-label="Deck notes"
        placeholder="Win conditions, lines to look for, cards to swap in..."
        className="w-full resize-y rounded-card border border-border bg-surface-1 px-14 py-12 text-body leading-preview-oracle text-text outline-none placeholder:text-text-3"
      />

      {error && <p className="mt-10 text-meta text-danger">{error}</p>}

      {canEdit && (
      <div className="mt-12 flex items-center gap-12">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || busy}
          className={`rounded-control px-20 py-11 text-body font-bold ${
            !dirty || busy ? 'bg-surface-2 text-text-3' : 'bg-accent text-on-accent'
          }`}
        >
          {busy ? 'Saving...' : 'Save notes'}
        </button>
        {!dirty && saved !== initialNotes && (
          <span className="text-meta font-semibold text-success">Saved</span>
        )}
      </div>
      )}
    </div>
  )
}
