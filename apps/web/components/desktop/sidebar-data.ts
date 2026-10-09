// Arbre de la barre latérale desktop (`SidebarTree`). Fichier serveur
// (`import { db }`) séparé de `sidebar.tsx`, qui est un îlot client : le type
// appartient au composant, `sidebar.tsx` le réexporte donc — même convention
// que `folders-data.ts`/`folders-view.tsx`.
//
// Deux requêtes, jamais une par container : la première résout le compte,
// son adhésion (`collection_members` — l'unique chemin d'autorisation,
// docs/development.md) et ses drapeaux d'outils ; la seconde lit d'un coup les
// containers de la collection et ses dossiers de decks.
import { asc, eq } from 'drizzle-orm'

import {
  collectionMembers,
  containers,
  deckFolders,
  users,
  type ContainerKind,
  type SidebarNodeKey,
} from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { activeMembershipOf } from '@/lib/collections/active'
import { anyToolEnabled, toolFlagsOf } from '@/lib/tools/tools'

export interface SidebarTree {
  username: string
  collection: {
    id: string
    name: string
    children: Array<{ id: string; name: string; kind: ContainerKind }>
  }
  deckFolders: Array<{ id: string; name: string }>
  toolsEnabled: boolean
}

// L'état replié voyage à côté de l'arbre plutôt que dedans : `SidebarTree`
// ne décrit que l'arbre, et la préférence de compte n'en fait pas partie.
export interface SidebarData {
  tree: SidebarTree
  collapsed: SidebarNodeKey[]
  // Le compte peut-il modifier sa collection active ? `false` pour un
  // `viewer` (lecture seule) — lu par le shell pour toute l'interface.
  canEdit: boolean
}

// `null` plutôt qu'une exception quand le compte n'a pas encore de collection
// ou pas encore de username : le shell enveloppe aussi
// `/onboarding/username` (voir `app/(app)/layout.tsx`), qui doit se
// rendre sans barre latérale au lieu de planter.
export async function getSidebarData(userId: string): Promise<SidebarData | null> {
  const [account] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      toolLifeTracker: users.toolLifeTracker,
      sidebarCollapsed: users.sidebarCollapsed,
      collectionId: collectionMembers.collectionId,
      role: collectionMembers.role,
    })
    .from(users)
    .innerJoin(collectionMembers, activeMembershipOf(userId))
    .where(eq(users.id, userId))
    .limit(1)

  if (!account?.username) return null

  const [containerRows, folderRows] = await Promise.all([
    db
      .select({ id: containers.id, name: containers.name, kind: containers.kind })
      .from(containers)
      .where(eq(containers.collectionId, account.collectionId))
      .orderBy(asc(containers.sortOrder), asc(containers.createdAt)),
    db
      .select({ id: deckFolders.id, name: deckFolders.name })
      .from(deckFolders)
      .where(eq(deckFolders.collectionId, account.collectionId))
      .orderBy(asc(deckFolders.position), asc(deckFolders.name)),
  ])

  const root = containerRows.find((row) => row.kind === 'collection')
  if (!root) return null

  return {
    tree: {
      username: account.displayName ?? account.username,
      collection: {
        id: root.id,
        name: root.name,
        // Binders et listes seulement : les decks ont leur propre entrée de
        // premier niveau, avec les dossiers de decks pour enfants — les
        // lister ici aussi doublerait chaque deck dans la même barre.
        children: containerRows.filter((row) => row.kind === 'binder' || row.kind === 'list'),
      },
      deckFolders: folderRows,
      // Même prédicat que la barre d'onglets mobile, jamais recalculé :
      // `Tools` apparaît des deux côtés ou d'aucun.
      toolsEnabled: anyToolEnabled(toolFlagsOf(account)),
    },
    collapsed: account.sidebarCollapsed,
    canEdit: account.role !== 'viewer',
  }
}
