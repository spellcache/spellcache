// Clés TanStack Query : par container et par requête. `containerHoldings`
// porte la page infinie de holdings (source de la mise à jour optimiste —
// `cancelQueries` puis `setQueryData`) ; `containerHeader` porte le total et
// la valeur relus après mutation (invalidation seule, jamais un rechargement
// complet de la page).
export const queryKeys = {
  containerHeader: (containerId: string) => ['container', containerId, 'header'] as const,
  containerHoldings: (containerId: string) => ['container', containerId, 'holdings'] as const,
}
