// Test d'intégration : chaque filtre de `HoldingFilters` isolément (couleurs
// — les trois régimes `including` / `exactly` / `atMost` — type, rareté,
// finish, condition, set, prix) et le compte annoncé par `countHoldings`,
// contre la même clause `WHERE` que `listHoldings` (un seul point de
// construction). Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible) — voir
// tests/integration/holdings.test.ts pour le même patron.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { EMPTY_FILTERS } from '@/lib/view-state/parse'
import type { HoldingFilters } from '@/lib/view-state/parse'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Command bar filters', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let listHoldings: typeof import('@/app/(app)/container/[id]/holdings-data').listHoldings
  let countHoldings: typeof import('@/app/(app)/container/[id]/holdings-data').countHoldings
  let getContainerHeader: typeof import('@/app/(app)/container/[id]/holdings-data').getContainerHeader
  // Renommé pour ne pas heurter le `createContainer` local ci-dessous
  // (compte + collection + container racine) — celui-ci crée un CONTAINER au
  // sens large (binder/deck/liste), point de départ des tests de périmètre élargi.
  let createBinder: typeof import('@/lib/containers/containers').createContainer
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ listHoldings, countHoldings, getContainerHeader } = await import(
      '@/app/(app)/container/[id]/holdings-data'
    ))
    ;({ createContainer: createBinder } = await import('@/lib/containers/containers'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(
      'TRUNCATE holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE',
    )
  })

  async function createContainer(
    username: string,
  ): Promise<{ userId: string; collectionId: string; containerId: string }> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    const userId = row!.id
    const { containerId, collectionId } = await bootstrapCollection(userId, { username, displayName: null })
    return { userId, collectionId, containerId }
  }

  async function insertCard(opts: {
    id: string
    name: string
    setCode: string
    rarity?: string
    typeLine?: string
    colors?: string[]
    finishes?: string[]
  }): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
      [opts.setCode],
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, $4, '1', $5, 0, $6, $7, $7, $8, '{}')`,
      [
        opts.id,
        randomUUID(),
        opts.name,
        opts.setCode,
        opts.rarity ?? 'common',
        opts.typeLine ?? 'Creature',
        opts.colors ?? [],
        opts.finishes ?? ['nonfoil', 'foil'],
      ],
    )
  }

  async function seedHolding(
    userId: string,
    containerId: string,
    card: { id: string; name: string; setCode: string; rarity?: string; typeLine?: string; colors?: string[] },
    holdingOpts: { finish?: 'nonfoil' | 'foil' | 'etched'; condition?: 'nm' | 'lp' | 'mp' | 'hp' | 'dmg' } = {},
  ): Promise<void> {
    await insertCard(card)
    await addHolding(
      userId,
      {
        containerId,
        cardId: card.id,
        finish: holdingOpts.finish ?? 'nonfoil',
        condition: holdingOpts.condition ?? 'nm',
        language: 'en',
      },
      1,
    )
  }

  async function listNames(
    userId: string,
    containerId: string,
    filters: Partial<HoldingFilters>,
  ): Promise<string[]> {
    const page = await listHoldings(userId, containerId, { filters: { ...EMPTY_FILTERS, ...filters } })
    return page.items.map((item) => item.name).sort()
  }

  it('colour regimes: including (superset), exactly (equality), atMost (subset incl. colourless)', async () => {
    const { userId, containerId } = await createContainer('colourist')

    const monoRed = randomUUID()
    const boros = randomUUID()
    const colourless = randomUUID()
    const monoBlue = randomUUID()

    await seedHolding(userId, containerId, { id: monoRed, name: 'Mono Red', setCode: 'lea', colors: ['R'] })
    await seedHolding(userId, containerId, { id: boros, name: 'Boros Card', setCode: 'lea', colors: ['R', 'W'] })
    await seedHolding(userId, containerId, { id: colourless, name: 'Colourless Card', setCode: 'lea', colors: [] })
    await seedHolding(userId, containerId, { id: monoBlue, name: 'Mono Blue', setCode: 'lea', colors: ['U'] })

    await expect(
      listNames(userId, containerId, { colors: ['R'], colorMatch: 'exactly' }),
    ).resolves.toEqual(['Mono Red'])

    await expect(
      listNames(userId, containerId, { colors: ['R'], colorMatch: 'atMost' }),
    ).resolves.toEqual(['Colourless Card', 'Mono Red'])

    await expect(
      listNames(userId, containerId, { colors: ['R'], colorMatch: 'including' }),
    ).resolves.toEqual(['Boros Card', 'Mono Red'])
  })

  it('filters by type (ilike on type_line)', async () => {
    const { userId, containerId } = await createContainer('typist')
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'A Creature', setCode: 'lea', typeLine: 'Legendary Creature — Human' })
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'An Instant', setCode: 'lea', typeLine: 'Instant' })

    await expect(listNames(userId, containerId, { types: ['Creature'] })).resolves.toEqual(['A Creature'])
  })

  it('filters by rarity, finish and condition independently', async () => {
    const { userId, containerId } = await createContainer('rarist')
    const rare = randomUUID()
    const common = randomUUID()
    await seedHolding(userId, containerId, { id: rare, name: 'Rare Card', setCode: 'lea', rarity: 'rare' })
    await seedHolding(userId, containerId, { id: common, name: 'Common Card', setCode: 'lea', rarity: 'common' }, { finish: 'foil', condition: 'lp' })

    await expect(listNames(userId, containerId, { rarities: ['rare'] })).resolves.toEqual(['Rare Card'])
    await expect(listNames(userId, containerId, { finishes: ['foil'] })).resolves.toEqual(['Common Card'])
    await expect(listNames(userId, containerId, { conditions: ['lp'] })).resolves.toEqual(['Common Card'])
  })

  it('filters by set code', async () => {
    const { userId, containerId } = await createContainer('setist')
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'From LEA', setCode: 'lea' })
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'From KTK', setCode: 'ktk' })

    await expect(listNames(userId, containerId, { setCode: 'ktk' })).resolves.toEqual(['From KTK'])
  })

  it('filters by price range in minor units', async () => {
    const { userId, containerId } = await createContainer('pricer')
    const cheap = randomUUID()
    const expensive = randomUUID()
    await insertCard({ id: cheap, name: 'Cheap Card', setCode: 'lea' })
    await insertCard({ id: expensive, name: 'Expensive Card', setCode: 'lea' })
    await addHolding(userId, { containerId, cardId: cheap, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await addHolding(userId, { containerId, cardId: expensive, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, null, $3, null)`,
      [cheap, 1, 0.9],
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, null, $3, null)`,
      [expensive, 50, 45],
    )

    // Devise par défaut : `cardmarket_eur`, filtre en centimes d'euro.
    await expect(
      listNames(userId, containerId, { priceMaxMinor: 200 }),
    ).resolves.toEqual(['Cheap Card'])
    await expect(
      listNames(userId, containerId, { priceMinMinor: 1000 }),
    ).resolves.toEqual(['Expensive Card'])
  })

  it('countHoldings matches the number of items listHoldings returns for the same filters', async () => {
    const { userId, containerId } = await createContainer('counter')
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'One', setCode: 'lea', rarity: 'rare' })
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'Two', setCode: 'lea', rarity: 'rare' })
    await seedHolding(userId, containerId, { id: randomUUID(), name: 'Three', setCode: 'lea', rarity: 'common' })

    const filters: HoldingFilters = { ...EMPTY_FILTERS, rarities: ['rare'] }
    const count = await countHoldings(userId, containerId, { filters })
    const page = await listHoldings(userId, containerId, { filters })

    expect(count).toBe(2)
    expect(page.items).toHaveLength(2)
  })

  // « All collection » (le container racine) liste aussi les cartes rangées
  // dans un binder, et `binderId` filtre réellement `holdings.container_id`
  // (voir le commentaire de tête de `listHoldings`, `holdings-data.ts`). Un
  // binder ouvert directement reste, lui, un seul container.
  describe('périmètre élargi de la racine et filtre Binder', () => {
    it('lists loose root cards AND binder cards together on the root container, never on a binder', async () => {
      const { userId, collectionId, containerId: rootId } = await createContainer('rooter')
      const binder = await createBinder(userId, collectionId, { kind: 'binder', name: 'Vintage cube' })

      await seedHolding(userId, rootId, { id: randomUUID(), name: 'Loose Card', setCode: 'lea' })
      await seedHolding(userId, binder.id, { id: randomUUID(), name: 'Binder Card', setCode: 'lea' })

      const rootPage = await listHoldings(userId, rootId, { filters: EMPTY_FILTERS })
      expect(rootPage.items.map((item) => item.name).sort()).toEqual(['Binder Card', 'Loose Card'])
      expect(await countHoldings(userId, rootId, { filters: EMPTY_FILTERS })).toBe(2)

      // Un binder ouvert directement ne montre toujours QUE ses propres
      // holdings — jamais le vrac de la racine.
      const binderPage = await listHoldings(userId, binder.id, { filters: EMPTY_FILTERS })
      expect(binderPage.items.map((item) => item.name)).toEqual(['Binder Card'])
    })

    it('carries the owning binder name on each row, null for a loose root row', async () => {
      const { userId, collectionId, containerId: rootId } = await createContainer('binderrower')
      const binder = await createBinder(userId, collectionId, { kind: 'binder', name: 'Vintage cube' })

      await seedHolding(userId, rootId, { id: randomUUID(), name: 'Loose Card', setCode: 'lea' })
      await seedHolding(userId, binder.id, { id: randomUUID(), name: 'Binder Card', setCode: 'lea' })

      const page = await listHoldings(userId, rootId, { filters: EMPTY_FILTERS })
      const loose = page.items.find((item) => item.name === 'Loose Card')
      const inBinder = page.items.find((item) => item.name === 'Binder Card')
      expect(loose?.binderName).toBeNull()
      expect(inBinder?.binderName).toBe('Vintage cube')
    })

    it('filters the root view to a specific binder, or to the root itself for "No binder"', async () => {
      const { userId, collectionId, containerId: rootId } = await createContainer('binderfilterer')
      const binder = await createBinder(userId, collectionId, { kind: 'binder', name: 'Vintage cube' })

      await seedHolding(userId, rootId, { id: randomUUID(), name: 'Loose Card', setCode: 'lea' })
      await seedHolding(userId, binder.id, { id: randomUUID(), name: 'Binder Card', setCode: 'lea' })

      await expect(
        listNames(userId, rootId, { binderId: binder.id }),
      ).resolves.toEqual(['Binder Card'])
      // La racine elle-même filtre au vrac seul (« No binder », vue de
      // `listHoldingBindersAction`).
      await expect(listNames(userId, rootId, { binderId: rootId })).resolves.toEqual(['Loose Card'])
      // Un id hors périmètre (une autre collection) ne peut jamais élargir
      // l'accès, seulement le restreindre à rien.
      await expect(listNames(userId, rootId, { binderId: randomUUID() })).resolves.toEqual([])
    })

    it('sums root + binder container_stats into the root header, leaving a binder header untouched', async () => {
      const { userId, collectionId, containerId: rootId } = await createContainer('headersummer')
      const binder = await createBinder(userId, collectionId, { kind: 'binder', name: 'Vintage cube' })

      await seedHolding(userId, rootId, { id: randomUUID(), name: 'Loose Card', setCode: 'lea' })
      await seedHolding(userId, binder.id, { id: randomUUID(), name: 'Binder Card', setCode: 'lea' })
      await seedHolding(userId, binder.id, { id: randomUUID(), name: 'Second Binder Card', setCode: 'lea' })

      const rootHeader = await getContainerHeader(userId, rootId)
      expect(rootHeader.cardCount).toBe(3)
      expect(rootHeader.uniqueCount).toBe(3)

      // Le binder ouvert directement ne rend, lui, que ses propres compteurs,
      // jamais élargis à la racine.
      const binderHeader = await getContainerHeader(userId, binder.id)
      expect(binderHeader.cardCount).toBe(2)
      expect(binderHeader.uniqueCount).toBe(2)
    })
  })

  // Régression : `countHoldings` joignait `holdings` et
  // `cards` sans le `left join lateral ... as p` que `buildWhereConditions`
  // suppose pour le filtre Price (`p.eur`/`p.usd`). Tout recompte avec un
  // prix min ou max levait Postgres 42P01 (« missing FROM-clause entry for
  // table "p" ») — cette requête plante avant le correctif, résout après
  // (une seule requête, construite en un point).
  it('countHoldings does not throw with a Price filter (Show N cards recount)', async () => {
    const { userId, containerId } = await createContainer('pricecounter')
    const cheap = randomUUID()
    const expensive = randomUUID()
    await insertCard({ id: cheap, name: 'Cheap Card', setCode: 'lea' })
    await insertCard({ id: expensive, name: 'Expensive Card', setCode: 'lea' })
    await addHolding(userId, { containerId, cardId: cheap, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await addHolding(
      userId,
      { containerId, cardId: expensive, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, null, $3, null)`,
      [cheap, 1, 0.9],
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, null, $3, null)`,
      [expensive, 50, 45],
    )

    await expect(
      countHoldings(userId, containerId, { filters: { ...EMPTY_FILTERS, priceMaxMinor: 200 } }),
    ).resolves.toBe(1)
    await expect(
      countHoldings(userId, containerId, { filters: { ...EMPTY_FILTERS, priceMinMinor: 1000 } }),
    ).resolves.toBe(1)
    await expect(
      countHoldings(userId, containerId, {
        filters: { ...EMPTY_FILTERS, priceMinMinor: 0, priceMaxMinor: 10000 },
      }),
    ).resolves.toBe(2)
  })

  // Régression : `groupExprs('set')` renvoie
  // `cards.set_code` (texte) comme `group_rank`, mais `cursorSchema`
  // n'acceptait qu'un `number` — le curseur de la première page était donc
  // rejeté (`InvalidHoldingCursorError` → `{ error: 'invalid_cursor' }` côté
  // `listHoldingsAction`), et la liste s'arrêtait en silence à la première
  // page. Cinq cartes, `limit: 2`, groupées par `set` : sans le correctif,
  // la deuxième page échoue déjà.
  it('paginates past the first page when grouped by set', async () => {
    const { userId, containerId } = await createContainer('setgrouper')
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    for (const name of names) {
      await seedHolding(userId, containerId, { id: randomUUID(), name, setCode: 'lea' })
    }

    const collected: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await listHoldings(userId, containerId, {
        filters: EMPTY_FILTERS,
        groupBy: 'set',
        cursor,
        limit: 2,
      })
      collected.push(...page.items.map((item) => item.name))
      cursor = page.nextCursor
      pages += 1
      expect(pages).toBeLessThan(10) // garde-fou anti-boucle infinie
    } while (cursor)

    expect(collected.sort()).toEqual(names.slice().sort())
    expect(pages).toBeGreaterThan(1)
  })
})
