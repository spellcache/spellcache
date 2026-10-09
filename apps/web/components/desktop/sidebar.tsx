'use client'

// Barre latérale desktop, au pixel du design validé : 236px, `AppLogo` 34px +
// nom d'utilisateur, entrées de premier niveau en 14.5px, sous-arbre indenté de
// 26px en 13.5px, `Settings` poussé en bas (`margin-top:auto`).
//
// Ce composant ne décide **jamais** de sa propre visibilité : c'est `AppShell`
// qui porte `hidden desktop:flex` (mise en page par CSS) et qui l'élague du DOM
// sous 768px une fois hydraté. Il n'est donc jamais rendu deux fois, ni
// dupliqué en variante mobile — l'onglet équivalent est
// `components/ui/tab-bar.tsx`, dont il partage la même liste de destinations et
// le même prédicat `Tools` (`lib/tools/tools.ts`).
import { BookCopy, Folder, Layers3, Library, Search, Settings, Wrench } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AppLogo } from '@/components/brand/app-logo'
import { DecksIcon } from '@/components/ui/tab-bar'
import type { SidebarNodeKey } from '@spellcache/db/schema'

import type { SidebarTree } from './sidebar-data'

// Réexport pour que `SidebarTree` reste exporté par
// `components/desktop/sidebar.tsx` alors que la requête vit dans le fichier
// serveur voisin — un `export type` est effacé à la compilation,
// il ne tire aucun code serveur dans le bundle navigateur.
export type { SidebarTree } from './sidebar-data'

const STROKE_WIDTH = 1.75
const ITEM_ICON = 19
// Marque en 34px : `AppLogo`, et non le carré bleu de dégradé.
const BRAND_ICON = 34
const CHILD_ICON = 15

function itemClassName(active: boolean): string {
  return `flex min-w-0 flex-1 items-center gap-12 text-sidebar-item font-semibold ${
    active ? 'text-on-accent' : 'text-text-2'
  }`
}

function rowClassName(active: boolean): string {
  return `flex items-center rounded-sidebar-item px-14 py-11 ${active ? 'bg-accent' : ''}`
}

function childClassName(active: boolean): string {
  return `flex items-center gap-9 rounded-sidebar-child px-12 py-8 text-sidebar-child font-semibold ${
    active ? 'bg-surface-1 text-text' : 'text-text-2'
  }`
}

function Subtree({ children }: { children: ReactNode }) {
  // 26px d'indentation, valeur du design validé
  // (`padding:4px 0 4px 26px`) — mesuré par `tests/unit/row-heights.test.tsx`.
  return <div className="flex flex-col gap-2 py-4 pl-26">{children}</div>
}

export function Sidebar({
  tree,
  activeId,
}: {
  tree: SidebarTree
  activeId: string
  // Aucun repli manuel persisté : un sous-arbre n'est visible QUE quand son
  // onglet est actif, il suit strictement `collectionActive`/`decksActive` ci-dessous, jamais un choix
  // mémorisé qui pourrait diverger de l'onglet réellement affiché. La
  // colonne `users.sidebar_collapsed` reste en base — docs/development.md
  // interdit les migrations destructives — mais n'est plus ni lue ni écrite
  // par ce composant ; le prop `collapsed` reste accepté pour ne pas rompre
  // le contrat de `getSidebarData` ni le rendu de `app/(app)/app-shell.tsx`,
  // il n'est simplement plus consommé ici.
  collapsed?: SidebarNodeKey[]
}) {
  // Le design met `Collection` en accent **et** surligne
  // l'enfant courant : l'entrée de premier niveau reste donc active tant
  // qu'on est quelque part dans sa section, pas seulement sur `/collection`.
  const collectionActive =
    activeId === 'collection' ||
    activeId === tree.collection.id ||
    tree.collection.children.some((child) => child.id === activeId)
  const decksActive = activeId === 'decks' || tree.deckFolders.some((folder) => folder.id === activeId)

  return (
    <nav
      aria-label="Sections"
      data-testid="desktop-sidebar"
      className="flex h-full w-sidebar flex-col gap-4 overflow-y-auto px-12 pb-24 pt-30"
    >
      <div className="flex items-center gap-10 px-14 pb-22">
        <AppLogo size={BRAND_ICON} />
        <div className="min-w-0">
          <div className="text-sidebar-brand font-extrabold tracking-sidebar-brand text-text">
            spellcache
          </div>
          <div className="truncate text-sidebar-username text-text-2">{tree.username}</div>
        </div>
      </div>

      <div className={rowClassName(collectionActive)}>
        <Link href="/collection" className={itemClassName(collectionActive)}>
          <Library width={ITEM_ICON} height={ITEM_ICON} strokeWidth={STROKE_WIDTH} />
          <span className="truncate">Collection</span>
        </Link>
      </div>

      {collectionActive && (
        <Subtree>
          {/* « All collection », jamais le nom de la collection : le
              premier enfant nomme ce
              qu'il montre, pas ce que la ligne parente affiche déjà. */}
          <Link
            href={`/container/${tree.collection.id}`}
            className={childClassName(activeId === tree.collection.id)}
          >
            <Layers3 width={CHILD_ICON} height={CHILD_ICON} strokeWidth={STROKE_WIDTH} />
            <span className="truncate">All collection</span>
          </Link>
          {/* Le design dessine une entrée `Decks` **dans** le
              sous-arbre de `Collection`, entre `All collection` et les
              binders : une seule ligne vers l'écran des decks, jamais la
              liste des decks eux-mêmes. */}
          <Link href="/decks" className={childClassName(activeId === 'decks')}>
            <DecksIcon size={CHILD_ICON} />
            <span className="truncate">Decks</span>
          </Link>
          {tree.collection.children.map((child) => (
            <Link
              key={child.id}
              href={`/container/${child.id}`}
              className={childClassName(activeId === child.id)}
            >
              <BookCopy width={CHILD_ICON} height={CHILD_ICON} strokeWidth={STROKE_WIDTH} />
              <span className="truncate">{child.name}</span>
            </Link>
          ))}
        </Subtree>
      )}

      <div className={rowClassName(activeId === 'search')}>
        <Link href="/search" className={itemClassName(activeId === 'search')}>
          <Search width={ITEM_ICON} height={ITEM_ICON} strokeWidth={STROKE_WIDTH} />
          <span className="truncate">Search</span>
        </Link>
      </div>

      <div className={rowClassName(decksActive)}>
        <Link href="/decks" className={itemClassName(decksActive)}>
          <DecksIcon size={ITEM_ICON} />
          <span className="truncate">Decks</span>
        </Link>
      </div>

      {tree.deckFolders.length > 0 && decksActive && (
        <Subtree>
          {tree.deckFolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/decks/folders/${folder.id}`}
              className={childClassName(activeId === folder.id)}
            >
              {/* `Folder`, pas `BookCopy` : un dossier de decks
                  n'est pas un classeur. */}
              <Folder width={CHILD_ICON} height={CHILD_ICON} strokeWidth={STROKE_WIDTH} />
              <span className="truncate">{folder.name}</span>
            </Link>
          ))}
        </Subtree>
      )}

      {tree.toolsEnabled && (
        <div className={rowClassName(activeId === 'tools')}>
          <Link href="/tools" className={itemClassName(activeId === 'tools')}>
            <Wrench width={ITEM_ICON} height={ITEM_ICON} strokeWidth={STROKE_WIDTH} />
            <span className="truncate">Tools</span>
          </Link>
        </div>
      )}

      {/* `Settings` collé en bas (`margin-top:auto`). */}
      <div className="mt-auto flex flex-col gap-4">
        <div className={rowClassName(activeId === 'settings')}>
          <Link href="/settings" className={itemClassName(activeId === 'settings')}>
            <Settings width={ITEM_ICON} height={ITEM_ICON} strokeWidth={STROKE_WIDTH} />
            <span className="truncate">Settings</span>
          </Link>
        </div>
      </div>
    </nav>
  )
}
