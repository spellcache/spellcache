'use client'

// Onglet Search — deux catégories : les **cartes** du catalogue, et les
// **sets**. Chaque catégorie pose son propre écran (titre + segmenté + sa
// barre) — la barre épinglée (champ, bouton Filters, ligne `N results`/
// `Clear filters`) monte dans le `header` du `Screen` plutôt que de défiler
// avec la liste.
//
// Cet onglet n'a pas d'écran de design dédié : il est composé des composants
// et tokens déjà livrés.
import { Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AddCardSheet } from '@/app/(app)/container/[id]/add-card-sheet'
import { SearchRow } from '@/components/search/search-row'
import {
  activeFilterCount,
  EMPTY_FILTERS,
  SearchFiltersSheet,
  type SearchFilters,
} from '@/components/search/search-filters-sheet'
import { SetRow } from '@/components/search/set-row'
import { Screen } from '@/components/ui/screen'
import {
  activeSetsFilterCount,
  EMPTY_SETS_FILTERS,
  SetsFiltersSheet,
  type SetsFilters,
} from '@/components/search/sets-filters-sheet'
import { Segmented } from '@/components/ui/segmented'
import type { CardSearchItem, CardSearchResult } from '@/lib/search/search-cards'

import { listSetsAction, searchCatalogAction, type SetSummary } from './actions'
import { SET_TYPE_GROUPS, setGroupOf } from '@/lib/search/set-type-groups'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

type Category = 'cards' | 'sets'
type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error'

const CATEGORIES = [
  { value: 'cards', label: 'Cards' },
  { value: 'sets', label: 'Sets' },
]

// La recherche texte ne part qu'à partir de 2 caractères ; en dessous, c'est
// comme si le champ était vide — les filtres seuls restent une recherche
// valide.
const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 300

// Une borne de prix saisie à la main : vide ou illisible vaut « pas de
// borne », jamais zéro (qui, lui, filtrerait tout).
function priceBound(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// Borne d'année saisie librement : 4 chiffres plausibles, sinon ignorée.
function parseYearBound(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{4}$/.test(trimmed)) return null
  return Number(trimmed)
}

function CategoryTabs({
  category,
  onChange,
}: {
  category: Category
  onChange: (next: Category) => void
}) {
  return (
    <>
      <h1 className="mb-16 text-title-subscreen font-extrabold tracking-title-subscreen text-text">
        Search
      </h1>
      <div className="mb-16">
        <Segmented options={CATEGORIES} value={category} onChange={(next) => onChange(next as Category)} />
      </div>
    </>
  )
}

export function SearchView() {
  const [category, setCategory] = useState<Category>('cards')
  return category === 'cards' ? (
    <CardsSearch category={category} onCategoryChange={setCategory} />
  ) : (
    <SetsBrowser category={category} onCategoryChange={setCategory} />
  )
}

function CardsSearch({
  category,
  onCategoryChange,
}: {
  category: Category
  onCategoryChange: (next: Category) => void
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sets, setSets] = useState<SetSummary[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<CardSearchResult | null>(null)
  const [selectedItem, setSelectedItem] = useState<CardSearchItem | null>(null)

  // Résultat voisin du résultat ouvert, dans l'ordre affiché.
  function neighbour(step: 1 | -1): (() => void) | undefined {
    const items = result?.items ?? []
    const index = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1
    const target = index === -1 ? undefined : items[index + step]
    return target ? () => setSelectedItem(target) : undefined
  }

  // Discriminant de requête : une réponse en retard d'une frappe précédente ne
  // doit jamais écraser un résultat plus récent.
  const latestRequestId = useRef(0)
  const filterCount = activeFilterCount(filters)

  // La liste des sets sert au sélecteur de la feuille de filtres : chargée une
  // fois, jamais à chaque ouverture.
  useEffect(() => {
    void listSetsAction().then(setSets)
  }, [])

  // Débounce (300ms) sur la frappe seule : un changement de filtre
  // déclenche l'effet de
  // recherche ci-dessous sans attendre ce délai.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    const effectiveQuery = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : ''
    const count = activeFilterCount(filters)

    // Rien à chercher : ni texte utilisable, ni filtre. L'écran le dit plutôt
    // que de ramener le catalogue entier.
    if (effectiveQuery === '' && count === 0) {
      latestRequestId.current += 1
      setStatus('idle')
      setResult(null)
      return
    }

    const requestId = ++latestRequestId.current
    setStatus('loading')

    searchCatalogAction({
      query: effectiveQuery,
      filters: {
        colors: filters.colors,
        colorMatch: filters.colorMatch,
        colorSpread: filters.colorSpread,
        types: filters.types,
        rarities: filters.rarities,
        setCode: filters.setCode ?? undefined,
        priceMin: priceBound(filters.priceMin),
        priceMax: priceBound(filters.priceMax),
        foilOnly: filters.foilOnly,
        setTypes: filters.setTypes,
      },
    })
      .then((data) => {
        if (requestId !== latestRequestId.current) return
        if ('error' in data) {
          setStatus('error')
          return
        }
        setResult(data)
        setStatus(data.items.length === 0 ? 'empty' : 'results')
      })
      .catch(() => {
        if (requestId !== latestRequestId.current) return
        setStatus('error')
      })
  }, [debouncedQuery, filters])

  return (
    <Screen
      header={
        <>
          <CategoryTabs category={category} onChange={onCategoryChange} />

          <div className="mb-14 flex gap-8">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                width={16}
                height={16}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-text-3"
              />
              <input
                {...SEARCH_INPUT_PROPS}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search card name..."
                aria-label="Search card name"
                className="w-full rounded-control border border-border bg-surface-1 py-12 pl-34 pr-12 text-card-name-search text-text outline-none placeholder:text-text-3"
              />
            </div>
            <button
              type="button"
              aria-label="Filters"
              onClick={() => setFiltersOpen(true)}
              className={`flex flex-shrink-0 items-center justify-center gap-7 rounded-control border px-14 text-row-value font-bold ${
                filterCount > 0
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-border bg-surface-1 text-text-2'
              }`}
            >
              <SlidersHorizontal width={16} height={16} strokeWidth={1.9} />
              {filterCount > 0 && filterCount}
            </button>
          </div>

          <div className="mb-10 flex min-h-search-meta items-center justify-between gap-10 text-meta font-semibold text-text-2">
            <span>{status === 'results' && result ? `${result.totalEstimate} results` : ''}</span>
            {filterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-meta font-bold text-accent-text"
              >
                Clear filters
              </button>
            )}
          </div>
        </>
      }
    >
      {status === 'idle' && (
        <p className="px-4 py-32 text-center text-body leading-normal text-text-2">
          Search by name, or use the filters to browse by color, type, text, set or rarity.
        </p>
      )}

      {status === 'loading' && (
        <p role="status" aria-label="Loading" className="px-4 py-8 text-body text-text-2">
          Searching...
        </p>
      )}

      {status === 'error' && (
        <p className="px-4 py-8 text-body text-danger">Search failed. Please try again.</p>
      )}

      {status === 'empty' && (
        <p className="px-4 py-8 text-body text-text-2">No cards match this search.</p>
      )}

      {status === 'results' && result && (
        <ul className="flex flex-col gap-9">
          {result.items.map((item) => (
            <li key={item.id}>
              <SearchRow item={item} currency={result.currency} onClick={() => setSelectedItem(item)} />
            </li>
          ))}
        </ul>
      )}

      {/* Remontée à chaque ouverture, pour que la feuille reparte toujours des
          filtres réellement appliqués. */}
      <SearchFiltersSheet
        key={String(filtersOpen)}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        sets={sets}
        onApply={(next) => {
          setFilters(next)
          setFiltersOpen(false)
        }}
      />

      {/* Clic sur un résultat → `AddCardSheet` préchargée :
          `containerId: null` ajoute au
          container racine de la collection (« Add to collection »). */}
      <AddCardSheet
        key={selectedItem?.id ?? 'none'}
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null)
        }}
        containerId={null}
        presetCard={selectedItem}
        presetCurrency={result?.currency}
        onAdded={() => setSelectedItem(null)}
        onPrevious={neighbour(-1)}
        onNext={neighbour(1)}
      />
    </Screen>
  )
}

function SetsBrowser({
  category,
  onCategoryChange,
}: {
  category: Category
  onCategoryChange: (next: Category) => void
}) {
  const [filter, setFilter] = useState('')
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Filtres de l'onglet (demande produit) : « Ignore Tokens and Art
  // Series » actif par défaut + bornes d'années, posés depuis la même
  // feuille de filtres que les cartes.
  const [setsFilters, setSetsFilters] = useState<SetsFilters>(EMPTY_SETS_FILTERS)
  const [setsFiltersOpen, setSetsFiltersOpen] = useState(false)

  useEffect(() => {
    void listSetsAction()
      .then(setSets)
      .catch(() => setFailed(true))
  }, [])

  // Tous les sets jamais imprimés font une longue liste : un filtre sur le nom
  // ou le code la garde utilisable sans rien cacher par défaut.
  const needle = filter.trim().toLowerCase()

  function matchesFilters(entry: SetSummary, applied: SetsFilters): boolean {
    // Sélection vide = tout montrer (même sémantique que les puces de type).
    if (
      applied.setTypes.length > 0 &&
      applied.setTypes.length < SET_TYPE_GROUPS.length &&
      !applied.setTypes.includes(setGroupOf(entry))
    ) {
      return false
    }
    const from = parseYearBound(applied.yearFrom)
    const to = parseYearBound(applied.yearTo)
    if (from !== null || to !== null) {
      // Une borne posée exclut les sets sans date : impossible de dire s'ils
      // tombent dans la fenêtre.
      if (entry.releasedAt === null) return false
      const year = Number(entry.releasedAt.slice(0, 4))
      if (from !== null && year < from) return false
      if (to !== null && year > to) return false
    }
    return true
  }

  const visible = (sets ?? []).filter(
    (entry) =>
      (needle === '' ||
        entry.name.toLowerCase().includes(needle) ||
        entry.code.toLowerCase().includes(needle)) &&
      matchesFilters(entry, setsFilters),
  )

  const setsFilterCount = activeSetsFilterCount(setsFilters)

  return (
    <Screen
      header={
        <>
          <CategoryTabs category={category} onChange={onCategoryChange} />

          <div className="mb-14 flex gap-8">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                width={16}
                height={16}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-text-3"
              />
              <input
                {...SEARCH_INPUT_PROPS}
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter sets..."
                aria-label="Filter sets"
                className="w-full rounded-control border border-border bg-surface-1 py-12 pl-34 pr-12 text-card-name-search text-text outline-none placeholder:text-text-3"
              />
            </div>
            {/* Même bouton que l'onglet Cards (demande produit) : accent +
                compteur quand des filtres sont posés — l'interrupteur actif
                par défaut ne compte pas. */}
            <button
              type="button"
              aria-label="Filters"
              onClick={() => setSetsFiltersOpen(true)}
              className={`flex flex-shrink-0 items-center justify-center gap-7 rounded-control border px-14 text-row-value font-bold ${
                setsFilterCount > 0
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-border bg-surface-1 text-text-2'
              }`}
            >
              <SlidersHorizontal width={16} height={16} strokeWidth={1.9} />
              {setsFilterCount > 0 && setsFilterCount}
            </button>
          </div>
        </>
      }
    >
      {failed && (
        <p className="px-4 py-8 text-body text-danger">Could not load sets. Please try again.</p>
      )}

      {!failed && sets === null && (
        <p role="status" aria-label="Loading" className="px-4 py-8 text-body text-text-2">
          Loading sets...
        </p>
      )}

      {!failed && sets !== null && (
        <>
          <div className="mb-10 text-meta font-semibold text-text-2">{visible.length} sets</div>
          <div className="flex flex-col gap-9">
            {visible.map((entry) => (
              <SetRow key={entry.code} set={entry} />
            ))}
          </div>
        </>
      )}

      <SetsFiltersSheet
        key={String(setsFiltersOpen)}
        open={setsFiltersOpen}
        onOpenChange={setSetsFiltersOpen}
        filters={setsFilters}
        onApply={setSetsFilters}
        countFor={(next) =>
          (sets ?? []).filter(
            (entry) =>
              (needle === '' ||
                entry.name.toLowerCase().includes(needle) ||
                entry.code.toLowerCase().includes(needle)) &&
              matchesFilters(entry, next),
          ).length
        }
      />
    </Screen>
  )
}
