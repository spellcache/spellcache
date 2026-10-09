// Squelette de l'écran `Decks`. Sans ce fichier, la route n'a aucune borne
// de suspense : au clic, l'écran précédent reste affiché tant que la page
// n'est pas prête, sans rien indiquer. Deux routes en avaient déjà un
// (`collection`, `container/[id]`) ; les onglets, non.
//
// À noter : sur un serveur local qui rend en 6 ms, ce fichier ne change
// aucune mesure — le contenu réel arrive avant que le squelette n'ait le
// temps de compter. Ce qu'il couvre est le cas inverse, un rendu lent, que
// le poste de développement ne sait pas reproduire.
//
// Même vocabulaire que les squelettes existants : blocs `animate-pulse` sur
// `bg-surface-1`, aux tokens déjà posés.
const DECK_SKELETON_SHELVES = 2
const DECK_SKELETON_CARDS = 3

export default function DecksLoading() {
  return (
    <div
      className="h-full overflow-y-auto px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40"
      role="status"
      aria-label="Loading"
    >
      <div className="mb-16 flex items-center justify-between gap-10">
        <div className="h-title-skeleton w-title-skeleton animate-pulse rounded-control bg-surface-1" />
        <div className="flex items-center gap-8">
          <div className="h-header-action w-header-action flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
          <div className="h-header-add w-header-add flex-shrink-0 animate-pulse rounded-full bg-surface-1" />
        </div>
      </div>

      {/* Deux étagères : le libellé du dossier, puis sa piste de cartes —
          la géométrie de l'écran réel, dont la liste plate à puces de filtre
          a disparu avec le réglage `Decks home`. */}
      {Array.from({ length: DECK_SKELETON_SHELVES }, (_, shelf) => (
        <div key={shelf} className="mb-22">
          <div className="mb-10 ml-4 h-label-skeleton w-label-skeleton animate-pulse rounded-control bg-surface-1" />
          <div className="flex gap-10 overflow-hidden">
            {Array.from({ length: DECK_SKELETON_CARDS }, (_, card) => (
              <div
                key={card}
                className="h-deck-card w-deck-card flex-shrink-0 animate-pulse rounded-deck-card bg-surface-1"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
