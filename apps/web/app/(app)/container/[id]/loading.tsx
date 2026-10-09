// Squelette de chargement de l'écran de container. Même convention que
// `app/(app)/collection/loading.tsx` : `loading.tsx` enveloppe
// automatiquement `page.tsx` dans un `Suspense`, pas de nouvel état client à
// câbler. Hauteur de ligne générique (`--height-row-search-skeleton`) —
// la densité réelle n'est connue qu'une fois la préférence compte chargée,
// le squelette n'a donc pas à mimer une densité précise.
const SKELETON_ROWS = 8

export default function ContainerLoading() {
  return (
    <div className="h-full overflow-y-auto px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40" role="status" aria-label="Loading">
      <div className="mb-14 flex items-center gap-10">
        <div className="h-back-button w-back-button flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
        <div className="min-w-0 flex-1 animate-pulse">
          <div className="h-header-action w-full rounded-control bg-surface-1" />
        </div>
        <div className="h-header-add w-header-add flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
      </div>

      <div className="flex flex-col gap-6">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div
            key={index}
            className="h-row-search-skeleton animate-pulse rounded-row bg-surface-1"
          />
        ))}
      </div>
    </div>
  )
}
