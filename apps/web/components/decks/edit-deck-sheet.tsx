'use client'

// Feuille `Edit deck` : nom ET format, le format étant une LISTE DÉROULANTE
// prédéfinie (demande produit, 2026-09-01 — plus de champ libre) : les sept
// formats de `lib/decks/legality.ts` plus « No format ». Seul Commander
// active la zone commandant et les contrôles de légalité ; les autres
// formats ne sont qu'un libellé.
//
// Accessible depuis le menu contextuel de la tuile de l'onglet Decks
// (« Edit », 1re entrée, `folders-view.tsx`) ET depuis le menu `···` de
// l'écran de deck (« Edit », `deck-view.tsx`) — les deux ouvrent la même
// feuille, avec les deux mêmes champs.
import { useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { FORMAT_LABELS, isDeckFormat, type DeckFormat } from '@/lib/decks/legality'
import { updateDeckAction } from '@/app/(app)/decks/actions'

export function EditDeckSheet({
  open,
  onOpenChange,
  deckId,
  name,
  format,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deckId: string
  name: string
  format: string | null
  onSaved: (next: { name: string; format: string | null }) => void
}) {
  const [nextName, setNextName] = useState(name)
  // Un format libre hérité (avant la liste déroulante) hors des sept connus
  // retombe sur « No format » — le select ne peut pas afficher une valeur
  // qu'il ne liste pas.
  const [nextFormat, setNextFormat] = useState(format !== null && isDeckFormat(format) ? format : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = nextName.trim()
    if (trimmedName.length === 0) return
    setSaving(true)
    setError(null)
    const result = await updateDeckAction({
      deckId,
      name: trimmedName,
      format: nextFormat.trim(),
    })
    setSaving(false)
    if (!result.ok) {
      setError('Could not save these changes.')
      return
    }
    onSaved({ name: trimmedName, format: nextFormat.trim().length === 0 ? null : nextFormat.trim() })
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setNextName(name)
          setNextFormat(format !== null && isDeckFormat(format) ? format : '')
          setError(null)
        }
      }}
      title="Edit deck"
      closeLabel="Close edit deck sheet"
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-14">
        <div>
          <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Name
          </div>
          <input
            type="text"
            required
            autoFocus
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
            aria-label="Name"
            className="w-full rounded-control border border-border bg-surface-1 px-14 py-11 text-body text-text outline-none placeholder:text-text-3"
          />
        </div>

        <div>
          <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Format
          </div>
          <select
            value={nextFormat}
            onChange={(event) => setNextFormat(event.target.value)}
            aria-label="Format"
            className="w-full appearance-none rounded-control border border-border bg-surface-1 px-14 py-11 text-body text-text outline-none"
          >
            <option value="">No format</option>
            {(Object.keys(FORMAT_LABELS) as DeckFormat[]).map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-meta text-danger">{error}</p>}

        <button
          type="submit"
          disabled={saving || nextName.trim().length === 0}
          className="w-full rounded-control bg-accent px-16 py-11 text-body font-bold text-text disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </form>
    </Sheet>
  )
}
