'use client'

// Écran `See all` d'un dossier (liste verticale des decks du dossier,
// réutilisant les lignes de deck, titre = nom du dossier, retour vers
// Decks) : `+` → nouveau deck dans CE dossier, `⋯` → renommer/supprimer le
// dossier (avec confirmation, les decks remontent dans `Unsorted`), filtre de
// légalité (même puces que `folders-view.tsx`/`collection-decks-view.tsx`),
// états vides distincts (dossier vide vs filtre qui ne retient rien vs dossier
// disparu).
//
// Sert aussi le `See all` d'`Unsorted` (`folderId === null`, demande
// produit, 2026-09-06) : même liste, même `+` (le deck naît sans dossier),
// mais pas de `⋯` — un dossier virtuel ne se renomme ni ne se supprime.
import { Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DeckRow } from '@/components/decks/deck-row'
import { NewDeckSheet } from '@/components/decks/new-deck-sheet'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import type { DeckListResult, DeckSummary } from '@/app/(app)/decks/decks-data'
import { useCanEdit } from '@/lib/collections/access-context'
import type { FolderPage } from '@/app/(app)/decks/folders-data'
import { deleteFolderAction, renameFolderAction } from '@/app/(app)/decks/folder-actions'

type Tone = 'warn' | 'ok' | 'none'

const TONE_LABEL: Record<Tone, string> = {
  warn: 'Needs attention',
  ok: 'Legal',
  none: 'No format',
}

const TONES: Tone[] = ['warn', 'ok', 'none']

function toneOf(deck: DeckSummary): Tone | null {
  if (deck.status.kind === 'needsWork') return 'warn'
  if (deck.status.kind === 'noFormat') return 'none'
  // `noRules` : aucun panier de filtre — visible sous `All` seulement.
  if (deck.status.kind === 'noRules') return null
  return 'ok'
}

export function FolderDecksView({
  folderId,
  folder,
  initial,
}: {
  folderId: string | null
  folder: FolderPage | null
  initial: DeckListResult | null
}) {
  const unsorted = folderId === null
  const router = useRouter()
  // Lecture seule (`viewer`) : ni nouveau deck, ni menu du dossier.
  const canEdit = useCanEdit()
  const [filter, setFilter] = useState<Tone | 'all'>('all')
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(folder?.name ?? '')
  const [renamePending, setRenamePending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [newDeckOpen, setNewDeckOpen] = useState(false)

  const decks = useMemo(() => initial?.decks ?? [], [initial])
  const counts = useMemo(() => {
    const totals: Record<Tone, number> = { warn: 0, ok: 0, none: 0 }
    for (const deck of decks) {
      const tone = toneOf(deck)
      if (tone !== null) totals[tone] += 1
    }
    return totals
  }, [decks])
  const visible =
    filter === 'all' ? decks : decks.filter((deck) => toneOf(deck) === filter)

  function chipClassName(active: boolean): string {
    return `rounded-pill border px-12 py-7 text-chip font-bold ${
      active
        ? 'border-border-accent-subtle bg-accent-bg text-accent-text'
        : 'border-border bg-surface-1 text-text-2'
    }`
  }

  async function handleRename() {
    const trimmed = renameValue.trim()
    if (folderId === null || trimmed.length === 0) return
    setRenamePending(true)
    setRenameError(null)
    const result = await renameFolderAction({ folderId, name: trimmed })
    setRenamePending(false)
    if (!result.ok) {
      setRenameError('Could not rename this folder.')
      return
    }
    setRenameOpen(false)
    router.refresh()
  }

  async function handleDelete() {
    if (folderId === null) return
    setDeletePending(true)
    const result = await deleteFolderAction({ folderId })
    setDeletePending(false)
    if (!result.ok) return
    router.push('/decks')
  }

  return (
    <Screen
      header={
        <>
          <ScreenHeader
            title={folder?.name ?? 'Folder'}
            breadcrumb="Decks"
            onBack={() => router.push('/decks')}
            meta={
              decks.length > 0
                ? `${decks.length} deck${decks.length === 1 ? '' : 's'}`
                : undefined
            }
            onOverflow={
              folder && canEdit && !unsorted ? () => setOverflowOpen(true) : undefined
            }
            onAdd={folder && canEdit ? () => setNewDeckOpen(true) : undefined}
          />

          {decks.length > 0 && (
            <div className="mb-14 flex flex-wrap gap-6">
              <button
                type="button"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
                className={chipClassName(filter === 'all')}
              >
                All
              </button>
              {TONES.map((tone) =>
                counts[tone] === 0 ? null : (
                  <button
                    key={tone}
                    type="button"
                    aria-pressed={filter === tone}
                    onClick={() => setFilter(tone)}
                    className={chipClassName(filter === tone)}
                  >
                    {TONE_LABEL[tone]} · {counts[tone]}
                  </button>
                ),
              )}
            </div>
          )}
        </>
      }
    >
      {!folder ? (
        <p className="px-16 py-16 text-center text-body text-text-2">
          This folder no longer exists.
        </p>
      ) : decks.length === 0 ? (
        <p className="px-16 py-16 text-center text-body leading-normal text-text-2">
          Empty — start a deck here, or move one in from another deck&apos;s ⋯ menu.
        </p>
      ) : visible.length === 0 ? (
        <p className="px-16 py-16 text-center text-body text-text-2">
          No deck matches this filter.
        </p>
      ) : (
        <div className="flex flex-col gap-11">
          {visible.map((deck) => (
            <DeckRow key={deck.id} deck={deck} currency={initial?.currency ?? 'usd'} />
          ))}
        </div>
      )}

      {folder && (
        <NewDeckSheet
          open={newDeckOpen}
          onOpenChange={setNewDeckOpen}
          folderId={folderId}
        />
      )}

      {folder && !unsorted && (
        <>
          <Sheet open={overflowOpen} onOpenChange={setOverflowOpen} title={folder.name}>
            <SheetGroup>
              <SheetRow
                icon={Pencil}
                label="Rename folder"
                onClick={() => {
                  setOverflowOpen(false)
                  setRenameValue(folder.name)
                  setRenameOpen(true)
                }}
              />
              <SheetRow
                icon={Trash2}
                label="Delete folder"
                hint="The decks stay — they move back to the top of the tab"
                onClick={() => {
                  setOverflowOpen(false)
                  setDeleteOpen(true)
                }}
              />
            </SheetGroup>
          </Sheet>

          <Sheet
            open={renameOpen}
            onOpenChange={setRenameOpen}
            title="Rename folder"
            closeLabel="Close rename folder sheet"
          >
            {/* Formulaire : la touche Entrée du clavier enregistre. */}
            <form
              className="flex flex-col gap-14"
              onSubmit={(event) => {
                event.preventDefault()
                if (renamePending || renameValue.trim().length === 0) return
                void handleRename()
              }}
            >
              <input
                type="text"
                autoFocus
                enterKeyHint="done"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-label="Folder name"
                className="w-full rounded-control border border-border bg-surface-1 px-14 py-11 text-body text-text outline-none"
              />
              {renameError && <p className="text-meta text-danger">{renameError}</p>}
              <button
                type="submit"
                disabled={renamePending || renameValue.trim().length === 0}
                className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
              >
                {renamePending ? 'Saving...' : 'Save'}
              </button>
            </form>
          </Sheet>

          <ConfirmDialog
            open={deleteOpen}
            title={`Delete ${folder.name}?`}
            message="The folder goes, the decks stay: they move back to the top of the Decks tab."
            confirmLabel="Delete"
            pending={deletePending}
            onConfirm={() => void handleDelete()}
            onClose={() => setDeleteOpen(false)}
          />
        </>
      )}
    </Screen>
  )
}
