// Normalisation de la requête de recherche : sert à la fois de forme
// canonique pour la clé de cache Redis (`Bolt` et `bolt `
// ne doivent pas produire deux entrées) et de filtres nettoyés pour
// `searchCards()`.
import { createHash } from 'node:crypto'

import type { CardSearchParams } from './search-cards'
import { DEFAULT_SET_TYPE_GROUPS, type SetTypeGroup } from '@/lib/search/set-type-groups'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100
// Bumped to `v4` : `colorSpread` a rejoint `NormalizedSearchFilters`, et le
// classement par nom (sémantique `unique=cards, order=name` — un résultat
// par nom, cf. `search-cards.ts`) change la forme des résultats pour des paramètres par ailleurs identiques.
// Une entrée `v3` relue après ce déploiement montrerait plusieurs impressions
// du même nom ou ignorerait silencieusement `colorSpread` pendant la fenêtre
// de TTL de 10 minutes qui suit — même raison que le bump `v2` → `v3`
// ci-dessous, jamais compter sur le TTL pour s'auto-corriger.
const CACHE_KEY_VERSION = 'v8'

export interface NormalizedSearchFilters {
  colors: string[]
  colorMatch: 'including' | 'exactly' | 'atMost'
  // Spectre de couleur : troisième axe du bloc
  // couleurs, orthogonal aux pips choisis — `null` : pas de contrainte.
  colorSpread: 'multi' | 'mono' | null
  types: string[]
  rarities: string[]
  setCode: string | null
  priceMin: number | null
  priceMax: number | null
  foilOnly: boolean
  setTypes: SetTypeGroup[]
}

export interface NormalizedSearchParams {
  query: string
  filters: NormalizedSearchFilters
  limit: number
  cursor: string | null
  // Devise du compte (`price_source`, résolue côté serveur par l'appelant —
  // jamais un paramètre client, docs/development.md) : fait partie de la forme
  // normalisée pour que le prix affiché et le prix filtré (`priceMin`/
  // `priceMax`) restent la même colonne, et pour que deux comptes sur des
  // devises différentes n'partagent jamais une entrée de cache.
  currency: 'usd' | 'eur'
  // Régime de tri/dédoublonnage (`lib/search/search-cards.ts` — `'search'`
  // groupe par nom, `'set'` ne groupe pas et trie par numéro de
  // collectionneur) : deux appels aux mêmes filtres mais des régimes
  // différents ne doivent jamais partager une entrée de cache, la forme du
  // résultat diffère.
  scope: 'search' | 'set'
}

function normalizeBound(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

export function normalizeSearchParams(params: CardSearchParams): NormalizedSearchParams {
  const filters = params.filters ?? {}
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

  return {
    query: params.query.trim().replace(/\s+/g, ' ').toLowerCase(),
    filters: {
      colors: [...(filters.colors ?? [])].sort(),
      colorMatch: filters.colorMatch ?? 'including',
      colorSpread: filters.colorSpread ?? null,
      types: [...(filters.types ?? [])].map((type) => type.trim().toLowerCase()).sort(),
      rarities: [...(filters.rarities ?? [])].sort(),
      setCode: filters.setCode?.trim().toLowerCase() || null,
      // Une borne vide, négative ou illisible n'est pas une borne : la
      // fourchette la laisse tomber plutôt que de rendre zéro résultat.
      priceMin: normalizeBound(filters.priceMin),
      priceMax: normalizeBound(filters.priceMax),
      foilOnly: filters.foilOnly === true,
      // `undefined` = sélection par défaut (Release + Tokens) ; un tableau —
      // même vide — est respecté tel quel. Trié pour une clé de cache
      // stable.
      setTypes: [...(filters.setTypes ?? DEFAULT_SET_TYPE_GROUPS)].sort(),
    },
    limit,
    cursor: params.cursor ?? null,
    currency: params.currency === 'eur' ? 'eur' : 'usd',
    scope: params.scope === 'set' ? 'set' : 'search',
  }
}

export function searchCacheKey(params: CardSearchParams): string {
  const normalized = normalizeSearchParams(params)
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  return `search:${CACHE_KEY_VERSION}:${hash}`
}
