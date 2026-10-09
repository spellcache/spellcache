'use client'

// Feuille `Import a decklist` : un deck vide est créé en `plan`,
// puis la liste collée y est importée d'un coup — `lib/lists/parse-list` +
// `lib/lists/resolve-list` gèrent déjà les en-têtes `Commander`/
// `Sideboard` (zones) et le repli sur l'impression la moins chère pour une
// ligne ambiguë (`chooseCard`, `sharing-actions.ts`) sans arbitrage manuel —
// un comportement « colle et c'est fait », jamais
// l'étape d'arbitrage à choix multiples d'`ImportSheet`
// (`components/lists/import-sheet.tsx`, utilisée elle pour ré-importer dans
// un deck déjà ouvert).
import { useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { FORMAT_LABELS, type DeckFormat } from '@/lib/decks/legality'
import { createDeckAction, updateDeckAction } from '@/app/(app)/decks/actions'
import {
  importListAction,
  resolveListAction,
} from '@/app/(app)/container/[id]/sharing-actions'

interface ImportResult {
  deckId: string
  deckName: string
  imported: number
  skipped: number
  errors: string[]
}

const PLACEHOLDER = `4 Lightning Bolt
2 Ragavan, Nimble Pilferer (MH2) 138

Sideboard
2 Pyroblast`

export function ImportDeckSheet({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (deckId: string) => void
}) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState('')
  const [listText, setListText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  function reset() {
    setName('')
    setFormat('')
    setListText('')
    setError(null)
    setResult(null)
    setPending(false)
  }

  async function handleImport() {
    if (listText.trim().length === 0) {
      setError('Paste a decklist first.')
      return
    }
    setError(null)
    setPending(true)

    const deckName = name.trim() || 'Imported deck'
    const created = await createDeckAction({ name: deckName, format: null, commanderCardId: null })
    if (!created.ok) {
      setPending(false)
      setError('The import did not complete. Please try again.')
      return
    }

    if (format.trim().length > 0) {
      await updateDeckAction({ deckId: created.deckId, name: deckName, format: format.trim() })
    }

    const preview = await resolveListAction({ containerId: created.deckId, text: listText })
    const requested = preview.ok
      ? preview.preview.lines.reduce((sum, line) => sum + line.qty, 0)
      : 0

    const imported = await importListAction({ containerId: created.deckId, text: listText })
    setPending(false)
    if (!imported.ok) {
      setError('Import failed. Please check the list and try again.')
      return
    }

    setResult({
      deckId: created.deckId,
      deckName,
      imported: imported.imported,
      skipped: Math.max(0, requested - imported.imported),
      errors: preview.ok ? preview.preview.ignored : [],
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      title="Import a decklist"
      closeLabel="Close import a decklist sheet"
    >
      {result ? (
        <div className="flex flex-col gap-14">
          <div>
            <div className="text-title-subscreen font-bold text-text">{result.deckName}</div>
            <div className="mt-4 text-meta text-text-2">
              {result.imported} card{result.imported === 1 ? '' : 's'} imported
              {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="max-h-card-picker overflow-y-auto rounded-control border border-border bg-surface-2 p-12">
              {result.errors.map((message, index) => (
                <div key={index} className="mb-4 text-meta text-danger">
                  {message}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-10">
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-control bg-surface-2 py-13 text-body font-bold text-text"
            >
              Import another
            </button>
            <button
              type="button"
              onClick={() => {
                const deckId = result.deckId
                reset()
                onOpenChange(false)
                onImported(deckId)
              }}
              className="flex-1 rounded-control bg-accent py-13 text-body font-extrabold text-on-accent"
            >
              Open deck
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-14">
          <div>
            <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Deck name
            </div>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Imported deck"
              aria-label="Deck name"
              className="w-full rounded-control border border-border bg-surface-1 px-14 py-11 text-body text-text outline-none placeholder:text-text-3"
            />
          </div>

          <div>
            <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Format (optional)
            </div>
            {/* Même liste déroulante prédéfinie que la feuille `Edit deck`
                (demande produit) — plus de champ libre. */}
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              aria-label="Format (optional)"
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

          <div>
            <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Decklist
            </div>
            <textarea
              value={listText}
              onChange={(event) => setListText(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={9}
              aria-label="Decklist"
              className="w-full resize-y rounded-control border border-border bg-surface-1 px-14 py-11 font-mono text-meta-mono leading-normal text-text outline-none placeholder:text-text-3"
            />
          </div>

          <p className="text-meta leading-normal text-text-2">
            One card per line, e.g. <code className="font-mono text-meta-mono">4 Lightning Bolt</code>{' '}
            or <code className="font-mono text-meta-mono">1 Sol Ring (C21) 263</code>.{' '}
            <code className="font-mono text-meta-mono">Commander</code> and{' '}
            <code className="font-mono text-meta-mono">Sideboard</code> headers put the cards that
            follow into those zones.
          </p>

          {error && <p className="text-meta text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={pending}
            className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
          >
            {pending ? 'Importing...' : 'Import deck'}
          </button>
        </div>
      )}
    </Sheet>
  )
}
