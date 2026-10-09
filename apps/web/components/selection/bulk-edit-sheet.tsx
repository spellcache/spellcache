'use client'

// Écran « Multi-select › Edit » : applique à toute la sélection une quantité,
// une condition, un finish, une langue ou un binder/deck de destination — les
// champs laissés vides ne sont pas appliqués, donc chaque section porte son
// propre état `Keep as is`/`null`, jamais une valeur par défaut envoyée par
// erreur.
//
// Les boutons `Binder`/`To deck`/`Edit` de `ActionBar` ouvrent tous les
// trois cette même feuille (un seul fichier `bulk-edit-sheet.tsx`, un seul
// écran, et `BulkEdit` unifie `qty`/`condition`/`finish`/`language`/
// `targetContainerId` dans un seul appel) — `Binder`/`To deck` n'ouvrent pas
// un second flux, ils entrent dans le même formulaire. `destinationKind`
// restreint la liste de la ligne de destination au type visé par le bouton
// pressé, pour que `Binder` et `To deck` expriment une intention distincte
// plutôt qu'une même liste mêlant binders et decks — `Edit` montre les deux
// groupes, la feuille restant une édition générale.
//
// La ligne de destination ouvre `PickerSheet` plutôt qu'un `<select>` natif —
// même composant partagé que tout autre picker de l'app, coche accent sur
// l'entrée courante. spellcache n'a qu'un seul modèle (« un deck est un
// container, ses cartes sont des holdings », docs/development.md) : binder et deck
// restent donc une seule et même ligne de destination, à l'intérieur de
// cette feuille.
//
// Langue : `holdings.language` participe à la clé de fusion
// (`lib/containers/bulk.ts`), et `BulkEdit.language` la porte
// jusqu'à `bulkEdit`.
import { useEffect, useState } from 'react'
import { BookCopy, Hash, Languages } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { PickerSheet } from '@/components/ui/picker-sheet'
import { QtyStepper } from '@/components/cards/qty-stepper'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import type { Condition, Finish } from '@spellcache/db/schema'

import { listBulkMoveTargetsAction, type BulkMoveTarget } from '@/app/(app)/container/[id]/bulk-actions'

// Libellés LONGS (comme `card-edit-controls.tsx:20-26`) — même
// jeu de cinq valeurs de condition (docs/development.md) que partout ailleurs dans
// l'app, jamais le vocabulaire à deux crans du design (même précédent que
// la devise par défaut).
const CONDITIONS: Condition[] = ['nm', 'lp', 'mp', 'hp', 'dmg']
const CONDITION_LABEL: Record<Condition, string> = {
  nm: 'Near mint',
  lp: 'Lightly played',
  mp: 'Moderately played',
  hp: 'Heavily played',
  dmg: 'Damaged',
}

// Sept langues, mêmes codes que
// `add-card-sheet.tsx`.
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
]

type FinishOption = 'keep' | Finish

export interface BulkEditFormValue {
  qty?: number
  condition?: Condition
  finish?: Finish
  language?: string
  targetContainerId?: string
}

// « Mixed » quand la sélection diverge, la valeur partagée sinon — la
// feuille dit ainsi ce
// qu'elle est sur le point d'aplatir plutôt qu'un « Keep as is » muet.
function sharedValue<T, V>(entries: T[], read: (entry: T) => V): V | null {
  if (entries.length === 0) return null
  const first = read(entries[0]!)
  return entries.every((entry) => read(entry) === first) ? first : null
}

export interface BulkEditEntry {
  condition: Condition
  qty: number
}

export function BulkEditSheet({
  open,
  onOpenChange,
  count,
  containerId,
  // Sélection courante — sert uniquement à afficher la
  // valeur partagée de condition/quantité ; jamais envoyée telle quelle au
  // serveur, qui reste la seule source de vérité sur ce qui est réellement
  // écrit.
  entries,
  onSubmit,
  destinationKind = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  containerId: string
  entries: BulkEditEntry[]
  onSubmit: (edit: BulkEditFormValue) => Promise<{ ok: true } | { ok: false; error: string }>
  // `null` (bouton `Edit`) montre binders et decks ; `'binder'`/`'deck'`
  // (boutons `Binder`/`To deck` de `ActionBar`) restreint la liste à ce seul
  // type.
  destinationKind?: 'binder' | 'deck' | null
}) {
  const [condition, setCondition] = useState<Condition | null>(null)
  const [finish, setFinish] = useState<FinishOption>('keep')
  const [language, setLanguage] = useState<string | null>(null)
  const [keepQty, setKeepQty] = useState(true)
  const [qty, setQty] = useState(1)
  const [targetContainerId, setTargetContainerId] = useState<string>('')
  const [moveTargets, setMoveTargets] = useState<BulkMoveTarget[]>([])
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentCondition = sharedValue(entries, (entry) => entry.condition)
  const currentQuantity = sharedValue(entries, (entry) => entry.qty) ?? 1

  function reset() {
    setCondition(null)
    setFinish('keep')
    setLanguage(null)
    setKeepQty(true)
    setQty(1)
    setTargetContainerId('')
    setError(null)
    setSubmitting(false)
  }

  useEffect(() => {
    if (!open) return
    void listBulkMoveTargetsAction(containerId).then(setMoveTargets)
  }, [open, containerId])

  async function handleApply() {
    setSubmitting(true)
    setError(null)

    const edit: BulkEditFormValue = {
      ...(condition !== null && { condition }),
      ...(finish !== 'keep' && { finish }),
      ...(language !== null && { language }),
      ...(!keepQty && { qty }),
      ...(targetContainerId && { targetContainerId }),
    }

    const result = await onSubmit(edit)

    if (!result.ok) {
      setError(
        result.error === 'deck_locked'
          ? 'This deck is built and locked. Bulk actions are refused.'
          : 'Could not apply the edit. Try again.',
      )
      setSubmitting(false)
      return
    }

    reset()
    onOpenChange(false)
  }

  const binders = moveTargets.filter((target) => target.kind === 'binder')
  const decks = moveTargets.filter((target) => target.kind === 'deck')
  const showBinders = destinationKind !== 'deck'
  const showDecks = destinationKind !== 'binder'

  // Titre/vide de la feuille de destination — un libellé propre au type quand
  // `destinationKind` restreint à un seul type, un titre générique sinon (le
  // modèle unifié de spellcache montre alors les deux groupes ensemble).
  const pickerTitle =
    destinationKind === 'binder'
      ? `Move ${count} card${count === 1 ? '' : 's'}`
      : destinationKind === 'deck'
        ? `Add ${count} card${count === 1 ? '' : 's'} to a deck`
        : 'Destination'
  const pickerOptions = [
    ...(showBinders
      ? [
          { value: '', label: 'No binder', hint: 'Loose in the collection' },
          ...binders.map((target) => ({
            value: target.id,
            label: target.name,
            hint: `${target.cardCount} card${target.cardCount === 1 ? '' : 's'}`,
          })),
        ]
      : []),
    ...(showDecks
      ? decks.map((target) => ({
          value: target.id,
          label: target.name,
          hint: `${target.cardCount} card${target.cardCount === 1 ? '' : 's'}`,
        }))
      : []),
  ]
  const pickerEmptyMessage =
    destinationKind === 'deck'
      ? 'No planning deck yet — create one from the Decks tab.'
      : 'No binder yet — create one from the Collection tab.'
  const destinationTarget = moveTargets.find((target) => target.id === targetContainerId)
  const destinationValueLabel = targetContainerId
    ? (destinationTarget?.name ?? 'Selected')
    : destinationKind === null
      ? 'Keep as is'
      : 'No binder'

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      title={`Edit ${count} ${count === 1 ? 'card' : 'cards'}`}
    >
      <div className="flex flex-col gap-14">
        <p className="text-meta text-text-2">
          Only the fields you touch are applied — the rest keep each card&rsquo;s own value.
        </p>

        <div>
          <div className="mb-9 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Condition
          </div>
          <div className="flex flex-wrap gap-6">
            {/* Valeur partagée quand la sélection est homogène, « Mixed »
                sinon — `tone="quiet"` : cette puce ne
                prétend jamais être un choix aussi affirmatif qu'une valeur
                réelle. */}
            <Chip
              label={currentCondition ? CONDITION_LABEL[currentCondition] : 'Mixed'}
              selected={condition === null}
              onClick={() => setCondition(null)}
              variant="group"
              tone="quiet"
            />
            {CONDITIONS.map((option) => (
              <Chip
                key={option}
                label={CONDITION_LABEL[option]}
                selected={condition === option}
                onClick={() => setCondition(option)}
                variant="group"
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-9 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Finish
          </div>
          <Segmented
            options={[
              { value: 'keep', label: 'Keep as is' },
              { value: 'nonfoil', label: 'Non-foil' },
              { value: 'foil', label: 'Foil' },
            ]}
            value={finish}
            onChange={setFinish}
          />
        </div>

        <div>
          <div className="mb-9 flex items-center justify-between">
            <span className="flex items-center gap-6 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              <Hash width={13} height={13} strokeWidth={1.75} className="text-text-3" />
              Quantity
            </span>
            {keepQty ? (
              // « Set » plutôt qu'une puce : passer en édition initialise le
              // stepper sur la quantité partagée de la sélection, jamais
              // sur 1 par défaut.
              <button
                type="button"
                onClick={() => {
                  setQty(currentQuantity)
                  setKeepQty(false)
                }}
                className="text-meta font-bold text-accent-text"
              >
                Set
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setKeepQty(true)}
                className="text-meta font-bold text-text-2"
              >
                Clear
              </button>
            )}
          </div>
          {/* Hint dynamique — dit ce que le champ va faire
              avant même de le toucher. */}
          <p className="mb-9 text-meta text-text-2">
            {keepQty ? "Keep each card's own" : `Every card becomes ×${qty}`}
          </p>
          {!keepQty && <QtyStepper holdingId="bulk-quantity" qty={qty} onChange={setQty} min={1} />}
        </div>

        <div className="overflow-hidden rounded-chip bg-surface-2">
          <div className="flex items-center gap-12 px-14 py-13">
            <Languages width={17} height={17} strokeWidth={1.75} className="flex-shrink-0 text-text-2" />
            <span className="min-w-0 flex-1 text-row-value font-semibold text-text">Language</span>
            <select
              value={language ?? ''}
              onChange={(event) => setLanguage(event.target.value === '' ? null : event.target.value)}
              className="rounded-chip border border-border bg-surface-1 px-10 py-7 text-meta font-semibold text-text"
            >
              <option value="">Keep as is</option>
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setDestinationPickerOpen(true)}
            className="flex w-full items-center gap-12 border-t border-border px-14 py-13 text-left"
          >
            <BookCopy width={17} height={17} strokeWidth={1.75} className="flex-shrink-0 text-text-2" />
            <span className="min-w-0 flex-1 text-row-value font-semibold text-text">
              {destinationKind === 'binder' ? 'Binder' : destinationKind === 'deck' ? 'Deck' : 'Destination'}
            </span>
            <span className="text-meta font-semibold text-text-2">{destinationValueLabel}</span>
          </button>
        </div>

        {error && <p className="text-meta text-danger">{error}</p>}

        <button
          type="button"
          onClick={handleApply}
          disabled={submitting}
          className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
        >
          {submitting ? 'Applying...' : `Apply to ${count} ${count === 1 ? 'card' : 'cards'}`}
        </button>
      </div>

      <PickerSheet
        open={destinationPickerOpen}
        onClose={() => setDestinationPickerOpen(false)}
        title={pickerTitle}
        options={pickerOptions}
        value={targetContainerId}
        onPick={(value) => setTargetContainerId(value)}
        emptyMessage={pickerEmptyMessage}
      />
    </Sheet>
  )
}
