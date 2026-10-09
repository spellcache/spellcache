// Squelette de chargement de l'écran (squelettes sur `#12151c`, aux tokens du
// design). Convention `loading.tsx` du App Router : Next enveloppe
// automatiquement `page.tsx` (composant serveur qui attend `getCollectionHome`)
// dans un `Suspense` dont ce fichier est le fallback — pas de refetch, pas de
// nouvel état côté client à câbler. Même patron que `search-view.tsx` : blocs
// `animate-pulse` sur `bg-surface-1`, aux tokens déjà posés —
// `--height-row-search-skeleton` est réutilisée telle quelle plutôt que
// d'inventer une échelle de squelette dédiée à cet écran.
const BINDER_SKELETON_ROWS = 4

export default function CollectionLoading() {
  return (
    <div className="h-full overflow-y-auto px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40" role="status" aria-label="Loading">
      <div className="mb-18 flex items-center justify-between gap-10">
        <div className="h-header-action flex-1 animate-pulse rounded-control bg-surface-1" />
        <div className="flex items-center gap-8">
          <div className="h-header-action w-header-action flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
          <div className="h-header-add w-header-add flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
        </div>
      </div>

      <div className="mb-14 h-row-search-skeleton animate-pulse rounded-card bg-surface-1" />

      <div className="mb-16 flex gap-8">
        <div className="h-header-add flex-1 animate-pulse rounded-control bg-surface-1" />
        <div className="h-header-add flex-1 animate-pulse rounded-control bg-surface-1" />
      </div>

      <div className="mb-18 h-header-add animate-pulse rounded-control bg-surface-2" />

      <div className="mb-11 flex flex-col gap-11">
        <div className="h-row-search-skeleton animate-pulse rounded-row bg-surface-1" />
        <div className="h-row-search-skeleton animate-pulse rounded-row bg-surface-1" />
      </div>

      <div className="flex flex-col gap-11">
        {Array.from({ length: BINDER_SKELETON_ROWS }, (_, index) => (
          <div
            key={index}
            className="h-row-search-skeleton animate-pulse rounded-row bg-surface-1"
          />
        ))}
      </div>
    </div>
  )
}
