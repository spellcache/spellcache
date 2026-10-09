'use client'

// Export d'un container en texte. Cet écran n'a pas de design dédié : la
// feuille reprend `Sheet`, le segmenté, le bloc d'aperçu monospace et les
// deux boutons de bas de feuille exactement tels que
// `app/(app)/decks/[id]/export-sheet.tsx` les rend déjà — mêmes classes, mêmes
// tokens, aucun langage visuel neuf.
import { Copy, Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'

import type { DeckZone } from '@spellcache/db/schema'

import {
  getContainerListAction,
  type ExportLine,
} from '@/app/(app)/container/[id]/sharing-actions'
import { copyText, downloadText } from '@/lib/clipboard'

type Variant = 'full' | 'names'

// Même grammaire de ligne que `formatDeckList`
// (`app/(app)/decks/[id]/export-sheet.tsx`) : `<qty> <name> (<SET>) <number>`.
// Il faut la même mise en forme que `formatDeckList`, plus une variante
// `avec set et numéro` ; comme `formatDeckList` porte déjà le set et le numéro,
// la variante nommée est celle qui les porte, et la seconde forme est le nom nu
// — les deux figurent parmi les quatre formats d'entrée acceptés par
// `parseList`, l'aller-retour tient donc dans les deux cas.
//
// `full` est le défaut : c'est la seule forme qui redonne **exactement** la
// même impression à la réimportation. Le nom nu laisse la résolution choisir
// (impression la moins chère) dès qu'une carte a plusieurs éditions.

// En-têtes de section : exactement les trois libellés que `parseList`
// reconnaît (`Commander`, `Deck`, `Sideboard`), dans l'ordre de lecture d'un
// deck. Sans eux, un deck Commander exporté puis réimporté perdait son
// commandant et fondait son côté dans le mainboard — un aller-retour doit
// redonner exactement les mêmes cartes, et la zone fait partie de la carte dans
// un deck.
const ZONE_HEADER: Record<DeckZone, string> = {
  commander: 'Commander',
  main: 'Deck',
  side: 'Sideboard',
}
const ZONE_ORDER: DeckZone[] = ['commander', 'main', 'side']

// `is_commander` fait foi sur `zone` : même normalisation que
// `getDeck` et `lib/sharing/public-container.ts`, pour qu'une ligne écrite
// avant le couplage des deux colonnes s'exporte quand même comme un
// commandant.
function zoneOf(line: ExportLine): DeckZone {
  return line.isCommander ? 'commander' : line.zone
}

export function formatContainerList(
  lines: ExportLine[],
  options: { withSetAndNumber?: boolean } = {},
): string {
  const withSetAndNumber = options.withSetAndNumber ?? true
  const render = (line: ExportLine) =>
    withSetAndNumber
      ? `${line.qty} ${line.name} (${line.setCode.toUpperCase()}) ${line.collectorNumber}`
      : `${line.qty} ${line.name}`

  const grouped = new Map<DeckZone, ExportLine[]>()
  for (const line of lines) {
    const zone = zoneOf(line)
    const bucket = grouped.get(zone)
    if (bucket) bucket.push(line)
    else grouped.set(zone, [line])
  }

  const zones = ZONE_ORDER.filter((zone) => grouped.has(zone))

  // Aucun en-tête tant que tout tient dans `main` : l'export d'un binder, de
  // la collection ou d'un deck sans commandant ni côté reste **mot pour
  // mot** la sortie de `formatDeckList`.
  if (zones.length <= 1 && zones[0] !== 'commander' && zones[0] !== 'side') {
    return lines.map(render).join('\n')
  }

  return zones
    .map((zone) => [ZONE_HEADER[zone], ...grouped.get(zone)!.map(render)].join('\n'))
    .join('\n\n')
}

export function ListExportSheet({
  open,
  onOpenChange,
  containerId,
  containerName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string
  containerName: string
}) {
  const [variant, setVariant] = useState<Variant>('full')
  const [lines, setLines] = useState<ExportLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setLines(null)
    void getContainerListAction({ containerId }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError('Could not read this list. Try again.')
        return
      }
      setLines(result.lines)
    })
    return () => {
      cancelled = true
    }
  }, [open, containerId])

  const text = lines ? formatContainerList(lines, { withSetAndNumber: variant === 'full' }) : ''
  const previewLines = text.length > 0 ? text.split('\n') : []
  const visiblePreview = previewLines.slice(0, 6)
  const hiddenCount = previewLines.length - visiblePreview.length

  async function handleCopy() {
    if (!(await copyText(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    downloadText(text, `${containerName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Export list"
      closeLabel="Close export list sheet"
    >
      <p className="mb-16 text-meta leading-normal text-text-2">
        Plain text, one card per line. Paste it back into spellcache or into any deck builder that
        takes a decklist.
      </p>

      <div className="mb-16">
        <Segmented<Variant>
          options={[
            { value: 'full', label: 'With set and number' },
            { value: 'names', label: 'Names only' },
          ]}
          value={variant}
          onChange={setVariant}
        />
      </div>

      <div className="mb-8 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
        Preview
      </div>
      <div className="mb-16 rounded-control border border-border bg-surface-1 px-14 py-12 font-mono text-meta-mono leading-normal text-text-2">
        {error ? (
          <div className="text-danger">{error}</div>
        ) : lines === null ? (
          <div>Loading...</div>
        ) : previewLines.length === 0 ? (
          <div>This list is empty.</div>
        ) : (
          <>
            {visiblePreview.map((line, index) => (
              <div key={index} className="text-text">
                {line}
              </div>
            ))}
            {hiddenCount > 0 && <div>...{hiddenCount} more</div>}
          </>
        )}
      </div>

      <div className="flex gap-8">
        <button
          type="button"
          onClick={handleDownload}
          disabled={previewLines.length === 0}
          className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-13 text-meta font-bold text-text disabled:opacity-60"
        >
          <Download width={16} height={16} strokeWidth={1.75} />
          Download
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={previewLines.length === 0}
          className="flex flex-1 items-center justify-center gap-7 rounded-control bg-accent py-13 text-meta font-extrabold text-on-accent disabled:opacity-60"
        >
          <Copy width={16} height={16} strokeWidth={1.75} />
          {copied ? 'Copied!' : 'Copy list'}
        </button>
      </div>
    </Sheet>
  )
}
