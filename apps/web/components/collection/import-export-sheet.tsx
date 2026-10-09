'use client'

// Feuille `Import & export` unifiée : un seul point d'entrée, segmenté Import|Export,
// monté depuis le menu `···` de l'accueil Collection (les deux styles) et
// celui du container racine (« All collection ») — remplace les deux lignes
// séparées `Import`/`Export` de ces trois menus. Les feuilles import/export
// PAR CONTAINER (`components/lists/import-sheet.tsx`,
// `components/lists/export-sheet.tsx`) restent inchangées pour les menus de
// binder/liste — seule la porte d'entrée collection change ici.
//
// Import : pas d'étape d'arbitrage visible (contrairement à `ImportSheet`) —
// un seul bouton. `resolveListAction` tourne en
// silence juste avant l'écriture pour connaître les lignes qui resteront
// « unknown » (le compte `skipped` et la liste d'erreurs de l'écran de
// résultat) ; `importListAction` écrit avec l'arbitrage par défaut du
// serveur (impression la moins chère pour une ambiguë, lignes inconnues
// ignorées) — les deux actions d'import existantes, réutilisées telles quelles,
// jamais une troisième voie d'écriture sur `holdings`.
//
// Export : les lignes viennent d'`exportRowsAction`, un seul aller-retour
// quel que soit le format choisi — CSV/JSON/Text sont composés côté client
// à partir du même tableau de lignes, pas trois requêtes.
import { Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import type { Condition } from '@spellcache/db/schema'
import { formatCount } from '@/lib/format/money'

import { createBinderOrListAction } from '@/app/(app)/collection/actions'
import {
  exportRowsAction,
  listImportExportDestinationsAction,
  type ExportRow,
  type ImportExportDestinations,
} from '@/app/(app)/collection/import-export-actions'
import {
  importListAction,
  resolveListAction,
} from '@/app/(app)/container/[id]/sharing-actions'
import { downloadText } from '@/lib/clipboard'

type Tab = 'import' | 'export'
type Format = 'csv' | 'json' | 'text'

// Valeurs codées `kind:id` —
// un seul `<select>` mélange la collection, chaque binder et chaque liste.
const COLLECTION_VALUE = 'collection'
const NEW_BINDER_VALUE = 'new-binder'
const NEW_LIST_VALUE = 'new-list'

const CONDITIONS: Array<{ value: Condition; label: string }> = [
  { value: 'nm', label: 'NM' },
  { value: 'lp', label: 'LP' },
  { value: 'mp', label: 'MP' },
  { value: 'hp', label: 'HP' },
  { value: 'dmg', label: 'DMG' },
]

const FORMATS: Array<{ value: Format; label: string }> = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
]

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Colonnes exactes : `name,set,collector_number,qty,finish,condition,
// language,price`.
function toCsv(rows: ExportRow[]): string {
  const header = 'name,set,collector_number,qty,finish,condition,language,price'
  const lines = rows.map((row) =>
    [
      csvField(row.name),
      row.set.toUpperCase(),
      row.collectorNumber,
      String(row.qty),
      row.finish,
      row.condition,
      row.language,
      row.price === null ? '' : row.price.toFixed(2),
    ].join(','),
  )
  return [header, ...lines].join('\n')
}

function toJson(rows: ExportRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      name: row.name,
      set: row.set.toUpperCase(),
      collector_number: row.collectorNumber,
      qty: row.qty,
      finish: row.finish,
      condition: row.condition,
      language: row.language,
      price: row.price,
    })),
    null,
    2,
  )
}

// `N Name` par ligne — la finition/condition n'y figurent
// pas, c'est le format qu'un autre deck builder sait recoller.
function toText(rows: ExportRow[]): string {
  return rows.map((row) => `${row.qty} ${row.name}`).join('\n')
}

interface ImportResult {
  imported: number
  destinationName: string
  skipped: number
  skippedNames: string[]
}

function ImportTab({ destinations, onImported, onDone }: {
  destinations: ImportExportDestinations | null
  onImported: () => void
  // Ferme la feuille depuis l'écran de résultat (`Done`) — jamais
  // seulement une remise à zéro locale du formulaire.
  onDone: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [content, setContent] = useState('')
  const [target, setTarget] = useState<string>(COLLECTION_VALUE)
  const [newName, setNewName] = useState('')
  const [condition, setCondition] = useState<Condition>('nm')
  const [foil, setFoil] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const creatingNew = target === NEW_BINDER_VALUE || target === NEW_LIST_VALUE

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setContent(await file.text())
    setError(null)
    event.target.value = ''
  }

  async function handleImport() {
    if (content.trim().length === 0) {
      setError('Paste a list or pick a file first.')
      return
    }
    if (creatingNew && newName.trim().length === 0) {
      setError('Name the binder or list to create.')
      return
    }

    setBusy(true)
    setError(null)

    let containerId: string
    let destinationName: string

    // Les destinations n'ont pas fini de charger (ouverture puis import très
    // rapides) — jamais écrire vers un container id vide plutôt que
    // d'attendre un aller-retour de plus.
    if (destinations === null) {
      setError('Still loading destinations. Try again in a moment.')
      setBusy(false)
      return
    }

    // Aperçu d'abord, contre la collection elle-même quand la destination
    // reste à créer : une liste illisible ne doit pas laisser derrière elle
    // un binder vide.
    const preview = await resolveListAction({
      containerId: creatingNew || target === COLLECTION_VALUE ? destinations.rootContainerId : target,
      text: content,
    })
    if (!preview.ok) {
      setError(
        preview.error === 'invalid'
          ? 'That list is too large to import at once. Split the file and try again.'
          : 'Could not read that list. Try again.',
      )
      setBusy(false)
      return
    }
    if (preview.preview.lines.length === 0) {
      setError('No card line found. Paste a decklist or a CSV export with a header row.')
      setBusy(false)
      return
    }

    if (creatingNew) {
      const kind = target === NEW_BINDER_VALUE ? 'binder' : 'list'
      const created = await createBinderOrListAction({ kind, name: newName.trim() })
      if (!created.ok) {
        setError('Could not create that destination. Try again.')
        setBusy(false)
        return
      }
      containerId = created.containerId
      destinationName = newName.trim()
    } else if (target === COLLECTION_VALUE) {
      containerId = destinations.rootContainerId
      destinationName = 'Collection (no binder)'
    } else {
      containerId = target
      const found =
        destinations.binders.find((b) => b.id === target) ??
        destinations.lists.find((l) => l.id === target)
      destinationName = found?.name ?? 'the destination'
    }

    const imported = await importListAction({ containerId, text: content, condition, foil })
    setBusy(false)
    if (!imported.ok) {
      setError(
        imported.error === 'nothing_to_import'
          ? 'Nothing in that list could be matched to the catalogue.'
          : 'Import failed. Check the destination and try again.',
      )
      return
    }

    const skippedNames = preview.preview.lines
      .filter((line) => line.status === 'unknown')
      .map((line) => line.name)

    setResult({
      imported: imported.imported,
      destinationName,
      skipped: skippedNames.length,
      skippedNames,
    })
    onImported()
  }

  if (result) {
    const shown = result.skippedNames.slice(0, 8)
    const hidden = result.skippedNames.length - shown.length
    return (
      <div>
        <div className="mb-6 text-body font-bold text-text">
          {formatCount(result.imported)} card{result.imported === 1 ? '' : 's'} imported
        </div>
        <div className="mb-14 text-meta leading-normal text-text-2">
          Into {result.destinationName}
          {result.skipped > 0 ? ` · ${formatCount(result.skipped)} skipped` : ''}
        </div>
        {shown.length > 0 && (
          <ScrollArea className="mb-14 flex max-h-import-errors flex-col gap-4 rounded-control bg-surface-2 px-12 py-10 text-meta leading-normal text-text-2">
            {shown.map((name, index) => (
              <div key={index}>{name}</div>
            ))}
            {hidden > 0 && <div className="mt-6">...and {formatCount(hidden)} more.</div>}
          </ScrollArea>
        )}
        <button
          type="button"
          onClick={() => {
            setContent('')
            setResult(null)
            onDone()
          }}
          className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-14">
      <p className="text-meta leading-normal text-text-2">
        Paste a decklist (Moxfield, Archidekt, MTGO, Arena) or a CSV export (ManaBox, Deckbox,
        Moxfield, Delver Lens). The format is detected automatically.
      </p>

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={5}
        aria-label="List to import"
        placeholder={'4 Lightning Bolt (M11) 149\n2 Counterspell'}
        className="w-full resize-y rounded-control border border-border bg-surface-1 px-14 py-11 font-mono text-meta-mono leading-normal text-text outline-none placeholder:text-text-3"
      />

      <input
        ref={fileInputRef}
        type="file"
        // Les sélecteurs de fichiers Android (Drive, Téléchargements) étiquettent
        // souvent un CSV `text/comma-separated-values` ou `application/vnd.ms-excel` :
        // sans ces types, il apparaît grisé.
        accept=".csv,.txt,.tsv,text/csv,text/plain,text/comma-separated-values,text/tab-separated-values,application/csv,application/vnd.ms-excel"
        onChange={(event) => void handleFile(event)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full rounded-control border-thin border-dashed border-border-dashed bg-transparent py-11 text-meta font-semibold text-text-2"
      >
        Choose a file...
      </button>

      <div>
        <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          Import into
        </div>
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label="Import into"
          className="w-full rounded-control border border-border bg-surface-1 px-14 py-10 text-body text-text outline-none"
        >
          <option value={COLLECTION_VALUE}>Collection (no binder)</option>
          {destinations?.binders.map((binder) => (
            <option key={binder.id} value={binder.id}>
              Binder · {binder.name}
            </option>
          ))}
          {destinations?.lists.map((list) => (
            <option key={list.id} value={list.id}>
              List · {list.name}
            </option>
          ))}
          <option value={NEW_BINDER_VALUE}>+ New binder...</option>
          <option value={NEW_LIST_VALUE}>+ New list...</option>
        </select>
      </div>

      {creatingNew && (
        <div>
          <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            {target === NEW_BINDER_VALUE ? 'New binder name' : 'New list name'}
          </div>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={target === NEW_BINDER_VALUE ? 'Imported binder' : 'Imported list'}
            className="w-full rounded-control border border-border bg-surface-1 px-14 py-10 text-body text-text outline-none placeholder:text-text-3"
          />
        </div>
      )}

      <div>
        <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          Condition when the source doesn&rsquo;t say
        </div>
        <Segmented options={CONDITIONS} value={condition} onChange={setCondition} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-body font-semibold text-text">Treat as foil by default</span>
        <Switch checked={foil} onChange={setFoil} label="Treat as foil by default" />
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-8 rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
      >
        <Upload width={16} height={16} strokeWidth={1.75} />
        {busy ? 'Importing...' : 'Import'}
      </button>
    </div>
  )
}

function ExportTab({ destinations }: { destinations: ImportExportDestinations | null }) {
  const [scope, setScope] = useState<string>(COLLECTION_VALUE)
  const [format, setFormat] = useState<Format>('csv')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setPending(true)
    setError(null)

    const scopedInput =
      scope === COLLECTION_VALUE
        ? ({ scope: 'collection' } as const)
        : ({ scope: 'container', containerId: scope } as const)
    const result = await exportRowsAction(scopedInput)
    setPending(false)

    if (!result.ok) {
      setError('Export failed. Please try again.')
      return
    }

    const name =
      scope === COLLECTION_VALUE
        ? 'collection'
        : slug(
            destinations?.binders.find((b) => b.id === scope)?.name ??
              destinations?.lists.find((l) => l.id === scope)?.name ??
              'export',
          )

    if (format === 'csv') downloadText(toCsv(result.rows), `${name}.csv`, 'text/csv')
    else if (format === 'json') downloadText(toJson(result.rows), `${name}.json`, 'application/json')
    else downloadText(toText(result.rows), `${name}.txt`, 'text/plain')
  }

  return (
    <div className="flex flex-col gap-14">
      <div>
        <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          What to export
        </div>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          aria-label="What to export"
          className="w-full rounded-control border border-border bg-surface-1 px-14 py-10 text-body text-text outline-none"
        >
          <option value={COLLECTION_VALUE}>All collection</option>
          {destinations?.binders.map((binder) => (
            <option key={binder.id} value={binder.id}>
              Binder · {binder.name}
            </option>
          ))}
          {destinations?.lists.map((list) => (
            <option key={list.id} value={list.id}>
              List · {list.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-8 text-section-label font-semibold uppercase tracking-section-label text-text-2">
          Format
        </div>
        <Segmented options={FORMATS} value={format} onChange={setFormat} />
      </div>

      <p className="text-meta leading-normal text-text-2">
        CSV and JSON carry quantity, finish, condition and prices. Text is a plain decklist other
        apps can re-import.
      </p>

      {error && <p className="text-meta text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={pending}
        className="flex w-full items-center justify-center gap-8 rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
      >
        <Download width={16} height={16} strokeWidth={1.75} />
        {pending ? 'Preparing...' : 'Download'}
      </button>
    </div>
  )
}

export function ImportExportSheet({
  open,
  onOpenChange,
  initialTab = 'import',
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: Tab
  // Rafraîchit l'écran appelant après un import réussi (même contrat que
  // `ImportSheet.onImported`) — l'export ne mute rien, n'en a pas
  // besoin.
  onImported?: () => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [destinations, setDestinations] = useState<ImportExportDestinations | null>(null)

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    void listImportExportDestinationsAction().then(setDestinations)
  }, [open, initialTab])

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import & export"
      closeLabel="Close import and export sheet"
    >
      <div className="mb-16">
        <Segmented
          options={[
            { value: 'import', label: 'Import' },
            { value: 'export', label: 'Export' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'import' ? (
        <ImportTab
          destinations={destinations}
          onImported={() => onImported?.()}
          onDone={() => onOpenChange(false)}
        />
      ) : (
        <ExportTab destinations={destinations} />
      )}
    </Sheet>
  )
}
