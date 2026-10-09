// Test d'intégration : composition des
// étagères de `getCollectionShelves` — dédup/tri des tuiles, marque
// `notOwned` des listes, agrégat `Built decks`, `Recently added`, budget de
// requêtes SQL et cloisonnement par collection. Même patron que
// `tests/integration/collection-home.test.ts` : base éphémère
// `postgres-test`, se saute lui-même si `TEST_DATABASE_URL` n'est pas exposé
// (Docker indisponible).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Collection Shelves data', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let getCollectionShelves: typeof import('@/app/(app)/collection/collection-data').getCollectionShelves
  let BUILT_DECKS_SHELF_ID: typeof import('@/app/(app)/collection/collection-data').BUILT_DECKS_SHELF_ID

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ getCollectionShelves, BUILT_DECKS_SHELF_ID } = await import('@/app/(app)/collection/collection-data'))
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

  async function createUser(username: string, priceSource: 'tcgplayer_usd' | 'cardmarket_eur' = 'tcgplayer_usd') {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username, priceSource })
      .returning({ id: users.id })
    return row!.id
  }

  async function insertCard(id: string, name: string, usd: number): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('lea', 'lea', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, 'lea', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [id, randomUUID(), name],
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, $2, $2, $2)`,
      [id, usd],
    )
  }

  let queryCount = 0
  let originalQuery: typeof Pool.prototype.query

  beforeEach(() => {
    queryCount = 0
    originalQuery = Pool.prototype.query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
    Pool.prototype.query = function (this: any, ...args: unknown[]) {
      queryCount += 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
      return (originalQuery as any).apply(this, args)
    } as typeof Pool.prototype.query
  })

  afterEach(() => {
    Pool.prototype.query = originalQuery
  })

  // Une étagère montre ses ajouts les plus récents, jamais un classement de
  // valeur, et ne déduplique pas par carte : deux holdings récents de la
  // même carte restent deux tuiles.
  it('caps shelf tiles at 6, most-recently-added first, never by value, within 3 SQL statements', async () => {
    const userId = await createUser('shelfowner')
    const { containerId: rootId, collectionId } = await bootstrapCollection(userId, {
      username: 'shelfowner',
      displayName: null,
    })

    // 8 cartes distinctes, prix DÉCROISSANT avec l'index alors que l'ajout
    // est croissant (`hours = 7 - i`, la plus récente en dernier) : si les
    // tuiles suivaient encore le prix, l'ordre observé serait inversé.
    const cardIds: string[] = []
    for (let i = 0; i < 8; i += 1) {
      const cardId = randomUUID()
      cardIds.push(cardId)
      await insertCard(cardId, `Card ${i}`, 8 - i)
      const { holdingId } = await addHolding(
        userId,
        { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        1,
      )
      await pool.query(`update holdings set added_at = now() - ($1 || ' hours')::interval where id = $2`, [
        7 - i,
        holdingId,
      ])
    }
    // Un second holding de la carte la plus récente (finish distinct),
    // ajouté après la boucle — sa propre `added_at` par défaut la place donc
    // encore devant : jamais dédupliquée, deux tuiles distinctes pour la
    // même carte.
    await addHolding(
      userId,
      { containerId: rootId, cardId: cardIds[7]!, finish: 'foil', condition: 'nm', language: 'en' },
      1,
    )

    queryCount = 0
    const result = await getCollectionShelves(userId)
    expect(queryCount).toBeLessThanOrEqual(3)

    const allCollection = result.shelves.find((s) => s.containerId === rootId)
    expect(allCollection).toBeDefined()
    expect(allCollection!.tiles).toHaveLength(6)
    // Le doublon de Card 7 (ajouté après coup) d'abord, puis Card 7..3 en
    // ordre de récence décroissante — jamais Card 0..2, les plus anciennes.
    expect(allCollection!.tiles.map((t) => t.cardId)).toEqual([
      cardIds[7],
      cardIds[7],
      cardIds[6],
      cardIds[5],
      cardIds[4],
      cardIds[3],
    ])

    void collectionId
  })

  it('marks list containers notOwned and binders not, both fed by the same container_stats shape', async () => {
    const userId = await createUser('shelfkind')
    const { collectionId } = await bootstrapCollection(userId, { username: 'shelfkind', displayName: null })
    await createContainer(userId, collectionId, { kind: 'binder', name: 'My binder' })
    await createContainer(userId, collectionId, { kind: 'list', name: 'Wishlist' })

    const result = await getCollectionShelves(userId)

    const binderShelf = result.shelves.find((s) => s.name === 'My binder')
    const listShelf = result.shelves.find((s) => s.name === 'Wishlist')
    expect(binderShelf?.notOwned).toBe(false)
    expect(listShelf?.notOwned).toBe(true)
  })

  it('aggregates built decks into a single shelf distinct from plan/assemble decks, keyed by BUILT_DECKS_SHELF_ID', async () => {
    const userId = await createUser('deckowner')
    const { collectionId } = await bootstrapCollection(userId, { username: 'deckowner', displayName: null })

    const builtDeckA = await createContainer(userId, collectionId, { kind: 'deck', name: 'Deck A' })
    const builtDeckB = await createContainer(userId, collectionId, { kind: 'deck', name: 'Deck B' })
    const planDeck = await createContainer(userId, collectionId, { kind: 'deck', name: 'Deck C (plan)' })

    const cardA = randomUUID()
    const cardB = randomUUID()
    const cardC = randomUUID()
    await insertCard(cardA, 'Card A', 5)
    await insertCard(cardB, 'Card B', 3)
    await insertCard(cardC, 'Card C (plan, excluded)', 99)
    // Le holding est écrit avant que le deck ne passe `built` (`addHolding`
    // refuse toute écriture sur un deck déjà `built`) — l'ordre inverse
    // simulerait une écriture que
    // l'application elle-même ne pourrait plus produire.
    await addHolding(userId, { containerId: builtDeckA.id, cardId: cardA, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)
    await addHolding(userId, { containerId: builtDeckB.id, cardId: cardB, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await addHolding(userId, { containerId: planDeck.id, cardId: cardC, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await pool.query(`UPDATE containers SET deck_state = 'built' WHERE id = $1`, [builtDeckA.id])
    await pool.query(`UPDATE containers SET deck_state = 'built' WHERE id = $1`, [builtDeckB.id])
    await pool.query(`UPDATE containers SET deck_state = 'plan' WHERE id = $1`, [planDeck.id])

    const result = await getCollectionShelves(userId)

    const builtShelf = result.shelves.find((s) => s.containerId === BUILT_DECKS_SHELF_ID)
    expect(builtShelf).toBeDefined()
    expect(builtShelf!.meta).toBe('2 decks · 3 cards')
    // 2 * 5.00 + 1 * 3.00 = 13.00 → 1300 centimes.
    expect(builtShelf!.valueMinor).toBe(1300)
    // La carte de la deck en plan n'apparaît jamais, malgré son prix plus
    // élevé — elle sortirait en tête si le scope incluait les decks non
    // construites.
    expect(builtShelf!.tiles.map((t) => t.cardId)).toEqual(
      expect.arrayContaining([cardA, cardB]),
    )
    expect(builtShelf!.tiles.map((t) => t.cardId)).not.toContain(cardC)
  })

  it('shows at most 8 Recently added tiles, most recent first, with a count independent from the tile cap', async () => {
    const userId = await createUser('recentowner')
    const { containerId: rootId } = await bootstrapCollection(userId, { username: 'recentowner', displayName: null })

    const holdingIds: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const cardId = randomUUID()
      await insertCard(cardId, `Recent ${i}`, 1)
      const { holdingId } = await addHolding(
        userId,
        { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        1,
      )
      holdingIds.push(holdingId)
    }
    // Étale les 10 ajouts sur les 10 dernières heures pour un ordre
    // déterministe (`added_at` a sinon la même valeur, `now()`, pour tous).
    for (const [index, holdingId] of holdingIds.entries()) {
      await pool.query(`UPDATE holdings SET added_at = now() - ($1 || ' hours')::interval WHERE id = $2`, [
        index,
        holdingId,
      ])
    }

    const result = await getCollectionShelves(userId)

    expect(result.recentlyAdded.count).toBe(10)
    expect(result.recentlyAdded.tiles).toHaveLength(8)
    expect(result.recentlyAdded.tiles.map((t) => t.name)).toEqual([
      'Recent 0',
      'Recent 1',
      'Recent 2',
      'Recent 3',
      'Recent 4',
      'Recent 5',
      'Recent 6',
      'Recent 7',
    ])
  })

  // Ordre All collection → binders → Built decks (masquée si 0) → listes en
  // dernier, taguées `notOwned`.
  it('orders shelves All collection, binders, Built decks, lists — Built decks hidden with zero built decks', async () => {
    const userId = await createUser('shelforder')
    const { collectionId } = await bootstrapCollection(userId, {
      username: 'shelforder',
      displayName: null,
    })
    await createContainer(userId, collectionId, { kind: 'list', name: 'Zzz wishlist' })
    await createContainer(userId, collectionId, { kind: 'binder', name: 'Aaa binder' })

    const result = await getCollectionShelves(userId)

    expect(result.shelves.map((s) => s.containerId)).not.toContain(BUILT_DECKS_SHELF_ID)
    const names = result.shelves.map((s) => s.name)
    expect(names[0]).toBe('All collection')
    expect(names.indexOf('Aaa binder')).toBeLessThan(names.indexOf('Zzz wishlist'))
    expect(names.at(-1)).toBe('Zzz wishlist')
  })

  it('scopes shelves to the caller collection only, never leaking another member', async () => {
    const userA = await createUser('alice9')
    const { collectionId: collectionA } = await bootstrapCollection(userA, { username: 'alice9', displayName: null })
    await createContainer(userA, collectionA, { kind: 'binder', name: "Alice's binder" })

    const userB = await createUser('bob9')
    await bootstrapCollection(userB, { username: 'bob9', displayName: null })

    const resultB = await getCollectionShelves(userB)
    expect(resultB.shelves.some((s) => s.name === "Alice's binder")).toBe(false)

    const resultA = await getCollectionShelves(userA)
    expect(resultA.shelves.some((s) => s.name === "Alice's binder")).toBe(true)
  })
})
