'use client'

// Toutes les cartes d'un set, atteint depuis `Search › Sets`. Les mêmes
// lignes que les résultats de recherche, et les mêmes filtres — moins le set
// lui-même, qui est l'écran où l'on se trouve : le proposer ici serait une
// sortie, pas un filtre.
//
// Pas de champ de recherche par nom : chercher un nom dans un set, c'est
// l'onglet `Search` avec un filtre de set. Un champ qui ne filtrerait que les
// lignes déjà chargées mentirait sur ce qu'il cherche.
//
// `scope: 'set'` : chaque impression du
// set, triée par numéro de collectionneur naturel — jamais le classement par
// nom groupé de l'onglet `Search` (`lib/search/search-cards.ts`).
import { SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AddCardSheet } from '@/app/(app)/container/[id]/add-card-sheet'
import { SearchRow } from '@/components/search/search-row'
import {
  activeFilterCount,
  EMPTY_FILTERS,
  SearchFiltersSheet,
  type SearchFilters,
} from '@/components/search/search-filters-sheet'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import type { Currency } from '@/lib/format/money'
import type { CardSearchItem } from '@/lib/search/search-cards'

import { searchCatalogAction, type SetSummary } from '../../actions'

type Status = 'loading' | 'results' | 'empty' | 'error'

function priceBound(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// Les filtres de la feuille, tels qu'envoyés au serveur — le set de l'écran,
// jamais celui du brouillon (la feuille ne l'offre pas ici, `showSet={false}`).
function toApiFilters(nextFilters: SearchFilters, setCode: string) {
  return {
    colors: nextFilters.colors,
    colorMatch: nextFilters.colorMatch,
    colorSpread: nextFilters.colorSpread,
    types: nextFilters.types,
    rarities: nextFilters.rarities,
    setCode,
    priceMin: priceBound(nextFilters.priceMin),
    priceMax: priceBound(nextFilters.priceMax),
    foilOnly: nextFilters.foilOnly,
    // Feuilleter un set montre TOUTES ses cartes, y compris un set de
    // tokens/Art Series ouvert depuis l'onglet Sets — sélection « Set ·
    // Type » vide = aucune condition (le défaut Release + Tokens viderait
    // un set promo ou Art Series).
    setTypes: [],
  }
}

export function SetDetailView({ set }: { set: SetSummary }) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<CardSearchItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totalEstimate, setTotalEstimate] = useState(0)
  const [currency, setCurrency] = useState<Currency>('eur')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedItem, setSelectedItem] = useState<CardSearchItem | null>(null)
  const latestRequestId = useRef(0)

  const filterCount = activeFilterCount(filters)

  const run = useCallback(
    (nextFilters: SearchFilters) => {
      const requestId = ++latestRequestId.current
      setStatus('loading')
      setItems([])
      setNextCursor(null)

      searchCatalogAction({
        query: '',
        scope: 'set',
        filters: toApiFilters(nextFilters, set.code),
      })
        .then((data) => {
          if (requestId !== latestRequestId.current) return
          if ('error' in data) {
            setStatus('error')
            return
          }
          setItems(data.items)
          setNextCursor(data.nextCursor)
          setTotalEstimate(data.totalEstimate)
          setCurrency(data.currency)
          setStatus(data.items.length === 0 ? 'empty' : 'results')
        })
        .catch(() => {
          if (requestId !== latestRequestId.current) return
          setStatus('error')
        })
    },
    [set.code],
  )

  useEffect(() => {
    run(filters)
  }, [filters, run])

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return
    const requestId = latestRequestId.current
    setLoadingMore(true)

    searchCatalogAction({
      query: '',
      scope: 'set',
      cursor: nextCursor,
      filters: toApiFilters(filters, set.code),
    })
      .then((data) => {
        setLoadingMore(false)
        if (requestId !== latestRequestId.current) return
        if ('error' in data) return
        setItems((current) => [...current, ...data.items])
        setNextCursor(data.nextCursor)
        setTotalEstimate(data.totalEstimate)
      })
      .catch(() => setLoadingMore(false))
  }

  // Chargement automatique en bas de liste (demande produit) plutôt qu'un
  // bouton `Load more` : une sentinelle sous la dernière ligne déclenche la
  // page suivante dès qu'elle approche de l'écran. La ref garde la dernière
  // version du gestionnaire sans réabonner l'observateur à chaque rendu.
  const loadMoreRef = useRef(handleLoadMore)
  loadMoreRef.current = handleLoadMore
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMore = status === 'results' && nextCursor !== null

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || !sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, items.length])

  return (
    <Screen
      header={
        <ScreenHeader
          title={set.name}
          breadcrumb="Search › Sets"
          meta={
            // `totalEstimate` vient de la même recherche que la liste
            // ci-dessous : sans filtre, c'est un compte
            // de `cards` par `set_code` — la même source que `cardCount` de
            // `SetRow`/`listSetsAction` (`app/(app)/search/actions.ts`), pas
            // `sets.card_count` (la taille imprimée côté Scryfall, qui peut
            // dépasser ce que le miroir local possède réellement).
            <>
              <span className="font-mono">{set.code.toUpperCase()}</span>
              {set.releasedAt ? ` · ${set.releasedAt}` : ''}
              {totalEstimate > 0 ? ` · ${totalEstimate} ${totalEstimate === 1 ? 'card' : 'cards'}` : ''}
            </>
          }
          onBack={() => window.history.back()}
          actions={[
            {
              icon: SlidersHorizontal,
              label: filterCount > 0 ? `Filters (${filterCount})` : 'Filters',
              onClick: () => setFiltersOpen(true),
            },
          ]}
        />
      }
    >
      {status === 'loading' && (
        <p role="status" aria-label="Loading" className="px-4 py-8 text-body text-text-2">
          Loading set...
        </p>
      )}

      {status === 'error' && (
        <p className="px-4 py-8 text-body text-danger">Could not load this set. Please try again.</p>
      )}

      {status === 'empty' && (
        <p className="px-4 py-8 text-body text-text-2">No card in this set matches these filters.</p>
      )}

      {status === 'results' && (
        <ul className="flex flex-col gap-9">
          {items.map((item) => (
            <li key={item.id}>
              <SearchRow item={item} currency={currency} onClick={() => setSelectedItem(item)} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="mt-12 py-12 text-center text-body text-text-2">
          {loadingMore ? 'Loading...' : `${items.length} of ${totalEstimate}`}
        </div>
      )}

      <SearchFiltersSheet
        key={String(filtersOpen)}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        sets={[]}
        showSet={false}
        showSetTypes={false}
        onApply={(next) => {
          setFilters(next)
          setFiltersOpen(false)
        }}
      />

      {/* Même feuille que l'onglet Search : `containerId: null` ajoute au
          container racine de la collection. */}
      <AddCardSheet
        key={selectedItem?.id ?? 'none'}
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null)
        }}
        containerId={null}
        presetCard={selectedItem}
        presetCurrency={currency}
        onAdded={() => setSelectedItem(null)}
      />
    </Screen>
  )
}
