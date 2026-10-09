'use client'

// Lecture seule côté interface (rôle `viewer`) : un contexte unique qui dit
// si le compte peut modifier la collection qu'il regarde. Les contrôles
// d'édition (quantités, ajouts, menus d'actions) le lisent pour se masquer.
//
// Confort d'interface seulement : la garantie vit côté serveur, où chaque
// mutation exige `'write'` (lib/collections/authorize.ts) — un contrôle
// oublié ici échoue proprement, il n'écrit jamais.
//
// Valeur posée par le shell pour la collection active (`app-shell.tsx`), et
// reposée par un écran de container ou de deck pour SA collection (un lien
// direct peut mener à une collection qui n'est pas l'active).
import { createContext, useContext } from 'react'

const CanEditContext = createContext(true)

export function CollectionAccessProvider({
  canEdit,
  children,
}: {
  canEdit: boolean
  children: React.ReactNode
}) {
  return <CanEditContext.Provider value={canEdit}>{children}</CanEditContext.Provider>
}

export function useCanEdit(): boolean {
  return useContext(CanEditContext)
}
