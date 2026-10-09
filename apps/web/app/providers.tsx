'use client'

// Fournisseur d'état serveur (TanStack Query, clés par container et par
// requête de recherche). Nécessaire au câblage de la mise à jour optimiste
// des quantités.
// `useState` (pas un module-scope singleton) : chaque requête serveur Next.js
// doit obtenir son propre `QueryClient`, sinon le cache fuiterait entre deux
// utilisateurs sur le rendu serveur.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
