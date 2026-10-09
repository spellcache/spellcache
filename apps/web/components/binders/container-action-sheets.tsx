'use client'

// Feuilles d'action d'un container : `Binder look` / `List look`, le
// menu `···` et ses entrées `Rename` / `Share` / `Export list` /
// `Delete binder` / `Delete list`.
//
// Un seul jeu de feuilles pour les binders **et** les listes : les deux sont
// des `containers` que seul `kind` sépare (docs/development.md, « `containers` +
// `holdings` comme modèle unique »), et `renameContainerAction` comme
// `saveBinderLookAction` sont déjà agnostiques du `kind`. Ne divergent que
// la copie, la suppression (voir `handleDelete`) et le partage, réservé aux
// `SHAREABLE_KINDS` — `deck` et `binder`.
//
// Extrait de `binder-header.tsx` avec le layout desktop. L'en-tête illustré du binder
// est masqué au-delà de 768px, où `MainHeader` prend le relais : si ces
// feuilles vivaient **dans** cet en-tête, un binder perdrait sur desktop son
// apparence, son renommage, sa suppression, son partage public et son
// export — cinq comportements livrés, devenus inatteignables à une largeur
// donnée. Elles sont donc montées une
// seule fois par l'écran de container, qui ouvre le même état depuis l'un ou
// l'autre en-tête : **un seul jeu de composants**, jamais une seconde
// implémentation desktop.
import { Palette, Pencil, Share2, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { LookSheet } from '@/components/binders/look-sheet'
import { ListExportSheet } from '@/components/lists/export-sheet'
import { ShareSheet } from '@/components/sharing/share-sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton, SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import { useCanEdit } from '@/lib/collections/access-context'
import type { GradientKey } from '@/lib/binders/gradients'
import { queryKeys } from '@/lib/query/keys'

import {
  deleteBinderAction,
  deleteListAction,
  renameContainerAction,
  type BinderLook,
} from '@/app/(app)/container/[id]/binder-actions'

export function lookFromHeader(props: {
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverIntensity: number
}): BinderLook {
  if (props.coverCardId)
    return { mode: 'art', cardId: props.coverCardId, intensity: props.coverIntensity }
  if (props.coverGradient)
    return {
      mode: 'colour',
      gradient: props.coverGradient,
      intensity: props.coverIntensity,
    }
  return { mode: 'none' }
}

export function ContainerActionSheets({
  containerId,
  kind,
  name,
  look,
  menuOpen,
  onMenuOpenChange,
  lookOpen,
  onLookOpenChange,
}: {
  containerId: string
  // Seule variable de ce composant : la copie, la suppression et la présence
  // du partage en découlent. Aucun autre `kind` n'ouvre ces feuilles — un
  // deck a les siennes, le container racine n'a pas de menu.
  kind: 'binder' | 'list'
  name: string
  look: BinderLook
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  lookOpen: boolean
  onLookOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const headerKey = queryKeys.containerHeader(containerId)

  // `binder` / `list` en minuscules dans les phrases, `Binder` / `List` en
  // tête de titre — la copie de l'interface reste en anglais (docs/development.md).
  const noun = kind === 'binder' ? 'binder' : 'list'
  const Noun = kind === 'binder' ? 'Binder' : 'List'
  // Seuls `deck` et `binder` sont partageables (`SHAREABLE_KINDS`,
  // lib/containers/containers.ts) : proposer `Share` ou `Export list` sur
  // une liste ouvrirait une feuille que le serveur refuse.
  const shareable = kind === 'binder'
  const canEdit = useCanEdit()

  const [renameSheetOpen, setRenameSheetOpen] = useState(false)
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  // Partage public et export texte, ouverts depuis le même menu `···`
  // que `Rename`/`Delete binder`.
  const [shareSheetOpen, setShareSheetOpen] = useState(false)
  const [exportSheetOpen, setExportSheetOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function refreshHeader() {
    void queryClient.invalidateQueries({ queryKey: headerKey })
  }

  async function handleRename() {
    const trimmed = renameValue.trim()
    if (trimmed.length === 0) {
      setRenameError('Name cannot be empty.')
      return
    }
    setRenaming(true)
    setRenameError(null)
    const result = await renameContainerAction({ containerId, name: trimmed })
    setRenaming(false)
    if (!result.ok) {
      setRenameError(`Could not rename this ${noun}. Try again.`)
      return
    }
    refreshHeader()
    setRenameSheetOpen(false)
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    // Deux actions, pas une : supprimer un binder reverse ses cartes dans
    // `All collection`, supprimer une liste ne touche pas à la collection
    // (les cartes d'une liste n'en font pas partie). Voir
    // `deleteListAction` (binder-actions.ts).
    const result =
      kind === 'binder'
        ? await deleteBinderAction({ containerId })
        : await deleteListAction({ containerId })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(`Could not delete this ${noun}. Try again.`)
      return
    }
    setDeleteSheetOpen(false)
    router.replace('/collection')
  }

  return (
    <>
      <LookSheet
        open={lookOpen}
        onOpenChange={onLookOpenChange}
        containerId={containerId}
        initialLook={look}
        target={kind}
        onSaved={refreshHeader}
      />

      <Sheet open={menuOpen} onOpenChange={onMenuOpenChange} title={name}>
        {/* Une carte groupée, pas une pile de boutons encadrés : le menu
            d'un écran est une liste d'actions, et chaque ligne dit sa
            conséquence sous son libellé plutôt que de la garder pour une
            feuille de confirmation. `Rename` d'abord — l'action sans
            conséquence — puis l'apparence, puis ce qui sort du container,
            puis la suppression. */}
        {/* Guest (lecture seule) : le menu se réduit à « Export list »,
            seule action qui n'écrit rien. */}
        {!canEdit ? (
          <SheetGroup>
            {shareable && (
              <SheetRow
                icon={Upload}
                label="Export list"
                hint="Copy this list as text"
                onClick={() => {
                  onMenuOpenChange(false)
                  setExportSheetOpen(true)
                }}
              />
            )}
          </SheetGroup>
        ) : (
          <SheetGroup>
            <SheetRow
              icon={Pencil}
              label="Rename"
              onClick={() => {
                setRenameValue(name)
                onMenuOpenChange(false)
                setRenameSheetOpen(true)
              }}
            />
            <SheetRow
              icon={Palette}
              label={`${Noun} look`}
              hint={`A colour or a card from this ${noun}`}
              onClick={() => {
                onMenuOpenChange(false)
                onLookOpenChange(true)
              }}
            />
            {shareable && (
              <>
                <SheetRow
                  icon={Share2}
                  label="Share"
                  hint="Anyone with the link can read it"
                  onClick={() => {
                    onMenuOpenChange(false)
                    setShareSheetOpen(true)
                  }}
                />
                <SheetRow
                  icon={Upload}
                  label="Export list"
                  hint="Copy this list as text"
                  onClick={() => {
                    onMenuOpenChange(false)
                    setExportSheetOpen(true)
                  }}
                />
              </>
            )}
            <SheetRow
              icon={Trash2}
              label={`Delete ${noun}`}
              hint={
                // Un binder supprimé libère ses cartes dans la collection
                // plutôt que de les emporter avec lui.
                kind === 'binder'
                  ? 'The cards stay in your collection'
                  : 'Your collection is not affected'
              }
              onClick={() => {
                onMenuOpenChange(false)
                setDeleteSheetOpen(true)
              }}
            />
          </SheetGroup>
        )}
      </Sheet>

      {shareable && (
        <>
          <ShareSheet
            open={shareSheetOpen}
            onOpenChange={setShareSheetOpen}
            containerId={containerId}
            kindLabel="binder"
          />

          <ListExportSheet
            open={exportSheetOpen}
            onOpenChange={setExportSheetOpen}
            containerId={containerId}
            containerName={name}
          />
        </>
      )}

      <Sheet
        open={renameSheetOpen}
        onOpenChange={setRenameSheetOpen}
        title={`Rename ${noun}`}
      >
        {/* Formulaire : la touche Entrée du clavier enregistre. */}
        <form
          className="flex flex-col gap-14"
          onSubmit={(event) => {
            event.preventDefault()
            void handleRename()
          }}
        >
          <input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
            enterKeyHint="done"
            aria-label={`${Noun} name`}
            className="w-full rounded-control border border-border bg-surface-2 px-14 py-10 text-body text-text outline-none"
          />
          {renameError && <p className="text-meta text-danger">{renameError}</p>}
          <PrimaryButton type="submit" disabled={renaming}>
            {renaming ? 'Saving...' : 'Save'}
          </PrimaryButton>
        </form>
      </Sheet>

      {/* `ConfirmDialog` partagée plutôt qu'une feuille propre à ce menu : un
          binder garde son nom dans le titre (« Delete {name}? »), une liste
          reste générique (« Delete list? », le nom se lit dans le message). */}
      <ConfirmDialog
        open={deleteSheetOpen}
        title={kind === 'binder' ? `Delete ${name}?` : 'Delete list?'}
        message={
          kind === 'binder'
            ? 'The binder is removed. Its cards stay in your collection, loose.'
            : `Delete "${name}" and everything in it. Your collection is not affected. This cannot be undone.`
        }
        confirmLabel="Delete"
        pending={deleting}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteSheetOpen(false)}
      />
      {deleteError && (
        <div
          role="alert"
          className="fixed inset-x-16 bottom-toast-offset z-30 flex items-center gap-10 rounded-toast border border-border-device bg-surface-3 px-14 py-12 shadow-toast text-body text-danger"
        >
          <span className="min-w-0 flex-1">{deleteError}</span>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="flex-shrink-0 text-body font-bold text-text-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
