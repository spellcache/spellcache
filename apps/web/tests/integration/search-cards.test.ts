// Test d'intégration de la recherche : pertinence, tolérance aux
// fautes de frappe, filtres de couleur, pagination par curseur, curseur
// invalide, plan d'exécution (GIN, aucun Seq Scan), et cache. Contre la base
// éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ; se
// saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
//
// `@/lib/redis` est mocké par un cache mémoire — le service `redis` de
// docker-compose.yml n'est jamais démarré par `pnpm test` (seul le profil
// `test`/`postgres-test` l'est), donc la seule façon de prouver "un cache hit
// évite une requête SQL" indépendamment de l'infrastructure locale est de
// simuler le contrat de `lib/redis.ts` (déjà couvert isolément par
// tests/unit/redis.test.ts).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const memoryCache = new Map<string, string>()

vi.mock('@/lib/redis', () => ({
  cacheGet: vi.fn(async (key: string) => memoryCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, value: string) => {
    memoryCache.set(key, value)
  }),
}))

describe.skipIf(!process.env.TEST_DATABASE_URL)('lib/search/search-cards', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/lib/search/search-cards`
  // (donc de `@spellcache/db`, singleton créé à l'évaluation du module — même
  // contrainte que tests/unit/card-image-route.test.ts).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let searchCards: typeof import('@/lib/search/search-cards').searchCards
  let InvalidCursorError: typeof import('@/lib/search/cursor').InvalidCursorError
  let db: typeof import('@spellcache/db').db
  let cacheGet: ReturnType<typeof vi.fn>

  const SET_CODE = 'tst'

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ searchCards } = await import('@/lib/search/search-cards'))
    ;({ InvalidCursorError } = await import('@/lib/search/cursor'))
    ;({ db } = await import('@spellcache/db'))
    ;({ cacheGet } = (await import('@/lib/redis')) as unknown as { cacheGet: ReturnType<typeof vi.fn> })
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  beforeEach(async () => {
    memoryCache.clear()
    vi.clearAllMocks()

    await pool.query(
      `INSERT INTO sets (code, name, card_count, set_type) VALUES ($1, $2, 0, 'expansion')
       ON CONFLICT (code) DO NOTHING`,
      [SET_CODE, 'Test Set'],
    )

    // Échantillon : trois cartes "Lightning" mono-rouges dont une seule porte
    // les deux tokens `lightning`/`bolt`, une bicolore RW (exclue par
    // colorMatch=exactly), et cinq cartes rouges supplémentaires pour la
    // pagination.
    const cards: Array<{
      name: string
      rarity: string
      typeLine: string
      colors: string[]
    }> = [
      { name: 'Lightning Bolt', rarity: 'common', typeLine: 'Instant', colors: ['R'] },
      { name: 'Lightning Strike', rarity: 'common', typeLine: 'Instant', colors: ['R'] },
      { name: 'Chain Lightning', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
      { name: 'Lightning Helix', rarity: 'uncommon', typeLine: 'Instant', colors: ['R', 'W'] },
      { name: 'Giant Growth', rarity: 'common', typeLine: 'Instant', colors: ['G'] },
      { name: 'Counterspell', rarity: 'common', typeLine: 'Instant', colors: ['U'] },
      { name: 'Red Alpha', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
      { name: 'Red Bravo', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
      { name: 'Red Charlie', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
      { name: 'Red Delta', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
      { name: 'Red Echo', rarity: 'common', typeLine: 'Sorcery', colors: ['R'] },
    ]

    let collectorNumber = 1
    for (const card of cards) {
      await pool.query(
        `INSERT INTO cards (
          id, oracle_id, name, set_code, collector_number, rarity, mana_cost, cmc,
          type_line, oracle_text, colors, color_identity, finishes, image_uris,
          legalities, artist
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          randomUUID(),
          randomUUID(),
          card.name,
          SET_CODE,
          String(collectorNumber++),
          card.rarity,
          `{${card.colors[0]}}`,
          1,
          card.typeLine,
          null,
          card.colors,
          card.colors,
          ['nonfoil'],
          null,
          {},
          null,
        ],
      )
    }
  })

  afterEach(async () => {
    await pool.query('TRUNCATE card_prices, cards, sets, import_runs CASCADE')
  })

  it('ranks an exact-ish match first', async () => {
    const result = await searchCards({ query: 'lightning bolt' })
    expect(result.items[0]?.name).toBe('Lightning Bolt')
  })

  // Correspondance stricte sur le nom (décision produit du 2026-09-01, voir
  // lib/search/search-cards.ts) : chaque mot doit figurer dans le nom, dans
  // n'importe quel ordre ; la similarité trigramme ne sert plus qu'au
  // classement. Contrepartie assumée : une faute de frappe ne trouve rien.
  it('matches every word of the query in the name, in any order, and no longer tolerates typos', async () => {
    const strict = await searchCards({ query: 'bolt light' })
    expect(strict.items.map((item) => item.name)).toEqual(['Lightning Bolt'])

    const typo = await searchCards({ query: 'lighming bolt' })
    expect(typo.items.map((item) => item.name)).not.toContain('Lightning Bolt')
  })

  it('filters on an exact color identity', async () => {
    const result = await searchCards({
      query: '',
      filters: { colors: ['R'], colorMatch: 'exactly' },
    })

    expect(result.items.length).toBeGreaterThan(0)
    const names = result.items.map((item) => item.name)
    expect(names).not.toContain('Lightning Helix') // RW, exclu
    expect(names).not.toContain('Giant Growth') // G
    expect(names).not.toContain('Counterspell') // U
    expect(names).toContain('Lightning Bolt')
  })

  it('paginates by cursor without overlap or gaps', async () => {
    const params = { query: '', filters: { colors: ['R' as const], colorMatch: 'exactly' as const } }

    const page1 = await searchCards({ ...params, limit: 3 })
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await searchCards({ ...params, limit: 3, cursor: page1.nextCursor })

    const page1Ids = page1.items.map((item) => item.id)
    const page2Ids = page2.items.map((item) => item.id)
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(page1Ids.length + page2Ids.length)

    const doubled = await searchCards({ ...params, limit: 6 })
    expect([...page1Ids, ...page2Ids]).toEqual(doubled.items.map((item) => item.id))
  })

  it('rejects an invalid cursor with InvalidCursorError instead of a raw 500', async () => {
    await expect(searchCards({ query: 'bolt', cursor: 'nimportequoi' })).rejects.toThrow(
      InvalidCursorError,
    )
  })

  it('uses the search_vector GIN index, never a Seq Scan on cards', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Une table de onze lignes est trop petite pour que le planificateur
      // choisisse spontanément un index — on désactive le Seq Scan pour
      // prouver qu'un plan indexé existe (l'index GIN est bien utilisable sur
      // un catalogue réel d'environ 110 000 lignes).
      await client.query('SET LOCAL enable_seqscan = off')
      const { rows } = await client.query(
        `EXPLAIN SELECT cards.id FROM cards
         WHERE cards.search_vector @@ plainto_tsquery('simple', $1)
            OR cards.name % $1`,
        ['lightning bolt'],
      )
      const plan = rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']).join('\n')
      expect(plan).not.toMatch(/Seq Scan/)
      expect(plan).toMatch(/cards_search_vector_idx|cards_name_trgm_idx/)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('serves a second identical call from cache without hitting Postgres again', async () => {
    const spy = vi.spyOn(db, 'execute')
    const callsBefore = spy.mock.calls.length

    await searchCards({ query: 'lightning' })
    const callsAfterFirst = spy.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(callsBefore)

    await searchCards({ query: 'lightning' })
    const callsAfterSecond = spy.mock.calls.length
    expect(callsAfterSecond).toBe(callsAfterFirst)

    spy.mockRestore()
  })

  it('still succeeds on repeated identical calls when the cache is unavailable', async () => {
    cacheGet.mockResolvedValue(null)

    const first = await searchCards({ query: 'lightning' })
    const second = await searchCards({ query: 'lightning' })

    expect(first.items.length).toBeGreaterThan(0)
    expect(second.items).toEqual(first.items)
  })
})
