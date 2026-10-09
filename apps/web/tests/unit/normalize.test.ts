// Normalisation + hachage de la clé de cache : `Bolt` et `bolt ` doivent
// produire la même clé ; l'ordre des filtres ne doit pas en créer une
// nouvelle.
import { describe, expect, it } from 'vitest'

import { searchCacheKey } from '@/lib/search/normalize'

describe('lib/search/normalize', () => {
  it('produces the same cache key regardless of casing and surrounding whitespace', () => {
    expect(searchCacheKey({ query: 'Bolt' })).toBe(searchCacheKey({ query: 'bolt ' }))
    expect(searchCacheKey({ query: '  bolt  strike  ' })).toBe(
      searchCacheKey({ query: 'bolt strike' }),
    )
  })

  it('produces the same cache key regardless of filter array order', () => {
    const a = searchCacheKey({ query: 'bolt', filters: { colors: ['R', 'U'] } })
    const b = searchCacheKey({ query: 'bolt', filters: { colors: ['U', 'R'] } })
    expect(a).toBe(b)
  })

  it('produces different cache keys for different filters or cursors', () => {
    const base = searchCacheKey({ query: 'bolt' })
    expect(searchCacheKey({ query: 'bolt', filters: { colors: ['R'] } })).not.toBe(base)
    expect(searchCacheKey({ query: 'bolt', cursor: 'abc' })).not.toBe(base)
    expect(searchCacheKey({ query: 'bolt', limit: 10 })).not.toBe(base)
  })

  it('is prefixed with the versioned search namespace', () => {
    // v4 : `colorSpread` a rejoint les filtres et le
    // groupement par nom change la forme des résultats — une entrée `v3` ne
    // doit plus jamais être relue sous cette forme périmée (voir le
    // commentaire de tête de `lib/search/normalize.ts`).
    expect(searchCacheKey({ query: 'bolt' })).toMatch(/^search:v8:[0-9a-f]{64}$/)
  })
})
