// Squelette de l'onglet `Search` — voir `app/(app)/decks/loading.tsx` pour
// la raison d'être de ces fichiers. La barre collante reprend la géométrie
// exacte de `search-view.tsx` (`sticky top-0 bg-bg px-16 py-10` autour d'un
// champ de 40px) pour que le champ réel prenne la place du bloc gris sans
// déplacer la liste sous lui.
const RESULT_SKELETON_ROWS = 6

export default function SearchLoading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="sticky top-0 z-10 bg-bg px-16 py-10">
        <div className="h-row-search-field animate-pulse rounded-control bg-surface-1" />
      </div>
      <div className="flex flex-col gap-8 px-16 py-10">
        {Array.from({ length: RESULT_SKELETON_ROWS }, (_, index) => (
          <div key={index} className="h-row-search-skeleton animate-pulse rounded-row bg-surface-1" />
        ))}
      </div>
    </div>
  )
}
