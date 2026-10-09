'use client'

// Écran `Export the missing cards` : six formats, chacun avec
// un VRAI contenu (jamais un texte partagé habillé de six libellés) — la
// syntaxe que la boutique ou l'appli tierce visée attend réellement, jamais
// une syntaxe inventée sans contrat.
import { Check, Copy, Download, ExternalLink } from 'lucide-react'
import { useState } from 'react'

import { PickerSheet } from '@/components/ui/picker-sheet'
import { Sheet } from '@/components/ui/sheet'

import { acquireMissingAction, listAcquireTargetsAction, type AcquireTarget } from './lifecycle-actions'
import type { DeckSlot } from './deck-data'
import { copyText, downloadText } from '@/lib/clipboard'

// `setLine` (`deck-data.ts`) porte toujours `SET #NUMBER` en préfixe —
// même extraction que l'ancien `formatDeckList`, désormais partagée par tous
// les formats qui ont besoin du set/numéro de collection.
function parseSetLine(setLine: string): { set: string; number: string } {
  const match = /^(\S+) #(\S+)/.exec(setLine)
  return { set: match?.[1] ?? '???', number: match?.[2] ?? '?' }
}

// Ligne « decklist syntax » — partagée par Moxfield/Archidekt et Plain text :
// pour un export qui ne porte que le manquant (aucune notion de zone ici,
// jamais de commandant ni de côté à distinguer), les deux formats produisent
// exactement la même ligne.
function decklistLine(slot: DeckSlot): string {
  const { set, number } = parseSetLine(slot.setLine)
  return `${slot.need} ${slot.name} (${set}) ${number}`
}

// Exportée pour `tests/unit/export-deck-list.test.ts` — remplace l'ancien
// `formatDeckList` (même sortie, même contrat), partagée par Moxfield/Archidekt
// et Plain text plutôt que dédiée à un unique format partagé par les six.
export function formatDecklistText(slots: DeckSlot[]): string {
  return slots.map(decklistLine).join('\n')
}

// Card Kingdom mass entry : `<name> x<qty>` — aucun set, la boutique résout elle-même l'impression la moins chère.
function formatCardKingdom(slots: DeckSlot[]): string {
  return slots.map((slot) => `${slot.name} x${slot.need}`).join('\n')
}

// Cardmarket wants list : `<qty> <name>` — noms anglais, jamais de set.
function formatCardmarket(slots: DeckSlot[]): string {
  return slots.map((slot) => `${slot.need} ${slot.name}`).join('\n')
}

// TCGplayer mass entry : `<qty> <name>`, le set entre crochets seulement
// quand il est connu.
function formatTcgplayer(slots: DeckSlot[]): string {
  return slots
    .map((slot) => {
      const { set } = parseSetLine(slot.setLine)
      return `${slot.need} ${slot.name}${set === '???' ? '' : ` [${set}]`}`
    })
    .join('\n')
}

function csvField(value: string): string {
  return /["\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Une ligne par carte, prix compris — le prix vient
// déjà de `DeckSlot.priceMinor`, résolu dans la devise du compte
// (`price_source`, docs/development.md, unique source de vérité) : cette feuille ne
// convertit rien, elle imprime ce que le deck affiche déjà.
function formatCsv(slots: DeckSlot[]): string {
  const rows = slots.map((slot) => {
    const { set, number } = parseSetLine(slot.setLine)
    const price = slot.priceMinor === null ? '' : (slot.priceMinor / 100).toFixed(2)
    return [String(slot.need), csvField(slot.name), set, number, price].join(',')
  })
  return ['quantity,name,set,number,price', ...rows].join('\n')
}

interface ExportFormat {
  key: 'cardkingdom' | 'cardmarket' | 'tcgplayer' | 'moxfield' | 'text' | 'csv'
  label: string
  hint: string
  openUrl?: string
  content: (slots: DeckSlot[]) => string
}

// Les six destinations, chacune avec son vrai contenu et, pour les trois
// boutiques, la page où coller ce contenu (`Open` — Card Kingdom deck
// builder, Cardmarket wants, TCGplayer mass entry).
const FORMATS: ExportFormat[] = [
  {
    key: 'cardkingdom',
    label: 'Card Kingdom',
    hint: 'name × qty',
    openUrl: 'https://www.cardkingdom.com/builder',
    content: formatCardKingdom,
  },
  {
    key: 'cardmarket',
    label: 'Cardmarket',
    hint: 'Wants list',
    openUrl: 'https://www.cardmarket.com/en/Magic/Wants',
    content: formatCardmarket,
  },
  {
    key: 'tcgplayer',
    label: 'TCGplayer',
    hint: 'mass entry',
    openUrl: 'https://www.tcgplayer.com/massentry',
    content: formatTcgplayer,
  },
  { key: 'moxfield', label: 'Moxfield / Archidekt', hint: 'decklist syntax', content: formatDecklistText },
  { key: 'text', label: 'Plain text', hint: 'qty, name, set, number', content: formatDecklistText },
  { key: 'csv', label: 'CSV', hint: 'one row per card, with prices', content: formatCsv },
]

export function ExportSheet({
  open,
  onOpenChange,
  deckId,
  deckName,
  slots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deckId: string
  deckName: string
  slots: DeckSlot[]
}) {
  const [selectedKey, setSelectedKey] = useState<ExportFormat['key']>('cardkingdom')
  const [copied, setCopied] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [targets, setTargets] = useState<AcquireTarget[] | null>(null)
  const [acquiring, setAcquiring] = useState(false)
  const [acquireError, setAcquireError] = useState<string | null>(null)

  const format = FORMATS.find((entry) => entry.key === selectedKey)!
  const content = format.content(slots)
  const previewLines = content.split('\n').filter(Boolean).slice(0, 2)

  async function handleCopy() {
    if (!content) return
    if (!(await copyText(content))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function handleDownload() {
    if (!content) return
    downloadText(
      content,
      `${deckName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-missing.${
        selectedKey === 'csv' ? 'csv' : 'txt'
      }`,
    )
  }

  async function openPicker() {
    setAcquireError(null)
    setPickerOpen(true)
    if (targets !== null) return
    const result = await listAcquireTargetsAction({ deckId })
    if ('error' in result) {
      setAcquireError('Could not load your binders.')
      return
    }
    setTargets(result)
  }

  // Ferme la feuille d'export une fois les manquantes matérialisées — la
  // boucle achat → possédé → assemblage se referme ici, `Assemble` relira
  // l'état réel à la prochaine ouverture.
  async function handleAcquire(containerId: string | null) {
    setAcquiring(true)
    setAcquireError(null)
    const result = await acquireMissingAction({ deckId, containerId })
    setAcquiring(false)
    if (!result.ok) {
      setAcquireError('Could not add these cards to the collection. Please try again.')
      return
    }
    onOpenChange(false)
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        // Singulier quand il n'y a qu'une carte.
        title={`Export ${slots.length} missing card${slots.length === 1 ? '' : 's'}`}
        closeLabel="Close export sheet"
      >
        <div className="mb-8 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          Format
        </div>
        <div className="mb-14 flex flex-col gap-8">
          {FORMATS.map((entry) => {
            const active = entry.key === selectedKey
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setSelectedKey(entry.key)}
                aria-pressed={active}
                className={`flex flex-col gap-6 rounded-control border px-13 py-11 text-left ${
                  active ? 'border-accent bg-accent-bg' : 'border-border bg-surface-2'
                }`}
              >
                <span className="flex items-baseline gap-7">
                  <span className={`text-intensity-label font-bold ${active ? 'text-accent-text' : 'text-text'}`}>
                    {entry.label}
                  </span>
                  <span className="text-value-caption text-text-2">({entry.hint})</span>
                </span>
                {active && (
                  <span className="block whitespace-pre-wrap break-words font-mono text-meta-mono leading-normal text-text-2">
                    {previewLines.length > 0 ? previewLines.join('\n') : 'Nothing missing.'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mb-14 flex gap-8">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!content}
            className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-13 text-meta font-bold text-text disabled:opacity-50"
          >
            {copied ? (
              <Check width={15} height={15} strokeWidth={1.75} />
            ) : (
              <Copy width={15} height={15} strokeWidth={1.75} />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!content}
            className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-13 text-meta font-bold text-text disabled:opacity-50"
          >
            <Download width={15} height={15} strokeWidth={1.75} />
            Download
          </button>
          {format.openUrl && (
            <button
              type="button"
              onClick={() => window.open(format.openUrl, '_blank', 'noopener,noreferrer')}
              className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-13 text-meta font-bold text-text"
            >
              <ExternalLink width={15} height={15} strokeWidth={1.75} />
              Open
            </button>
          )}
        </div>

        {acquireError && <p className="mb-9 text-meta text-danger">{acquireError}</p>}

        {/* L'autre moitié de la boucle : une fois la commande arrivée, ces
            cartes deviennent réelles et `Assemble` cesse de les inventer. */}
        <button
          type="button"
          onClick={() => void openPicker()}
          disabled={slots.length === 0 || acquiring}
          className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
        >
          Add all {slots.length} to the collection
        </button>
        <p className="mt-10 px-2 text-value-caption leading-normal text-text-3">
          Use this when the order arrives — the cards become yours, loose in the collection.
        </p>
      </Sheet>

      <PickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="File them where?"
        options={[
          { value: null, label: 'No binder', hint: 'Loose in the collection' },
          ...(targets ?? []).map((target) => ({
            value: target.id,
            label: target.name,
            hint: `${target.cardCount} cards`,
          })),
        ]}
        onPick={(value) => void handleAcquire(value)}
      />
    </>
  )
}
