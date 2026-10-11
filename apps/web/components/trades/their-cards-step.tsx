'use client'

// Étape « What does X give? » (en personne) : chercher une carte dans le
// catalogue, ou importer une liste (decklist ou CSV). Les cartes ajoutées
// s'affichent en liste compacte sous la recherche.
import { Check, ChevronLeft, Plus } from 'lucide-react'
import { useId, useState } from 'react'

import {
  addCatalogLineAction,
  addCatalogLinesAction,
  previewImportAction,
} from '@/app/(app)/tools/trade/actions'
import { printingsAction, searchCatalogAction } from '@/app/(app)/search/actions'
import { CompactCardList } from '@/components/trades/compact-card-list'
import { SearchField } from '@/components/ui/search-field'
import { Segmented } from '@/components/ui/segmented'
import { SecondaryButton, SectionLabel } from '@/components/ui/sheet-controls'
import { formatMoney, type Currency } from '@/lib/format/money'
import type { CardSearchItem, PrintingItem } from '@/lib/search/search-cards'
import type { ImportPreviewLine, TradeView } from '@/lib/trades/trades'
import type { RunAction } from '@/components/trades/use-trade'

const MIN_QUERY_LENGTH = 2

function priceLabel(price: number | null, currency: Currency): string {
  return price === null ? '—' : formatMoney(Math.round(price * 100), currency)
}

function ResultRow({
  title,
  subtitle,
  price,
  added,
  onAdd,
  onOpen,
  disabled,
}: {
  title: string
  subtitle: string
  price: string
  added: boolean
  onAdd: () => void
  onOpen?: () => void
  disabled: boolean
}) {
  const body = (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-row-value font-semibold text-text">
        {title}
      </span>
      <span className="block text-meta-search text-text-2">{subtitle}</span>
    </span>
  )
  return (
    <div className="flex items-center gap-10 border-t border-border px-12 py-10 first:border-t-0">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center"
        >
          {body}
        </button>
      ) : (
        body
      )}
      <span className="font-mono text-row-price font-bold text-accent-text">{price}</span>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        aria-label={`Add ${title} ${subtitle}`}
        className={`flex h-qty-button w-qty-button items-center justify-center rounded-full ${
          added ? 'bg-accent text-on-accent' : 'bg-surface-2 text-text'
        }`}
      >
        {added ? (
          <Check width={14} height={14} strokeWidth={3} />
        ) : (
          <Plus width={14} height={14} strokeWidth={2} />
        )}
      </button>
    </div>
  )
}

export function TheirCardsStep({
  trade,
  pending,
  run,
}: {
  trade: TradeView
  pending: boolean
  run: RunAction
}) {
  const pasteId = useId()
  const [tab, setTab] = useState<'search' | 'import'>('search')
  const [results, setResults] = useState<CardSearchItem[]>([])
  const [lastQuery, setLastQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [printingsOf, setPrintingsOf] = useState<CardSearchItem | null>(null)
  const [printings, setPrintings] = useState<PrintingItem[]>([])
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{
    lines: ImportPreviewLine[]
    ignored: number
  } | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [importError, setImportError] = useState<string | null>(null)

  const addedIds = new Set(trade.get.lines.map((line) => line.cardId))

  async function search(value: string) {
    const trimmed = value.trim()
    setLastQuery(trimmed)
    setPrintingsOf(null)
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }
    setSearching(true)
    const result = await searchCatalogAction({ query: trimmed, scope: 'search' }).catch(
      () => null,
    )
    setSearching(false)
    setResults(result && !('error' in result) ? result.items : [])
  }

  async function openPrintings(card: CardSearchItem) {
    setPrintingsOf(card)
    setPrintings([])
    const result = await printingsAction({ name: card.name }).catch(() => null)
    setPrintings(result?.items ?? [])
  }

  function add(cardId: string) {
    void run(() =>
      addCatalogLineAction({
        tradeId: trade.id,
        cardId,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 1,
      }),
    )
  }

  async function analyse() {
    setImportError(null)
    const result = await previewImportAction({ tradeId: trade.id, text }).catch(
      () => null,
    )
    if (!result?.ok) {
      setImportError('Could not read this list.')
      return
    }
    setPreview(result)
    setChoices({})
  }

  async function readFile(file: File) {
    setText(await file.text())
    setPreview(null)
  }

  const importable = (preview?.lines ?? [])
    .map((line, index) => ({
      line,
      cardId:
        line.status === 'resolved'
          ? line.cardId
          : line.status === 'ambiguous'
            ? (choices[index] ?? line.candidates[0]?.cardId ?? null)
            : null,
    }))
    .filter(
      (entry): entry is { line: ImportPreviewLine; cardId: string } =>
        entry.cardId !== null,
    )
  const importCount = importable.reduce((sum, entry) => sum + entry.line.qty, 0)
  const unknown = (preview?.lines ?? []).filter((line) => line.status === 'unknown')

  async function addImported() {
    const ok = await run(() =>
      addCatalogLinesAction({
        tradeId: trade.id,
        lines: importable.map(({ line, cardId }) => ({
          cardId,
          finish: line.finish,
          condition: line.condition,
          language: line.language,
          qty: line.qty,
        })),
      }),
    )
    if (ok) {
      setText('')
      setPreview(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-14">
      <Segmented
        options={[
          { value: 'search', label: 'Search' },
          { value: 'import', label: 'Import a list' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'search' ? (
        <div className="flex flex-col gap-12">
          <SearchField
            placeholder="Search card name..."
            onSearch={(value) => void search(value)}
            autoFocus
          />
          {searching && <p className="px-2 text-meta text-text-2">Searching...</p>}
          {!searching && lastQuery.length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <p className="px-2 text-meta text-text-2">No cards found.</p>
          )}
          {printingsOf ? (
            <div className="flex flex-col gap-8">
              <button
                type="button"
                onClick={() => setPrintingsOf(null)}
                className="flex w-fit items-center gap-4 text-meta font-semibold text-text-2"
              >
                <ChevronLeft width={15} height={15} strokeWidth={1.9} />
                Back to results
              </button>
              <div className="overflow-hidden rounded-row border border-border bg-surface-1">
                {printings.map((printing) => (
                  <ResultRow
                    key={printing.id}
                    title={printingsOf.name}
                    subtitle={`${printing.setCode.toUpperCase()} #${printing.collectorNumber} · ${printing.setName}`}
                    price={priceLabel(printing.price, trade.currency)}
                    added={addedIds.has(printing.id)}
                    onAdd={() => add(printing.id)}
                    disabled={pending}
                  />
                ))}
              </div>
            </div>
          ) : (
            results.length > 0 && (
              <div className="overflow-hidden rounded-row border border-border bg-surface-1">
                {results.map((item) => (
                  <ResultRow
                    key={item.id}
                    title={item.name}
                    subtitle={`${item.setCode.toUpperCase()} #${item.collectorNumber} · other printings`}
                    price={priceLabel(item.price, trade.currency)}
                    added={addedIds.has(item.id)}
                    onAdd={() => add(item.id)}
                    onOpen={() => void openPrintings(item)}
                    disabled={pending}
                  />
                ))}
              </div>
            )
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          <label htmlFor={pasteId} className="text-body font-semibold text-text-2">
            Paste a list or a CSV
          </label>
          <textarea
            id={pasteId}
            rows={6}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setPreview(null)
            }}
            placeholder={'1 Sol Ring (CMM) 410\n2 Brainstorm'}
            className="w-full resize-none rounded-control border border-border bg-surface-1 px-12 py-10 font-mono text-meta text-text outline-none"
          />
          <p className="text-meta text-text-3">
            Arena, MTGO, Moxfield lists, or CSV from ManaBox, Moxfield, Deckbox, Delver,
            Dragon Shield.
          </p>
          <label className="w-fit cursor-pointer rounded-control border border-border bg-surface-2 px-14 py-10 text-body font-bold text-text">
            Choose a file
            <input
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>
          {importError && <p className="text-meta text-danger">{importError}</p>}

          {!preview ? (
            <SecondaryButton
              onClick={() => void analyse()}
              disabled={pending || text.trim() === ''}
            >
              Check the list
            </SecondaryButton>
          ) : (
            <div className="flex flex-col gap-10" data-testid="trade-import-preview">
              <div className="overflow-hidden rounded-row bg-surface-2">
                <div className="px-14 py-12 text-row-value font-semibold text-text">
                  {importCount} {importCount === 1 ? 'card' : 'cards'} ready
                </div>
                {preview.lines.map((line, index) =>
                  line.status === 'ambiguous' ? (
                    <div
                      key={index}
                      className="flex items-center gap-10 border-t border-border px-14 py-10"
                    >
                      <span className="min-w-0 flex-1 truncate text-meta font-semibold text-text">
                        {line.qty} {line.name}
                      </span>
                      <select
                        aria-label={`Printing of ${line.name}`}
                        value={choices[index] ?? line.candidates[0]?.cardId}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [index]: event.target.value,
                          }))
                        }
                        className="rounded-control border border-border bg-surface-1 px-8 py-6 text-meta text-text"
                      >
                        {line.candidates.map((candidate) => (
                          <option key={candidate.cardId} value={candidate.cardId}>
                            {candidate.setCode.toUpperCase()} #{candidate.collectorNumber}
                            {candidate.priceMinor === null
                              ? ''
                              : ` · ${formatMoney(candidate.priceMinor, trade.currency)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null,
                )}
                {unknown.length > 0 && (
                  <div className="border-t border-border px-14 py-10 text-meta text-danger">
                    Not found: {unknown.map((line) => line.name).join(', ')}
                  </div>
                )}
              </div>
              <SecondaryButton
                onClick={() => void addImported()}
                disabled={pending || importCount === 0}
              >
                Add {importCount} {importCount === 1 ? 'card' : 'cards'}
              </SecondaryButton>
            </div>
          )}
        </div>
      )}

      {trade.get.lines.length > 0 && (
        <div>
          <SectionLabel>Added</SectionLabel>
          <CompactCardList lines={trade.get.lines} currency={trade.currency} />
        </div>
      )}
    </div>
  )
}
