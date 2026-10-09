'use client'

// Vue étagères de l'onglet `Decks` (les étagères de dossiers). Îlot client
// scindé de `page.tsx` (composant serveur) — même patron que `ShelvesView`
// et `DecksView` : reçoit ses données déjà chargées en props, aucun refetch
// au montage.
//
// Les deux types publics (`FolderShelf`, `DeckCardData`) sont définis dans
// `folders-data.ts`, avec `getFolderShelves` — voir le commentaire de tête
// de ce fichier — et réexportés ici, à côté de la vue qui les consomme.
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Copy,
  FolderInput,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DeckCard } from '@/components/decks/deck-card'
import { EditDeckSheet } from '@/components/decks/edit-deck-sheet'
import { FolderShelf as FolderShelfRow } from '@/components/decks/folder-shelf'
import { ImportDeckSheet } from '@/components/decks/import-deck-sheet'
import { NewDeckSheet } from '@/components/decks/new-deck-sheet'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { Sheet } from '@/components/ui/sheet'
import { useCanEdit } from '@/lib/collections/access-context'
import type { DeckStatus } from '@/lib/decks/legality'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'

import {
  createFolderAction,
  deleteFolderAction,
  moveDeckToFolderAction,
  renameFolderAction,
  reorderFoldersAction,
} from './folder-actions'
import { deleteDeckAction, duplicateDeckAction } from './actions'
import { UNSORTED_FOLDER_SLUG } from '@/lib/decks/unsorted-folder'
import type { DeckCardData, FolderShelf, FolderShelvesResult } from './folders-data'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'

export type { DeckCardData, FolderShelf } from './folders-data'

// Clé d'étagère côté client : `folderId` d'un dossier, ou cette sentinelle
// pour `Unsorted`, dont le `folderId` est `null`. Jamais persistée — la base
// ne connaît que `null`.
const UNSORTED_KEY = UNSORTED_FOLDER_SLUG

// Appui long → menu contextuel, exactement le seuil de la liste de cartes
// (`components/cards/virtual-list.tsx`) : 500ms, annulé par un déplacement.
const LONG_PRESS_MS = 500
// Au-delà, le doigt défile (piste ou page) : l'appui long est annulé.
// Aucun glisser-déposer sur cet écran : un glissement sur une tuile reste un
// défilement. Déplacer un deck passe par `Move to`, réordonner les dossiers
// par `Move up`/`Move down` (menus d'appui long).
const MOVE_CANCEL_PX = 10

function shelfKey(shelf: FolderShelf): string {
  return shelf.folderId ?? UNSORTED_KEY
}

function keyToFolderId(key: string): string | null {
  return key === UNSORTED_KEY ? null : key
}

// Feuille à champ de nom unique (création de dossier, et le même gabarit
// pour les deux renommages) — le gabarit de champ et de bouton déjà livré
// ailleurs dans l'app, aucun langage visuel neuf.
function NameSheet({
  open,
  onOpenChange,
  title,
  label,
  initialName,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  initialName: string
  submitLabel: string
  onSubmit: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setName(initialName)
          setError(null)
          setBusy(false)
        }
      }}
      title={title}
    >
      <form
        className="flex flex-col gap-14"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          const ok = await onSubmit(name.trim())
          if (!ok) {
            setError('Could not save that name. Try a different one.')
            setBusy(false)
            return
          }
          setBusy(false)
          onOpenChange(false)
        }}
      >
        <div>
          {/* Label visible au-dessus du champ. */}
          <div className="mb-8 text-body font-semibold text-text-2">{label}</div>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={label}
            className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
          />
        </div>
        {error && <p className="text-meta text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="w-full rounded-control bg-accent px-16 py-11 text-body font-bold text-on-accent disabled:opacity-60"
        >
          {busy ? 'Saving...' : submitLabel}
        </button>
      </form>
    </Sheet>
  )
}

// Les trois seuils de légalité, partagés avec `Collection › Decks`
// (`app/(app)/collection/decks/collection-decks-view.tsx`) : les deux zones
// de decks lisent le même statut, il n'y a qu'une façon de le nommer.
type Tone = 'warn' | 'ok' | 'none'

const TONE_LABEL: Record<Tone, string> = {
  warn: 'Needs attention',
  ok: 'Legal',
  none: 'No format',
}

const TONES: Tone[] = ['warn', 'ok', 'none']

function toneOf(status: DeckStatus): Tone | null {
  if (status.kind === 'needsWork') return 'warn'
  if (status.kind === 'noFormat') return 'none'
  // `noRules` : aucun contrôle ne s'applique — le deck n'appartient à
  // aucun panier de filtre, il ne se voit que sous `All`.
  if (status.kind === 'noRules') return null
  return 'ok'
}

export function FoldersView({ initial }: { initial: FolderShelvesResult }) {
  const router = useRouter()
  // Lecture seule (`viewer`) : ni création, ni menu, ni appui long — les
  // decks restent ouvrables au tap.
  const canEdit = useCanEdit()
  const [shelves, setShelves] = useState<FolderShelf[]>(initial.shelves)

  const [menuDeck, setMenuDeck] = useState<{
    deck: DeckCardData
    fromKey: string
  } | null>(null)
  const [menuFolder, setMenuFolder] = useState<FolderShelf | null>(null)
  const [moveDeckTarget, setMoveDeckTarget] = useState<{
    deck: DeckCardData
    fromKey: string
  } | null>(null)

  const [overflowOpen, setOverflowOpen] = useState(false)
  const [toneFilter, setToneFilter] = useState<Tone | 'all'>('all')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameFolder, setRenameFolder] = useState<FolderShelf | null>(null)
  const [newDeckFolderKey, setNewDeckFolderKey] = useState<string | null>(null)
  // Feuille `Edit deck` : « Edit » sur la tuile ouvre nom ET format, pas un
  // simple renommage à champ unique.
  const [editingDeck, setEditingDeck] = useState<{
    deck: DeckCardData
    fromKey: string
  } | null>(null)
  // « Delete » du menu de tuile, pas `Dismantle` : une tuile ne démonte
  // jamais un deck monté (elle n'en montre pas), elle ne fait que le
  // supprimer.
  const [deletingDeck, setDeletingDeck] = useState<{
    deck: DeckCardData
    fromKey: string
  } | null>(null)
  const [deletingDeckBusy, setDeletingDeckBusy] = useState(false)
  // Confirmation avant suppression de dossier — jamais de suppression
  // immédiate au premier tap du menu.
  const [deletingFolder, setDeletingFolder] = useState<FolderShelf | null>(null)
  const [deletingFolderBusy, setDeletingFolderBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Un seul état d'appui long par pointeur, hors du cycle de rendu.
  const pressRef = useRef<{
    x: number
    y: number
    timer: ReturnType<typeof setTimeout> | null
    fired: boolean
  } | null>(null)

  const clearPress = useCallback(() => {
    const press = pressRef.current
    if (press?.timer) clearTimeout(press.timer)
    if (press) press.timer = null
  }, [])

  // Miroir synchrone de `shelves` pour les mises à jour optimistes : la
  // restauration en cas d'échec repart de l'état réel, pas de celui figé à la
  // création du rappel.
  const shelvesRef = useRef(shelves)
  shelvesRef.current = shelves

  // Déplacement d'un deck d'une étagère à l'autre — optimiste (docs/development.md :
  // « mises à jour optimistes... avec retour arrière en cas d'échec ») : la
  // carte apparaît dans la nouvelle étagère sans rechargement, et l'état est
  // restauré tel quel si le serveur refuse.
  const moveDeck = useCallback(async (deckId: string, fromKey: string, toKey: string) => {
    if (fromKey === toKey) return

    const snapshot = shelvesRef.current
    const source = snapshot.find((shelf) => shelfKey(shelf) === fromKey)
    const moved = source?.decks.find((deck) => deck.id === deckId)
    // Seules les 10 premières cartes d'une étagère sont chargées : un deck
    // hors de cette tranche n'a pas de tuile, donc pas de menu `Move to`.
    if (!moved) return

    setShelves(
      snapshot.map((shelf) => {
        const key = shelfKey(shelf)
        if (key === fromKey) {
          return {
            ...shelf,
            decks: shelf.decks.filter((deck) => deck.id !== deckId),
            deckCount: shelf.deckCount - 1,
          }
        }
        if (key === toKey) {
          return {
            ...shelf,
            decks: [...shelf.decks, moved],
            deckCount: shelf.deckCount + 1,
          }
        }
        return shelf
      }),
    )

    const result = await moveDeckToFolderAction({
      deckId,
      folderId: keyToFolderId(toKey),
    })
    if (!result.ok) setShelves(snapshot)
  }, [])

  function startPress(event: React.PointerEvent<HTMLElement>, open: () => void) {
    pressRef.current = { x: event.clientX, y: event.clientY, timer: null, fired: false }
    const press = pressRef.current
    press.timer = setTimeout(() => {
      press.fired = true
      open()
    }, LONG_PRESS_MS)
  }

  function cancelPressOnMove(event: React.PointerEvent<HTMLElement>) {
    const press = pressRef.current
    if (!press) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_CANCEL_PX) clearPress()
  }

  // Chrome Android déclenche `contextmenu` vers 400ms, avant `LONG_PRESS_MS` :
  // sans ce gestionnaire, son menu de lien (nouvel onglet, télécharger
  // l'image) recouvre la tuile et le `pointercancel` qui suit annule le
  // nôtre. On ouvre donc le menu de l'app tout de suite — clic droit desktop
  // compris.
  function openOnContextMenu(event: React.MouseEvent<HTMLElement>, open: () => void) {
    event.preventDefault()
    const press = pressRef.current
    if (press) {
      if (press.fired) return
      press.fired = true
    }
    clearPress()
    open()
  }

  // Un appui long ne doit jamais ouvrir l'écran du deck (ou la liste du
  // dossier, `See all` vivant dans l'en-tête) en plus de son menu — même
  // garde que la liste de cartes.
  function swallowClickAfterPress(event: React.MouseEvent<HTMLElement>) {
    if (pressRef.current?.fired) {
      event.preventDefault()
      event.stopPropagation()
      pressRef.current = null
    }
  }

  function deckGesture(deck: DeckCardData, fromKey: string) {
    const open = () => setMenuDeck({ deck, fromKey })
    return {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (canEdit) startPress(event, open)
      },
      onPointerMove: cancelPressOnMove,
      onPointerUp: clearPress,
      onPointerCancel: clearPress,
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
        if (canEdit) openOnContextMenu(event, open)
        else event.preventDefault()
      },
      onClickCapture: swallowClickAfterPress,
    }
  }

  function headerProps(shelf: FolderShelf) {
    // `Unsorted` n'a pas de menu de dossier.
    const editable = canEdit && shelf.folderId !== null
    const open = () => setMenuFolder(shelf)
    return {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (editable) startPress(event, open)
      },
      onPointerMove: cancelPressOnMove,
      onPointerUp: clearPress,
      onPointerCancel: clearPress,
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
        if (editable) openOnContextMenu(event, open)
        else event.preventDefault()
      },
      onClickCapture: swallowClickAfterPress,
    }
  }

  // Menu contextuel de tuile : Edit (Pencil) · Move to (FolderInput) ·
  // Duplicate (Copy) · Delete (Trash2, rouge) — dans cet ordre, réel de bout
  // en bout.
  const folderShelves = shelves.filter((shelf) => shelf.folderId !== null)
  function folderIndex(folderId: string | null): number {
    if (folderId === null) return -1
    return folderShelves.findIndex((shelf) => shelf.folderId === folderId)
  }

  const deckMenuItems: ContextMenuItem[] = menuDeck
    ? [
        {
          key: 'edit',
          label: 'Edit',
          icon: <Pencil width={17} height={17} strokeWidth={1.75} />,
          onSelect: () => setEditingDeck(menuDeck),
        },
        {
          key: 'move',
          label: 'Move to',
          icon: <FolderInput width={17} height={17} strokeWidth={1.75} />,
          onSelect: () => setMoveDeckTarget(menuDeck),
        },
        {
          key: 'duplicate',
          label: 'Duplicate',
          icon: <Copy width={17} height={17} strokeWidth={1.75} />,
          onSelect: () => void handleDuplicateDeck(menuDeck),
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: (
            <Trash2 width={17} height={17} strokeWidth={1.75} className="text-danger" />
          ),
          onSelect: () => setDeletingDeck(menuDeck),
        },
      ]
    : []

  const folderMenuItems: ContextMenuItem[] = menuFolder
    ? [
        {
          key: 'rename',
          label: 'Rename',
          icon: <Pencil width={17} height={17} strokeWidth={1.75} />,
          onSelect: () => setRenameFolder(menuFolder),
        },
        // Réordonnancement des dossiers, en bout de liste désactivé plutôt
        // qu'absent. `Unsorted` reste toujours en dernier.
        {
          key: 'move-up',
          label: 'Move up',
          icon: <ArrowUp width={17} height={17} strokeWidth={1.75} />,
          disabled: folderIndex(menuFolder.folderId) <= 0,
          onSelect: () => void moveFolder(menuFolder, -1),
        },
        {
          key: 'move-down',
          label: 'Move down',
          icon: <ArrowDown width={17} height={17} strokeWidth={1.75} />,
          disabled:
            folderIndex(menuFolder.folderId) === -1 ||
            folderIndex(menuFolder.folderId) >= folderShelves.length - 1,
          onSelect: () => void moveFolder(menuFolder, 1),
        },
        {
          key: 'delete',
          label: 'Delete folder',
          icon: (
            <Trash2 width={17} height={17} strokeWidth={1.75} className="text-danger" />
          ),
          // Confirmation avant suppression — jamais immédiate au premier tap.
          onSelect: () => setDeletingFolder(menuFolder),
        },
      ]
    : []

  // `position` est réécrite pour tous les dossiers de la collection —
  // l'action reçoit l'ordre complet, jamais un seul index.
  async function moveFolder(shelf: FolderShelf, delta: 1 | -1) {
    const from = folderIndex(shelf.folderId)
    const to = from + delta
    if (from === -1 || to < 0 || to >= folderShelves.length) return
    const reordered = [...folderShelves]
    const [pulled] = reordered.splice(from, 1)
    if (!pulled) return
    reordered.splice(to, 0, pulled)
    const unsorted = shelves.filter((s) => s.folderId === null)
    const snapshot = shelvesRef.current
    setShelves([...reordered, ...unsorted])
    const result = await reorderFoldersAction({
      folderIds: reordered.map((s) => s.folderId as string),
    })
    if (!result.ok) setShelves(snapshot)
  }

  // Supprimer un dossier laisse ses decks intacts : ils retombent dans
  // `Unsorted`, ici comme en base (`ON DELETE SET NULL`).
  async function handleDeleteFolder(shelf: FolderShelf) {
    if (!shelf.folderId) return
    setDeletingFolderBusy(true)
    const snapshot = shelvesRef.current
    setShelves((prev) => {
      const removed = prev.find((s) => s.folderId === shelf.folderId)
      if (!removed) return prev
      return prev
        .filter((s) => s.folderId !== shelf.folderId)
        .map((s) =>
          s.folderId === null
            ? {
                ...s,
                decks: [...s.decks, ...removed.decks],
                deckCount: s.deckCount + removed.deckCount,
              }
            : s,
        )
    })
    const result = await deleteFolderAction({ folderId: shelf.folderId })
    setDeletingFolderBusy(false)
    if (!result.ok) {
      setShelves(snapshot)
      return
    }
    setDeletingFolder(null)
  }

  // « Duplicate » : copie réelle (container + holdings, toujours en plan),
  // puis navigation vers la copie.
  async function handleDuplicateDeck(target: { deck: DeckCardData; fromKey: string }) {
    const result = await duplicateDeckAction({ deckId: target.deck.id })
    if (result.ok) router.push(`/decks/${result.deckId}`)
  }

  // « Delete » : suppression réelle, retirée
  // localement de l'étagère d'où elle vient — pas de retour arrière possible
  // (irréversible, ConfirmDialog l'annonce), donc rien à restaurer en cas
  // d'échec au-delà de rouvrir la confirmation.
  async function handleDeleteDeck() {
    if (!deletingDeck) return
    setDeletingDeckBusy(true)
    const result = await deleteDeckAction({ deckId: deletingDeck.deck.id })
    setDeletingDeckBusy(false)
    if (!result.ok) return
    setShelves((prev) =>
      prev.map((shelf) =>
        shelfKey(shelf) === deletingDeck.fromKey
          ? {
              ...shelf,
              deckCount: Math.max(0, shelf.deckCount - 1),
              decks: shelf.decks.filter((deck) => deck.id !== deletingDeck.deck.id),
            }
          : shelf,
      ),
    )
    setDeletingDeck(null)
  }

  // Comptes de légalité sur l'atelier entier, pas sur l'étagère : c'est la
  // liste complète que la puce filtre.
  const toneCounts = shelves.reduce(
    (totals, shelf) => {
      for (const deck of shelf.decks) {
        const tone = toneOf(deck.status)
        if (tone !== null) totals[tone] += 1
        totals.total += 1
      }
      return totals
    },
    { warn: 0, ok: 0, none: 0, total: 0 },
  )

  // Les étagères gardent leur place et leur en-tête quand un filtre est
  // actif — seules leurs cartes se réduisent, sinon un dossier disparaîtrait
  // sous le filtre.
  const visibleShelves =
    toneFilter === 'all'
      ? shelves
      : shelves.map((shelf) => ({
          ...shelf,
          decks: shelf.decks.filter((deck) => toneOf(deck.status) === toneFilter),
        }))

  function chipClassName(active: boolean): string {
    return `rounded-pill border px-12 py-7 text-chip font-bold ${
      active
        ? 'border-border-accent-subtle bg-accent-bg text-accent-text'
        : 'border-border bg-surface-1 text-text-2'
    }`
  }

  return (
    <Screen
      header={
        <>
          {/* Un seul bouton primaire (`+`, un nouveau deck) et un menu :
            `New folder` vit dans le menu, qui l'offre déjà — deux ronds côte à
            côte donnaient le même poids à l'action rare qu'à l'action
            courante. */}
          <ScreenHeader
            title="Decks"
            onOverflow={canEdit ? () => setOverflowOpen(true) : undefined}
            onAdd={canEdit ? () => setNewDeckFolderKey(UNSORTED_KEY) : undefined}
          />

          {/* Filtre de légalité, le même que celui de `Collection › Decks` :
            « quel deck a discrètement perdu des cartes » est la question que
            les deux zones savent répondre, et une puce qui viderait la liste
            n'est pas proposée. La rangée reste visible même à vide et `All`
            ne porte pas de compteur (un « All · 0 » qui apparaît puis
            disparaît avec le premier deck créé n'apprend rien). */}
          <div className="mb-14 flex flex-wrap gap-6">
            <button
              type="button"
              aria-pressed={toneFilter === 'all'}
              onClick={() => setToneFilter('all')}
              className={chipClassName(toneFilter === 'all')}
            >
              All
            </button>
            {TONES.map((tone) =>
              toneCounts[tone] === 0 ? null : (
                <button
                  key={tone}
                  type="button"
                  aria-pressed={toneFilter === tone}
                  onClick={() => setToneFilter(tone)}
                  className={chipClassName(toneFilter === tone)}
                >
                  {TONE_LABEL[tone]} · {toneCounts[tone]}
                </button>
              ),
            )}
          </div>
        </>
      }
      headerClassName="px-16 pt-screen-top desktop:px-20 desktop:pt-30"
      bodyClassName="min-w-0"
    >
      {visibleShelves.map((shelf, index) => {
        const key = shelfKey(shelf)
        return (
          <FolderShelfRow
            key={key}
            name={shelf.name}
            deckCount={shelf.deckCount}
            // `Unsorted` déplie son dossier virtuel (`/decks/folders/unsorted`,
            // demande produit, 2026-09-06) ; une étagère vide n'a pas de
            // `See all`.
            seeAllHref={
              shelf.deckCount > 0
                ? `/decks/folders/${shelf.folderId ?? UNSORTED_FOLDER_SLUG}`
                : null
            }
            unsorted={shelf.folderId === null}
            headerProps={headerProps(shelf)}
            onNewDeck={() => setNewDeckFolderKey(key)}
          >
            {shelf.decks.map((deck) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                currency={initial.currency}
                // Seule la première étagère est dans le premier écran
                // visible — même règle que `ShelvesView`.
                lazy={index > 0}
                gesture={deckGesture(deck, key)}
              />
            ))}
          </FolderShelfRow>
        )
      })}

      {/* Un filtre qui vide toutes les étagères le dit — plutôt qu'un tab
          qui semble juste vide de contenu. */}
      {toneFilter !== 'all' &&
        toneCounts.total > 0 &&
        visibleShelves.every((shelf) => shelf.decks.length === 0) && (
          <p className="px-16 text-body text-text-2">No deck matches this filter.</p>
        )}

      {/* Menu de l'onglet : ce que le `+` ne fait pas. `New folder` y vit
          depuis que l'en-tête n'a plus qu'un bouton primaire, et « Import a
          deck ». */}
      <Sheet open={overflowOpen} onOpenChange={setOverflowOpen} title="Decks">
        <SheetGroup>
          <SheetRow
            icon={FolderPlus}
            label="New folder"
            hint="One level — no folder inside a folder"
            onClick={() => {
              setOverflowOpen(false)
              setNewFolderOpen(true)
            }}
          />
          <SheetRow
            icon={ClipboardList}
            label="Import a deck"
            hint="Paste a Scryfall, Moxfield, Archidekt or Arena list"
            onClick={() => {
              setOverflowOpen(false)
              setImportOpen(true)
            }}
          />
        </SheetGroup>
      </Sheet>

      <ContextMenu
        open={menuDeck !== null}
        onOpenChange={(open) => {
          if (!open) setMenuDeck(null)
        }}
        title={menuDeck?.deck.name ?? ''}
        items={deckMenuItems}
      />

      <ContextMenu
        open={menuFolder !== null}
        onOpenChange={(open) => {
          if (!open) setMenuFolder(null)
        }}
        title={menuFolder?.name ?? ''}
        items={folderMenuItems}
      />

      {/* `Move to folder…` du menu d'appui long, sur `moveDeck`. */}
      <Sheet
        open={moveDeckTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMoveDeckTarget(null)
        }}
        title="Move to folder"
      >
        <div className="flex flex-col gap-8">
          {shelves.map((shelf) => {
            const key = shelfKey(shelf)
            return (
              <button
                key={key}
                type="button"
                disabled={moveDeckTarget?.fromKey === key}
                onClick={() => {
                  if (moveDeckTarget)
                    void moveDeck(moveDeckTarget.deck.id, moveDeckTarget.fromKey, key)
                  setMoveDeckTarget(null)
                }}
                className="flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text disabled:opacity-60"
              >
                {shelf.name}
              </button>
            )
          })}
        </div>
      </Sheet>

      <NameSheet
        key={`new-folder-${newFolderOpen}`}
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="New folder"
        label="Folder name"
        initialName=""
        submitLabel="Create"
        onSubmit={async (name) => {
          const result = await createFolderAction({ name })
          if (!result.ok) return false
          // Le dossier créé est vide : son étagère ne porte que la tuile
          // `New deck`. Inséré avant `Unsorted`, qui reste toujours en dernier.
          setShelves((prev) => {
            const created: FolderShelf = {
              folderId: result.folderId,
              name,
              deckCount: 0,
              decks: [],
            }
            const folders = prev.filter((shelf) => shelf.folderId !== null)
            const unsorted = prev.filter((shelf) => shelf.folderId === null)
            return [...folders, created, ...unsorted]
          })
          return true
        }}
      />

      <NameSheet
        key={`rename-folder-${renameFolder?.folderId ?? 'none'}`}
        open={renameFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenameFolder(null)
        }}
        title="Rename folder"
        label="Folder name"
        initialName={renameFolder?.name ?? ''}
        submitLabel="Save"
        onSubmit={async (name) => {
          if (!renameFolder?.folderId) return false
          const result = await renameFolderAction({
            folderId: renameFolder.folderId,
            name,
          })
          if (!result.ok) return false
          setShelves((prev) =>
            prev.map((shelf) =>
              shelf.folderId === renameFolder.folderId ? { ...shelf, name } : shelf,
            ),
          )
          return true
        }}
      />

      {/* « Edit » : nom ET format, un champ libre — pas un simple renommage
          à champ unique. */}
      <EditDeckSheet
        key={`edit-deck-${editingDeck?.deck.id ?? 'none'}`}
        open={editingDeck !== null}
        onOpenChange={(open) => {
          if (!open) setEditingDeck(null)
        }}
        deckId={editingDeck?.deck.id ?? ''}
        name={editingDeck?.deck.name ?? ''}
        format={editingDeck?.deck.formatRaw ?? null}
        onSaved={({ name }) => {
          if (!editingDeck) return
          setShelves((prev) =>
            prev.map((shelf) => ({
              ...shelf,
              decks: shelf.decks.map((deck) =>
                deck.id === editingDeck.deck.id ? { ...deck, name } : deck,
              ),
            })),
          )
        }}
      />

      {/* « Delete » du menu de tuile : irréversible, donc confirmée. */}
      <ConfirmDialog
        open={deletingDeck !== null}
        title={`Delete ${deletingDeck?.deck.name ?? 'this deck'}?`}
        message="The deck and its list are removed. This cannot be undone."
        confirmLabel="Delete"
        pending={deletingDeckBusy}
        onConfirm={() => void handleDeleteDeck()}
        onClose={() => setDeletingDeck(null)}
      />

      {/* Confirmation avant suppression de dossier — les decks restent, ils
          remontent dans `Unsorted`. */}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`Delete ${deletingFolder?.name ?? 'this folder'}?`}
        message="The folder goes, the decks stay: they move back to the top of the Decks tab."
        confirmLabel="Delete"
        pending={deletingFolderBusy}
        onConfirm={() => {
          if (deletingFolder) void handleDeleteFolder(deletingFolder)
        }}
        onClose={() => setDeletingFolder(null)}
      />

      <NewDeckSheet
        key={`new-deck-${newDeckFolderKey ?? 'none'}`}
        open={newDeckFolderKey !== null}
        onOpenChange={(open) => {
          if (!open) setNewDeckFolderKey(null)
        }}
        folderId={newDeckFolderKey ? keyToFolderId(newDeckFolderKey) : null}
      />

      <ImportDeckSheet
        key={`import-deck-${importOpen}`}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(deckId) => router.push(`/decks/${deckId}`)}
      />
    </Screen>
  )
}
