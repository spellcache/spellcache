'use client'

// Import de liste : coller, aperçu obligatoire, arbitrage,
// écriture, annulation. La feuille reprend
// `Sheet`, les puces `Chip`, le champ de saisie et les boutons de
// bas de feuille tels que les feuilles déjà livrées les rendent, et le toast
// `UndoToast` pour la fenêtre de 6 secondes. Aucun langage visuel neuf.
//
// L'aperçu est une étape obligatoire : le bouton
// d'import n'existe pas tant que `resolveListAction` n'a pas répondu, et
// cette action n'écrit rien.
import { useState } from 'react'

import { Chip } from '@/components/ui/chip'
import { SHEET_SCROLL_BLEED, Sheet } from '@/components/ui/sheet'
import { UndoToast } from '@/components/ui/undo-toast'
import { formatCount, formatMoney, type Currency } from '@/lib/format/money'
import { ScrollArea } from '@/components/ui/scroll-area'

import {
  importListAction,
  resolveListAction,
  undoImportAction,
  type ListPreview,
} from '@/app/(app)/container/[id]/sharing-actions'

type PreviewLine = ListPreview['lines'][number]
type Candidate = NonNullable<PreviewLine['candidates']>[number]

// Marqueur d'arbitrage « ne pas importer cette ligne » : une ligne inconnue
// laissée telle quelle n'est jamais écrite, c'est
// l'état par défaut. Choisir une proposition la fait basculer en import.
const IGNORE = 'ignore'

function candidateLabel(candidate: Candidate, currency: Currency): string {
  const price =
    candidate.priceMinor === null ? '—' : formatMoney(candidate.priceMinor, currency)
  return `${candidate.setCode.toUpperCase()} #${candidate.collectorNumber} · ${price}`
}

export function ImportSheet({
  open,
  onOpenChange,
  containerId,
  currency,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string
  // Vient toujours de `users.price_source` côté serveur (docs/development.md) — jamais
  // devinée ici.
  currency: Currency
  onImported?: () => void
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ListPreview | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ token: string; imported: number } | null>(null)

  function reset() {
    setText('')
    setPreview(null)
    setChoices({})
    setError(null)
  }

  async function handlePreview() {
    setBusy(true)
    setError(null)
    const result = await resolveListAction({ containerId, text })
    setBusy(false)
    if (!result.ok) {
      setError(
        result.error === 'invalid'
          ? 'That list is too large to import at once. Split it and try again.'
          : 'Could not read that list. Try again.',
      )
      return
    }
    setPreview(result.preview)
    setChoices({})
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    const payload = Object.entries(choices)
      .filter(([, cardId]) => cardId !== IGNORE)
      .map(([lineIndex, cardId]) => ({ lineIndex: Number(lineIndex), cardId }))

    const result = await importListAction({ containerId, text, choices: payload })
    setBusy(false)
    if (!result.ok) {
      setError(
        result.error === 'nothing_to_import'
          ? 'Nothing in that list could be matched to the catalogue.'
          : result.error === 'deck_locked'
            ? 'This deck is built. Move it back to Assemble before importing.'
            : 'Could not import that list. Try again.',
      )
      return
    }

    setUndo({ token: result.undoToken, imported: result.imported })
    reset()
    onOpenChange(false)
    onImported?.()
  }

  async function handleUndo() {
    if (!undo) return
    await undoImportAction({ undoToken: undo.token })
    setUndo(null)
    onImported?.()
  }

  const summary = preview?.summary
  // Nombre d'exemplaires que la validation écrirait : les `resolved`, plus
  // les `ambiguous` (arbitrées ou laissées sur l'impression la moins chère),
  // plus les `unknown` explicitement corrigées. Les autres `unknown` sont
  // comptées à part et ne sont pas importées.
  const importableCopies =
    preview?.lines.reduce((sum, line, index) => {
      if (line.status === 'unknown' && !isChosen(choices[index])) return sum
      return sum + line.qty
    }, 0) ?? 0

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) reset()
          onOpenChange(next)
        }}
        title="Import a list"
        closeLabel="Close import sheet"
        maxHeight
        scrollBody={false}
      >
        <ScrollArea
          className={SHEET_SCROLL_BLEED.inner}
          outerClassName={SHEET_SCROLL_BLEED.outer}
        >
          <div className="flex flex-col gap-14">
            {preview === null ? (
              <>
                <p className="text-meta leading-normal text-text-2">
                  Paste a decklist. One card per line, with or without a set code — for
                  example{' '}
                  <span className="font-mono text-meta-mono text-text">
                    4 Lightning Bolt (2X2) 117
                  </span>
                  .
                </p>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={10}
                  aria-label="List to import"
                  placeholder={'Deck\n4 Lightning Bolt\n2 Mountain'}
                  className="w-full resize-none rounded-control border border-border bg-surface-1 px-14 py-11 font-mono text-meta-mono leading-normal text-text outline-none placeholder:text-text-3"
                />
                {error && <p className="text-meta text-danger">{error}</p>}
                <button
                  type="button"
                  onClick={() => void handlePreview()}
                  disabled={busy || text.trim().length === 0}
                  className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
                >
                  {busy ? 'Reading...' : 'Preview'}
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-4 rounded-control border border-border bg-surface-2 px-14 py-12">
                  <div className="text-body font-bold text-text">
                    {formatCount(summary?.resolved ?? 0)} cards recognised
                  </div>
                  <div className="text-meta text-text-2">
                    {formatCount(summary?.ambiguous ?? 0)} ambiguous ·{' '}
                    {formatCount(summary?.unknown ?? 0)} unknown
                  </div>
                  {preview.ignored.length > 0 && (
                    <div className="text-meta text-text-2">
                      {formatCount(preview.ignored.length)} lines skipped
                    </div>
                  )}
                </div>

                {preview.lines.map((line, index) =>
                  line.status === 'resolved' ? null : (
                    <ArbitrationRow
                      key={index}
                      line={line}
                      currency={currency}
                      chosen={choices[index]}
                      onChoose={(cardId) =>
                        setChoices((prev) => ({ ...prev, [index]: cardId }))
                      }
                    />
                  ),
                )}

                {error && <p className="text-meta text-danger">{error}</p>}

                <div className="flex gap-8">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    disabled={busy}
                    className="flex-1 rounded-control border border-border bg-surface-2 px-16 py-11 text-body font-bold text-text disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImport()}
                    disabled={busy || importableCopies === 0}
                    className="flex-1 rounded-control bg-accent px-16 py-11 text-body font-extrabold text-on-accent disabled:opacity-60"
                  >
                    {busy
                      ? 'Importing...'
                      : `Import ${formatCount(importableCopies)} cards`}
                  </button>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </Sheet>

      {undo && (
        <UndoToast
          token={undo.token}
          message={`Imported ${formatCount(undo.imported)} cards`}
          onUndo={() => void handleUndo()}
          onExpire={() => setUndo(null)}
        />
      )}
    </>
  )
}

function isChosen(choice: string | undefined): boolean {
  return choice !== undefined && choice !== IGNORE
}

function ArbitrationRow({
  line,
  currency,
  chosen,
  onChoose,
}: {
  line: PreviewLine
  currency: Currency
  chosen: string | undefined
  onChoose: (cardId: string) => void
}) {
  const candidates = line.candidates ?? []
  // Une ambiguë sans arbitrage explicite retombe sur le premier candidat —
  // l'impression la moins chère, déjà en tête du tri de `resolveList`. Une
  // inconnue retombe sur « ignorer ».
  const selected =
    chosen ?? (line.status === 'ambiguous' ? (candidates[0]?.cardId ?? IGNORE) : IGNORE)

  return (
    <div className="flex flex-col gap-8 rounded-control border border-border bg-surface-1 px-14 py-12">
      <div className="flex items-baseline justify-between gap-10">
        <span className="min-w-0 truncate text-body font-bold text-text">
          {line.qty}× {line.name}
        </span>
        <span
          className={`flex-shrink-0 text-status-badge font-bold uppercase tracking-status-badge ${
            line.status === 'unknown' ? 'text-warning' : 'text-text-2'
          }`}
        >
          {line.status === 'unknown' ? 'Unknown' : 'Ambiguous'}
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="text-meta text-text-2">
          Not in the catalogue. This line will be skipped.
        </p>
      ) : (
        <div className="flex flex-wrap gap-8">
          {line.status === 'unknown' && (
            <Chip
              label="Skip"
              selected={selected === IGNORE}
              onClick={() => onChoose(IGNORE)}
            />
          )}
          {candidates.map((candidate) => (
            <Chip
              key={candidate.cardId}
              label={candidateLabel(candidate, currency)}
              selected={selected === candidate.cardId}
              onClick={() => onChoose(candidate.cardId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
