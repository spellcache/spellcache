// Barrière de rendu SQL.
//
// Un tableau JS interpolé dans un gabarit `sql` de Drizzle est rendu comme
// une liste de placeholders séparés par des virgules, que Postgres lit comme
// un constructeur de ligne : `any(($1, $2, $3)::text[])` échoue avec
// `cannot cast type record to text[]`, et `any(($1)::text[])` avec
// `malformed array literal`. Le défaut est invisible à la lecture et
// invisible aux tests tant que Postgres ne tourne pas — or aucun démon
// Docker n'existe dans cet environnement.
//
// Ce fichier rend donc chaque requête concernée par le `PgDialect` du dépôt
// et échoue sur le motif fautif. Aucune base n'est ouverte : `@spellcache/db` est
// remplacé par un espion qui capture le gabarit et rend zéro ligne.
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_FILTERS, type HoldingFilters } from '@/lib/view-state/parse'

const captured = vi.hoisted(() => ({ queries: [] as unknown[] }))

vi.mock('@spellcache/db', () => ({
  db: {
    execute: (query: unknown) => {
      captured.queries.push(query)
      return Promise.resolve({ rows: [], rowCount: 0 })
    },
    // `searchDeckCards` résout la devise du compte par un `db.select` avant
    // sa requête principale — un stub vide suffit, la devise retombe alors
    // sur le défaut et n'entre pas dans ce que ce fichier vérifie (le rendu
    // des paramètres tableau).
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}))

// Le cache de recherche n'a rien à voir avec le rendu SQL : neutralisé
// pour que `searchCards` atteigne toujours la requête.
vi.mock('@/lib/redis', () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
}))

vi.mock('@/lib/collections/authorize', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/collections/authorize')>()
  return {
    ...original,
    resolveAccess: async () => ({ collectionId: COLLECTION_ID, role: 'owner' as const }),
    requireContainerAccess: async () => ({ collectionId: COLLECTION_ID, role: 'owner' as const }),
  }
})

// Seul `getDeck` est remplacé : `searchDeckCards`, testé plus bas, reste la
// vraie fonction du module.
vi.mock('@/app/(app)/decks/[id]/deck-data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/app/(app)/decks/[id]/deck-data')>()
  return {
    ...original,
    getDeck: async () => ({
      ...EMPTY_DECK,
      slots: [slot(CARD_IDS[0]!), slot(CARD_IDS[1]!), slot(CARD_IDS[2]!)],
    }),
  }
})

const COLLECTION_ID = '11111111-1111-4111-8111-111111111111'
const DECK_ID = '22222222-2222-4222-8222-222222222222'
const CARD_IDS = [
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332',
  '33333333-3333-4333-8333-333333333333',
]

type DeckDetail = import('@/app/(app)/decks/[id]/deck-data').DeckDetail
type DeckSlot = import('@/app/(app)/decks/[id]/deck-data').DeckSlot

function slot(cardId: string): DeckSlot {
  return {
    holdingId: cardId,
    cardId,
    name: 'Card',
    manaCost: null,
    setLine: 'TST #1',
    need: 1,
    ownedElsewhere: 0,
    state: 'missing',
    priceMinor: null,
    zone: 'main',
    thumbUrl: '',
  }
}

const EMPTY_DECK: DeckDetail = {
  id: DECK_ID,
  name: 'Deck',
  format: 'commander',
  formatRaw: 'commander',
  deckState: 'plan',
  colorIdentity: ['W', 'U'],
  builderColorIdentity: ['W', 'U'],
  commander: null,
  commanderArtist: null,
  slots: [],
  coverage: { owned: 0, total: 0, missing: 0, toBuyMinor: 0 },
  manaCurve: [],
  colorPips: [],
  stats: { totalCards: 0, avgCmc: 0, lands: 0, nonlands: 0 },
  description: '',
  status: { kind: 'noFormat', label: 'No format set', issues: [] },
}

const dialect = new PgDialect()

// Un tableau casté doit toujours l'être sur un placeholder unique
// (`$1::text[]`) ou sur un littéral vide (`ARRAY[]::text[]`). Un `)::text[]`
// signale un constructeur de ligne, c'est-à-dire le défaut.
const ROW_CONSTRUCTOR_CAST = /\)::(?:text|uuid|int)\[\]/
const ARRAY_CONTEXT_ROW_CONSTRUCTOR = /(?:any|unnest)\s*\(\s*\(/
const ANY_ARRAY_CAST = /::(?:text|uuid|int)\[\]/g
const SOUND_ARRAY_CAST = /(?:\$(\d+)|ARRAY\[\])::(?:text|uuid|int)\[\]/g

function expectRealArrayParams(query: SQL, label: string): void {
  const { sql: text, params } = dialect.sqlToQuery(query)
  const context = `${label}\n${text}`

  expect(ROW_CONSTRUCTOR_CAST.test(text), context).toBe(false)
  expect(ARRAY_CONTEXT_ROW_CONSTRUCTOR.test(text), context).toBe(false)

  const total = text.match(ANY_ARRAY_CAST) ?? []
  const sound = [...text.matchAll(SOUND_ARRAY_CAST)]
  // Aucun cast de tableau ne doit échapper à la forme saine.
  expect(sound.length, context).toBe(total.length)
  expect(total.length, context).toBeGreaterThan(0)

  for (const match of sound) {
    if (!match[1]) continue
    const value = params[Number(match[1]) - 1]
    expect(Array.isArray(value), `${context}\nparam $${match[1]} = ${JSON.stringify(value)}`).toBe(
      true,
    )
  }
}

function takeQueries(): SQL[] {
  const queries = captured.queries as SQL[]
  captured.queries = []
  return queries
}

function filters(overrides: Partial<HoldingFilters>): HoldingFilters {
  return { ...EMPTY_FILTERS, ...overrides }
}

beforeEach(() => {
  captured.queries = []
})

describe('le détecteur lui-même', () => {
  it('échoue sur le motif fautif, à trois éléments comme à un seul', async () => {
    const { sql } = await import('drizzle-orm')

    expect(() =>
      expectRealArrayParams(sql`select 1 where x = any(${['a', 'b', 'c']}::text[])`, 'fautif'),
    ).toThrow()
    expect(() =>
      expectRealArrayParams(sql`select 1 where x = any(${['a']}::text[])`, 'fautif'),
    ).toThrow()
    expect(() =>
      expectRealArrayParams(sql`select * from unnest(${['a', 'b']}::uuid[]) as q`, 'fautif'),
    ).toThrow()
    expect(() =>
      expectRealArrayParams(sql`select 1 where c @> ${['W', 'U']}::text[]`, 'fautif'),
    ).toThrow()
  })

  it('accepte la forme saine', async () => {
    const { textArray, uuidArray } = await import('@spellcache/db/array-param')
    const { sql } = await import('drizzle-orm')

    expectRealArrayParams(sql`select 1 where x = any(${textArray(['a', 'b'])})`, 'sain')
    expectRealArrayParams(sql`select 1 where x = any(${textArray(['a'])})`, 'sain')
    expectRealArrayParams(sql`select * from unnest(${uuidArray(CARD_IDS)}) as q`, 'sain')
  })
})

describe('lib/lists/resolve-list.ts — resolveList', () => {
  it('rend ses deux requêtes avec de vrais paramètres tableau', async () => {
    const { resolveList } = await import('@/lib/lists/resolve-list')
    const { parseList } = await import('@/lib/lists/parse-list')

    // Aucune ligne du catalogue ne revient (l'espion rend zéro ligne) : les
    // deux noms deviennent inconnus, ce qui déclenche aussi la requête de
    // repli trigramme.
    await resolveList(parseList('4 Lightning Bolt\n1 Sol Ring').lines)

    const queries = takeQueries()
    expect(queries).toHaveLength(2)
    expectRealArrayParams(queries[0]!, 'resolveList — correspondance exacte')
    expectRealArrayParams(queries[1]!, 'resolveList — repli trigramme')
  })

  it('reste sain avec un seul nom, le cas où la parenthèse disparaît', async () => {
    const { resolveList } = await import('@/lib/lists/resolve-list')
    const { parseList } = await import('@/lib/lists/parse-list')

    await resolveList(parseList('1 Sol Ring').lines)

    for (const query of takeQueries()) expectRealArrayParams(query, 'resolveList — un seul nom')
  })
})

describe('lib/search/search-cards.ts — searchCards', () => {
  const colorMatches = ['including', 'exactly', 'atMost'] as const

  for (const colorMatch of colorMatches) {
    it(`rend les filtres de rareté et de couleur (${colorMatch}) avec de vrais paramètres tableau`, async () => {
      const { searchCards } = await import('@/lib/search/search-cards')

      await searchCards({
        query: 'bolt',
        filters: { colors: ['W', 'U'], colorMatch, rarities: ['rare', 'mythic'] },
      })

      const queries = takeQueries()
      expect(queries).toHaveLength(1)
      expectRealArrayParams(queries[0]!, `searchCards — ${colorMatch}`)
    })
  }
})

describe('app/(app)/container/[id]/holdings-data.ts — buildWhereConditions', () => {
  const cases: Array<[string, HoldingFilters]> = [
    ['rareté', filters({ rarities: ['rare'] })],
    ['finition', filters({ finishes: ['foil'] })],
    ['état', filters({ conditions: ['nm', 'lp'] })],
    ['couleurs including', filters({ colors: ['W', 'U'], colorMatch: 'including' })],
    ['couleurs exactly', filters({ colors: ['W', 'U'], colorMatch: 'exactly' })],
    ['couleurs atMost', filters({ colors: ['W'], colorMatch: 'atMost' })],
  ]

  for (const [label, filter] of cases) {
    it(`rend le filtre ${label} avec de vrais paramètres tableau`, async () => {
      const { buildWhereConditions } = await import('@/app/(app)/container/[id]/holdings-data')
      const { sql } = await import('drizzle-orm')

      const conditions = buildWhereConditions({
        containerId: COLLECTION_ID,
        query: '',
        filters: filter,
        currency: 'eur',
      })

      expectRealArrayParams(sql.join(conditions, sql` and `), `buildWhereConditions — ${label}`)
    })
  }
})

describe('app/(app)/decks/[id]/deck-data.ts — searchDeckCards', () => {
  it('rend `Legal in deck colours` avec de vrais paramètres tableau', async () => {
    const { searchDeckCards } = await import('@/app/(app)/decks/[id]/deck-data')

    await searchDeckCards('user', DECK_ID, ['W', 'U'], { query: 'bolt', legalInColours: true, ownedOnly: false })

    const queries = takeQueries()
    expect(queries).toHaveLength(1)
    expectRealArrayParams(queries[0]!, 'searchDeckCards — legalInColours')
  })
})

describe('lib/decks — availabilityMap et loadBorrowSources', () => {
  it('rend la carte de disponibilité avec de vrais paramètres tableau', async () => {
    const { availabilityMap } = await import('@/lib/decks/availability')

    await availabilityMap(COLLECTION_ID, CARD_IDS)

    const queries = takeQueries()
    expect(queries).toHaveLength(1)
    expectRealArrayParams(queries[0]!, 'availabilityMap')
  })

  it('rend les sources d’emprunt avec de vrais paramètres tableau', async () => {
    const { planAssembly } = await import('@/lib/decks/assemble')

    await planAssembly('user', DECK_ID, {
      fromLooseCollection: true,
      fromOtherBuiltDecks: true,
    })

    // `planAssembly` émet la disponibilité ET les sources d'emprunt : les
    // deux passent par un tableau d'`uuid`.
    const queries = takeQueries()
    expect(queries.length).toBeGreaterThanOrEqual(2)
    for (const [index, query] of queries.entries()) {
      expectRealArrayParams(query, `planAssembly — requête ${index}`)
    }
  })
})
