'use client'

// Écran `Collection home · style = Shelves`, en composant client scindé de
// `page.tsx` — même patron que `CollectionView`. Reçoit `CollectionShelves`
// déjà chargé côté serveur en props, aucun refetch au montage (même
// contrainte que `CollectionView`).
//
// Le segmenté `Collection | Lists` n'existe qu'en style Compact : chaque
// container `kind = 'list'` apparaît ici comme une étagère
// de plus, marquée `notOwned` par `getCollectionShelves`
// (`components/collection/shelf.tsx`).
import { ArrowDownUp, BookPlus, Ellipsis, ListPlus, Plus, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AddCardSheet } from '@/app/(app)/container/[id]/add-card-sheet'
import { CardPreviewSheet } from '@/components/cards/card-preview-sheet'
import { ImportExportSheet } from '@/components/collection/import-export-sheet'
import { ValueStrip } from '@/components/collection/value-strip'
import { MiniTile } from '@/components/collection/mini-tile'
import { Shelf } from '@/components/collection/shelf'
import { ShelfTrack } from '@/components/collection/shelf-track'
import { NameSheet } from '@/components/ui/name-sheet'
import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import { useCanEdit } from '@/lib/collections/access-context'
import { formatCount, formatMoney } from '@/lib/format/money'

import { createBinderOrListAction } from './actions'
import type { CollectionShelves, ShelfData, ShelfTile } from './collection-data'
import { BUILT_DECKS_SHELF_ID } from './shelf-constants'
import { Screen } from '@/components/ui/screen'

// Pas de tuile complète, plus un entrefer de 8px (`--width-mini-tile`,
// 76px) : avancer d'une tuile complète par appui flèche sur la piste
// `Recently added`.
const RECENTLY_ADDED_ARROW_SCROLL_PX = 84

// « Built decks » agrège plusieurs containers, pas un seul (voir
// `BUILT_DECKS_SHELF_ID`, `collection-data.ts`) : son tap de nom mène à
// `/decks` (même destination que la ligne `Decks` de l'accueil Compact), les
// autres étagères à leur `/container/<id>` (la liste du container
// correspondant avec sa command bar).
function shelfHref(shelf: ShelfData): string {
  return shelf.containerId === BUILT_DECKS_SHELF_ID
    ? '/decks'
    : `/container/${shelf.containerId}`
}

export function ShelvesView({ initial }: { initial: CollectionShelves }) {
  const shelves = initial.shelves
  // `null` = feuille fermée : deux entrées de menu distinctes
  // (`New binder`/`New list`), pas de feuille à segmenté — même `NameSheet`
  // partagée que l'accueil Compact (`collection-view.tsx`).
  const [naming, setNaming] = useState<'binder' | 'list' | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Feuille de carte en lecture seule (tap de tuile) — `previewTile` porte
  // la tuile source, `previewOpen` seul pilote la visibilité (même patron que
  // `CardSheet`/`openHoldingId` de l'écran de container) : la
  // feuille reste montée pendant sa fermeture animée, avec sa dernière tuile
  // connue.
  const [previewTile, setPreviewTile] = useState<ShelfTile | null>(null)

  // Tuile voisine dans `Recently added`, la seule piste qui ouvre la feuille.
  function recentNeighbour(step: 1 | -1): (() => void) | undefined {
    const tiles = initial.recentlyAdded.tiles
    const index = previewTile ? tiles.findIndex((tile) => tile.cardId === previewTile.cardId) : -1
    const target = index === -1 ? undefined : tiles[index + step]
    return target ? () => setPreviewTile(target) : undefined
  }
  const [previewOpen, setPreviewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [importExportOpen, setImportExportOpen] = useState(false)
  const router = useRouter()
  // Lecture seule (`viewer`) : ni ajout, ni import, ni création.
  const canEdit = useCanEdit()

  // Navigation vers le container créé plutôt qu'une étagère ajoutée
  // localement (même contrat que `collection-view.tsx` désormais : création
  // puis navigation vers le container créé) — `shelves` n'a donc plus
  // besoin d'être un état mutable ci-dessus.
  async function handleCreate(name: string) {
    if (!naming) return
    setCreating(true)
    setCreateError(null)

    const result = await createBinderOrListAction({ kind: naming, name })

    if (!result.ok) {
      setCreateError('Could not create that container. Try a different name.')
      setCreating(false)
      setNaming(null)
      return
    }

    setCreating(false)
    setNaming(null)
    router.push(`/container/${result.containerId}`)
  }

  return (
    // L'en-tête ne défile plus : il est le sien, au-dessus du corps qui
    // défile seul (il doit rester visible ;
    // `sticky` était la façon de l'obtenir tant que la page entière défilait).
    <Screen
      header={
        <div className="flex items-center gap-10">
          <div className="min-w-0 flex-1">
            <h1 className="text-title-screen-shelf font-extrabold tracking-title-screen-shelf text-text">
              Collection
            </h1>
            <ValueStrip
              amountMinor={initial.value.amountMinor}
              currency={initial.value.currency}
              delta7d={initial.value.delta7d}
            />
          </div>
          {/* Ces boutons sont longtemps restés inertes. Les trois mènent
            désormais là où leur icône
            promet — les deux styles d'accueil offrent les mêmes actions, seule
            leur mise en page diffère. */}
          <button
            type="button"
            aria-label="Find a card"
            onClick={() => router.push('/search')}
            className="flex h-header-action-shelf w-header-action-shelf flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
          >
            <Search width={18} height={18} strokeWidth={1.75} />
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                aria-label="More"
                onClick={() => setMenuOpen(true)}
                className="flex h-header-action-shelf w-header-action-shelf flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
              >
                <Ellipsis width={18} height={18} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="Add a card"
                onClick={() => setAddCardOpen(true)}
                className="flex h-header-add-shelf w-header-add-shelf flex-shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              >
                <Plus width={20} height={20} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>
      }
      headerClassName="bg-bg px-16 pt-16 pb-16 desktop:px-20 desktop:pt-30"
      bodyClassName="min-w-0"
    >
      <div className="flex flex-col gap-18 px-16 pb-24 pt-16">
        {/* Masquée si vide — un compte tout neuf, sans
            aucun ajout des sept derniers jours, ne montre pas une rangée
            vide au-dessus de la première étagère réelle. */}
        {initial.recentlyAdded.tiles.length > 0 && (
          <div className="min-w-0">
            <div className="mb-9 flex items-baseline justify-between gap-8">
              <span className="text-section-label font-semibold uppercase tracking-section-label text-text-2">
                Recently added
              </span>
              <span className="text-recently-count text-text-2">
                {formatCount(initial.recentlyAdded.count)} this week
              </span>
            </div>
            {/* Piste défilante — même mécanique que `FolderShelf`
                (`ShelfTrack`) : snap, barre masquée, flèches.
                `Shelf`, lui, est une pile figée. */}
            <ShelfTrack
              label="Recently added cards"
              scrollStep={RECENTLY_ADDED_ARROW_SCROLL_PX}
              className="gap-8"
            >
              {initial.recentlyAdded.tiles.map((tile) => (
                // `lazy={false}` : `Recently added` est la toute première
                // rangée de tuiles de l'écran, avant même la première étagère
                // — toujours dans le premier écran visible.
                // `onOpen` : même feuille `CardPreviewSheet` déjà montée en
                // bas de ce composant, sur le même contrat `ShelfTile` — le
                // tap individuel n'existe plus
                // sur la pile par-container ci-dessous, mais reste sur cette
                // piste distincte.
                <MiniTile
                  key={tile.cardId}
                  artUrl={tile.artUrl}
                  name={tile.name}
                  lazy={false}
                  onOpen={() => {
                    setPreviewTile(tile)
                    setPreviewOpen(true)
                  }}
                />
              ))}
            </ShelfTrack>
          </div>
        )}

        {shelves.map((shelf, index) => (
          <Shelf
            key={shelf.containerId}
            name={shelf.name}
            tag={shelf.notOwned ? 'LIST' : undefined}
            meta={shelf.meta}
            price={formatMoney(shelf.valueMinor, initial.value.currency)}
            tiles={shelf.tiles}
            href={shelfHref(shelf)}
            // Seule la première étagère est dans le premier écran visible
            // (`loading="lazy"` sur les tuiles au-delà de la première rangée
            // visible) — chaque étagère suivante
            // est traitée comme sa propre rangée, hors écran au chargement.
            lazyTiles={index > 0}
          />
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex w-full items-center justify-center gap-8 rounded-row border-thin border-dashed border-border-dashed bg-transparent py-15 text-body font-semibold text-text-2"
          >
            <Plus width={17} height={17} strokeWidth={1.75} />
            New binder or list
          </button>
        )}
      </div>

      {/* Le même menu que l'accueil Compact : les deux styles ne diffèrent
          que par leur mise en page, jamais par ce qu'ils permettent de faire
          — `New binder`/`New list` ouvrent chacun la `NameSheet` partagée
          directement. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Collection">
        <SheetGroup>
          {/* Feuille unifiée : une seule ligne `Import / Export` plutôt que
              deux lignes séparées. */}
          <SheetRow
            icon={ArrowDownUp}
            label="Import / Export"
            hint="Paste a list, or download this collection"
            onClick={() => {
              setMenuOpen(false)
              setImportExportOpen(true)
            }}
          />
          <SheetRow
            icon={BookPlus}
            label="New binder"
            hint="A view over cards you own"
            onClick={() => {
              setMenuOpen(false)
              setCreateError(null)
              setNaming('binder')
            }}
          />
          <SheetRow
            icon={ListPlus}
            label="New list"
            hint="Cards you don't own — nothing in a list counts as owned"
            onClick={() => {
              setMenuOpen(false)
              setCreateError(null)
              setNaming('list')
            }}
          />
        </SheetGroup>
      </Sheet>

      <AddCardSheet
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        containerId={initial.rootContainerId}
        onAdded={() => router.refresh()}
      />

      <ImportExportSheet
        open={importExportOpen}
        onOpenChange={setImportExportOpen}
        onImported={() => router.refresh()}
      />

      <NameSheet
        key={`naming-${naming ?? 'none'}`}
        open={naming !== null}
        title={naming === 'list' ? 'New list' : 'New binder'}
        label={naming === 'list' ? 'List name' : 'Binder name'}
        initialValue={naming === 'list' ? 'New list' : 'New binder'}
        pending={creating}
        onSubmit={(name) => void handleCreate(name)}
        onClose={() => setNaming(null)}
      />
      {createError && (
        <div
          role="alert"
          className="fixed inset-x-16 bottom-toast-offset z-30 flex items-center gap-10 rounded-toast border border-border-device bg-surface-3 px-14 py-12 shadow-toast text-body text-danger"
        >
          <span className="min-w-0 flex-1">{createError}</span>
          <button
            type="button"
            onClick={() => setCreateError(null)}
            className="flex-shrink-0 text-body font-bold text-text-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <CardPreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        tile={previewTile}
        currency={initial.value.currency}
        onPrevious={recentNeighbour(-1)}
        onNext={recentNeighbour(1)}
      />
    </Screen>
  )
}
