'use client'

// Barre de commande (dessinée sur la barre desktop, seule variante qui
// réunit les quatre contrôles — réutilisée telle quelle sur mobile, voir
// docs/development.md) : champ `Find in N cards…`
// (debounce 200 ms), ouvre-filtres `Filters` suivi d'une
// puce retirable par critère actif (`describeActiveFilters`), bouton de tri (icône
// `arrow-down-wide-narrow`, même icône que tous les déclencheurs de tri de
// l'app — jamais un texte fixe, le libellé suit `sort.key` via
// `SORT_KEY_LABEL`) ouvrant la feuille `Sort & group`, sélecteur de densité
// à trois icônes. Tout l'état vit dans `ViewState` (`lib/view-state/parse`),
// remonté par `onViewStateChange` — cette barre ne détient elle-même aucun
// état d'URL, `container-view.tsx` est l'unique point qui lit/écrit les
// search params (`useSearchParams` force le rendu client,
// encapsulé dans un `<Suspense>` par l'appelant).
import { ArrowDownWideNarrow, PanelRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DensityPicker } from './density-picker'
import { FiltersSheet } from './filters-sheet'
import { SortSheet, SORT_KEY_LABEL } from './sort-sheet'
import { listHoldingBindersAction, type HoldingBinderOption } from '@/app/(app)/container/[id]/actions'
import { formatCount, type Currency } from '@/lib/format/money'
import { describeActiveFilters, type Density, type ViewState } from '@/lib/view-state/parse'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

const SEARCH_DEBOUNCE_MS = 200

export function CommandBar({
  containerId,
  viewState,
  onViewStateChange,
  totalCount,
  searchScope,
  shownCount,
  accountDensity,
  previewPane,
  onPreviewPaneChange,
  currency,
  translucent = false,
}: {
  containerId: string
  viewState: ViewState
  onViewStateChange: (next: ViewState) => void
  totalCount: number
  // Puce de prix active : `formatMoney` a besoin de la
  // devise du compte, la même que le reste de l'écran — jamais devinée ici.
  currency: Currency
  // Ce que le champ de recherche dit fouiller. Un container nommé se nomme
  // (« Find in this list… ») ; le container racine, qui n'a pas de nom propre
  // à l'échelle de l'écran, retombe sur son volume (« Find in 1,204 cards… »).
  searchScope: 'binder' | 'list' | 'deck' | null
  // Nombre de lignes que la vue courante rend réellement, recherche et
  // filtres appliqués — `totalCount` reste le total du container, qui
  // nourrit le libellé du champ. Les deux diffèrent dès qu'un filtre est
  // posé, et c'est précisément ce que `N shown` donne à lire.
  shownCount: number
  // Bascule `panel-right` — **la même
  // valeur** que la ligne `Card preview pane` de Settings : cette barre ne
  // détient aucun état de panneau, elle remonte le changement à l'écran de
  // container, qui écrit `users.preview_pane` par
  // `updatePreferenceAction`. Deux états locaux qui se ressembleraient
  // divergeraient au premier rechargement (même patron que Settings).
  previewPane: boolean
  onPreviewPaneChange: (next: boolean) => void
  // Repli du sélecteur tant que `viewState.density` est `null` (le choix
  // écrase la préférence de compte pour la vue courante sans modifier
  // `users.density`) — la préférence elle-même, jamais un défaut
  // en dur qui la contredirait à l'affichage.
  accountDensity: Density
  // Fond translucide — posé
  // par l'écran de container quand un fond d'art occupe l'écran (binder
  // illustré) : la barre garde sa géométrie, seules ses couleurs de
  // fond/bordure changent, pour rester lisible au-dessus de l'illustration.
  translucent?: boolean
}) {
  const [queryDraft, setQueryDraft] = useState(viewState.query)
  const onViewStateChangeRef = useRef(onViewStateChange)
  onViewStateChangeRef.current = onViewStateChange
  const viewStateRef = useRef(viewState)
  viewStateRef.current = viewState

  // Filtre `Binder` (voir le commentaire de
  // tête de `listHoldings`, `holdings-data.ts`) : visible UNIQUEMENT sur le
  // container racine, dont le seul signal déjà disponible ici est
  // `searchScope === null` (`container-view.tsx` ne passe `null` que pour
  // `header.kind === 'collection'`) — pas de prop dédiée pour un booléen que
  // ce signal porte déjà. `listHoldingBindersAction` rend la racine sous le
  // nom « No binder » (`actions.ts`), directement réutilisable pour le
  // `<select>` de `FiltersSheet` et pour la puce active ci-dessous.
  const showBinderFilter = searchScope === null
  const [binders, setBinders] = useState<HoldingBinderOption[]>([])

  useEffect(() => {
    if (!showBinderFilter) {
      setBinders([])
      return
    }
    let cancelled = false
    void listHoldingBindersAction(containerId).then((options) => {
      if (!cancelled) setBinders(options)
    })
    return () => {
      cancelled = true
    }
  }, [showBinderFilter, containerId])

  // Le champ garde son propre brouillon (comme `SearchField`) : la
  // frappe ne doit pas attendre l'aller-retour URL pour rester réactive,
  // seule la requête serveur est débouncée.
  useEffect(() => {
    setQueryDraft(viewState.query)
  }, [viewState.query])

  useEffect(() => {
    if (queryDraft === viewStateRef.current.query) return
    const timeout = setTimeout(() => {
      onViewStateChangeRef.current({ ...viewStateRef.current, query: queryDraft })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [queryDraft])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  const activeFilters = describeActiveFilters(viewState.filters, currency, binders)

  // Fond translucide — sur un
  // binder illustré, la barre de commande passe en `rgba(18,21,28,0.82)`,
  // bordure `rgba(255,255,255,0.09)`, pad de densité `rgba(20,24,33,0.9)`
  // plutôt que ses couleurs pleines habituelles. Champ et déclencheur de tri
  // partagent le même fond/bordure, le pad de densité a le sien.
  const fieldClass = translucent
    ? 'border-command-bar-translucent-border bg-command-bar-translucent'
    : 'border-border bg-surface-1'

  return (
    // Deux lignes plutôt qu'une seule : à 375px le champ de recherche,
    // `Filters`, le tri et les trois icônes de densité ne tiennent pas côte
    // à côte — le champ était comprimé au point de masquer son propre
    // libellé. `Filters` passe donc sur une seconde ligne, avec le nombre
    // de lignes rendues aligné à droite. Gap 9 entre les deux rangées,
    // margin-bottom 14 avant la liste.
    <div className="mb-14 flex flex-shrink-0 flex-col gap-9">
      {/* Gap 8 dans la rangée. */}
      <div className="flex gap-8">
        <div className="relative min-w-0 flex-1">
          <Search
            width={15}
            height={15}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-text-3"
          />
          <input
            {...SEARCH_INPUT_PROPS}
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder={
              // Trois points `...`, jamais le caractère unique `…`.
              searchScope ? `Find in this ${searchScope}...` : `Find in ${formatCount(totalCount)} cards...`
            }
            aria-label="Find in this container"
            className={`h-command-control w-full rounded-control border pl-32 pr-10 text-body text-text outline-none placeholder:text-text-2 ${fieldClass}`}
          />
        </div>

        <SortSheet
          open={sortOpen}
          onOpenChange={setSortOpen}
          sort={viewState.sort}
          groupBy={viewState.groupBy}
          onChange={({ sort, groupBy }) =>
            onViewStateChange({ ...viewState, sort, groupBy })
          }
          trigger={
            // Forme COURTE + `max-width` 132px, ellipse plutôt que de
            // repousser le champ de recherche.
            <button
              type="button"
              className={`flex h-command-control max-w-sort-trigger flex-shrink-0 items-center gap-7 rounded-control border px-13 text-meta font-bold text-text ${fieldClass}`}
            >
              <ArrowDownWideNarrow width={16} height={16} strokeWidth={1.75} className="flex-shrink-0" />
              <span className="min-w-0 truncate">{SORT_KEY_LABEL[viewState.sort.key]}</span>
            </button>
          }
        />

        <DensityPicker
          value={viewState.density ?? accountDensity}
          onChange={(next: Density) => onViewStateChange({ ...viewState, density: next })}
          translucent={translucent}
        />

        {/* Le panneau d'aperçu n'existe qu'au-delà de 1280px : sa bascule
          n'apparaît donc qu'à cette largeur, et par CSS (`pane:flex`) plutôt
          qu'en JavaScript — la barre de commande garde la même forme dès la
          première peinture. */}
        <button
          type="button"
          aria-label="Card preview pane"
          aria-pressed={previewPane}
          onClick={() => onPreviewPaneChange(!previewPane)}
          className={`hidden h-command-control w-header-action flex-shrink-0 items-center justify-center rounded-control border pane:flex ${
            previewPane ? 'border-accent bg-accent text-on-accent' : `${fieldClass} text-text-2`
          }`}
        >
          <PanelRight width={17} height={17} strokeWidth={1.75} />
        </button>
      </div>

      {/* L'ouvre-filtres est pointillé — il n'affirme rien tant qu'aucun
          critère n'est posé — et chaque critère actif prend ensuite sa propre
          puce pleine, retirable d'un geste. Une pastille de comptage sur le
          bouton disait qu'il se passait quelque chose sans dire quoi, et
          défaire un seul critère imposait de rouvrir la feuille. */}
      <div className="flex flex-wrap items-center gap-7">
        <FiltersSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          containerId={containerId}
          query={viewState.query}
          filters={viewState.filters}
          onApply={(filters) => onViewStateChange({ ...viewState, filters })}
          showBinderFilter={showBinderFilter}
          binders={binders}
          trigger={
            <button
              type="button"
              className="flex flex-shrink-0 items-center gap-5 rounded-pill border border-dashed border-border-dashed px-9 py-5 text-filter-chip font-bold text-text-2"
            >
              <SlidersHorizontal width={13} height={13} strokeWidth={1.75} />
              Filters
            </button>
          }
        />

        {activeFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => onViewStateChange({ ...viewState, filters: filter.next })}
            aria-label={`Remove filter ${filter.label}`}
            className="flex flex-shrink-0 items-center gap-5 rounded-pill border border-border-accent-subtle bg-accent-bg px-9 py-5 text-filter-chip font-bold text-accent-text"
          >
            {filter.label}
            <X width={12} height={12} strokeWidth={1.75} />
          </button>
        ))}

        <span className="ml-auto flex-shrink-0 whitespace-nowrap text-result-count text-text-2">
          {formatCount(shownCount)} shown
        </span>
      </div>
    </div>
  )
}
