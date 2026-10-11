// Test d'intégration : ce qui compte comme « possédé ». Racine et binders
// sont du stock, une liste n'en est jamais, et chaque écran qui affiche un
// total ou une couverture de deck doit tenir le même compte, quel que soit
// le chemin par lequel une carte est arrivée ou repartie.
//
// Contre la base éphémère `postgres-test` (packages/db/testing/global-setup.ts) ;
// se saute lui-même sans `TEST_DATABASE_URL`, comme les autres tests
// d'intégration.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  TRUNCATE_ALL,
  aggregateHoldings,
  insertCard,
  insertUser,
  ownedContainerIds,
  readStats,
} from '../utils/collection-fixture'

describe.skipIf(!process.env.TEST_DATABASE_URL)('collection ownership', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let deleteContainer: typeof import('@/lib/containers/containers').deleteContainer
  let deleteBinder: typeof import('@/lib/containers/containers').deleteBinder
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let moveHoldings: typeof import('@/lib/containers/holdings').moveHoldings
  let bulkEdit: typeof import('@/lib/containers/bulk').bulkEdit
  let availabilityMap: typeof import('@/lib/decks/availability').availabilityMap
  let getDeck: typeof import('@/app/(app)/decks/[id]/deck-data').getDeck
  let assembleLib: typeof import('@/lib/decks/assemble')
  let getCollectionHome: typeof import('@/app/(app)/collection/collection-data').getCollectionHome
  let getContainerHeader: typeof import('@/app/(app)/container/[id]/holdings-data').getContainerHeader

  const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer, deleteContainer, deleteBinder } =
      await import('@/lib/containers/containers'))
    ;({ addHolding, moveHoldings } = await import('@/lib/containers/holdings'))
    ;({ bulkEdit } = await import('@/lib/containers/bulk'))
    ;({ availabilityMap } = await import('@/lib/decks/availability'))
    ;({ getDeck } = await import('@/app/(app)/decks/[id]/deck-data'))
    assembleLib = await import('@/lib/decks/assemble')
    ;({ getCollectionHome } = await import('@/app/(app)/collection/collection-data'))
    ;({ getContainerHeader } = await import('@/app/(app)/container/[id]/holdings-data'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(TRUNCATE_ALL)
  })

  async function setup(username: string) {
    const userId = await insertUser(pool, username)
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    return { userId, collectionId, rootId }
  }

  async function planDeck(userId: string, collectionId: string, cardId: string, qty = 1) {
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Plan deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, ...nm }, qty)
    return deck.id
  }

  async function holdingIdsOf(containerId: string): Promise<string[]> {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM holdings WHERE container_id = $1 ORDER BY id',
      [containerId],
    )
    return rows.map((row) => row.id)
  }

  // Un import CSV garde toujours le set et le numéro d'origine, presque
  // jamais ceux qu'un deck a choisis : seule la carte compte.
  it(
    'counts a binder copy of another printing of the same card as owned by a deck',
    async () => {
      const { userId, collectionId } = await setup('crossprint')
      const oracleId = randomUUID()
      const deckPrinting = await insertCard(pool, {
        name: 'Sol Ring',
        oracleId,
        setCode: 'cmr',
        collectorNumber: '472',
      })
      const binderPrinting = await insertCard(pool, {
        name: 'Sol Ring',
        oracleId,
        setCode: 'c21',
        collectorNumber: '263',
      })

      const binder = await createContainer(userId, collectionId, {
        kind: 'binder',
        name: 'Artifacts',
      })
      await addHolding(
        userId,
        { containerId: binder.id, cardId: binderPrinting, ...nm },
        1,
      )
      const deckId = await planDeck(userId, collectionId, deckPrinting)

      const deck = await getDeck(userId, deckId)
      expect(deck.slots[0]).toMatchObject({ ownedElsewhere: 1, state: 'owned' })
      expect(deck.coverage).toMatchObject({ owned: 1, total: 1, missing: 0 })
    },
  )

  it('a deck built on another printing reserves that copy, and dismantling moves it under its own printing', async () => {
    const { userId, collectionId } = await setup('crossdismantle')
    const oracleId = randomUUID()
    const deckPrinting = await insertCard(pool, {
      name: 'Sol Ring',
      oracleId,
      setCode: 'cmr',
      collectorNumber: '472',
    })
    const binderPrinting = await insertCard(pool, {
      name: 'Sol Ring',
      oracleId,
      setCode: 'c21',
      collectorNumber: '263',
    })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Rocks' })
    const target = await createContainer(userId, collectionId, { kind: 'binder', name: 'Returned' })
    await addHolding(userId, { containerId: binder.id, cardId: binderPrinting, ...nm }, 1)
    const deckId = await planDeck(userId, collectionId, deckPrinting)

    const plan = await assembleLib.planAssembly(userId, deckId, {
      fromLooseCollection: true,
      fromOtherBuiltDecks: false,
    })
    expect(plan.owned).toHaveLength(1)
    await assembleLib.assembleDeck(userId, deckId, { plan })

    // Monté, le deck réclame l'exemplaire C21 : plus rien de disponible,
    // sous l'une ou l'autre impression.
    const reserved = await availabilityMap(collectionId, [deckPrinting, binderPrinting])
    expect(reserved.get(deckPrinting)).toBe(0)
    expect(reserved.get(binderPrinting)).toBe(0)

    await assembleLib.dismantleDeck(userId, deckId, target.id)

    const { rows } = await pool.query<{ container_id: string; card_id: string; qty: number }>(
      `SELECT h.container_id, h.card_id, h.qty FROM holdings h
         JOIN containers c ON c.id = h.container_id WHERE c.collection_id = $1`,
      [collectionId],
    )
    // L'exemplaire réel a déménagé tel quel (C21), jamais réécrit en CMR ni
    // dupliqué : un seul Sol Ring dans toute la collection.
    expect(rows).toEqual([{ container_id: target.id, card_id: binderPrinting, qty: 1 }])
    for (const containerId of [binder.id, target.id]) {
      expect(await readStats(pool, containerId)).toEqual(await aggregateHoldings(pool, [containerId]))
    }
  })

  it('counts a foil binder copy as owned for a nonfoil deck slot', async () => {
    const { userId, collectionId } = await setup('foilcover')
    const cardId = await insertCard(pool, { name: 'Arcane Signet' })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'Foils',
    })
    await addHolding(
      userId,
      { containerId: binder.id, cardId, finish: 'foil', condition: 'nm', language: 'en' },
      1,
    )
    const deckId = await planDeck(userId, collectionId, cardId)

    const deck = await getDeck(userId, deckId)
    expect(deck.slots[0]).toMatchObject({ ownedElsewhere: 1, state: 'owned' })
  })

  it('counts a French, lightly played copy as owned like an English near mint one', async () => {
    const { userId, collectionId, rootId } = await setup('langcover')
    const cardId = await insertCard(pool, { name: 'Command Tower' })
    await addHolding(
      userId,
      { containerId: rootId, cardId, finish: 'nonfoil', condition: 'lp', language: 'fr' },
      2,
    )
    const deckId = await planDeck(userId, collectionId, cardId, 2)

    const deck = await getDeck(userId, deckId)
    expect(deck.slots[0]).toMatchObject({ ownedElsewhere: 2, state: 'owned' })
    expect(deck.coverage.owned).toBe(2)
  })

  it('moving a card from a binder to a list removes it from owned stock, moving it back restores it', async () => {
    const { userId, collectionId, rootId } = await setup('movelist')
    const cardId = await insertCard(pool, { name: 'Swords to Plowshares', priceEur: 2 })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'White',
    })
    const wishlist = await createContainer(userId, collectionId, {
      kind: 'list',
      name: 'Wishlist',
    })
    await addHolding(userId, { containerId: binder.id, cardId, ...nm }, 3)
    const deckId = await planDeck(userId, collectionId, cardId, 3)

    const rootBefore = await getContainerHeader(userId, rootId)
    expect(rootBefore.cardCount).toBe(3)

    await moveHoldings(userId, await holdingIdsOf(binder.id), wishlist.id)

    expect((await availabilityMap(collectionId, [cardId])).get(cardId)).toBe(0)
    expect((await getContainerHeader(userId, rootId)).cardCount).toBe(0)
    expect((await getDeck(userId, deckId)).coverage).toMatchObject({
      owned: 0,
      missing: 3,
    })
    expect(await readStats(pool, wishlist.id)).toEqual(
      await aggregateHoldings(pool, [wishlist.id]),
    )
    expect((await readStats(pool, binder.id)).cards).toBe(0)

    await moveHoldings(userId, await holdingIdsOf(wishlist.id), binder.id)

    expect((await availabilityMap(collectionId, [cardId])).get(cardId)).toBe(3)
    expect(await getContainerHeader(userId, rootId)).toMatchObject({
      cardCount: rootBefore.cardCount,
      valueMinor: rootBefore.valueMinor,
    })
    expect((await getDeck(userId, deckId)).coverage).toMatchObject({
      owned: 3,
      missing: 0,
    })
  })

  it('deleting a binder keeps every copy owned and leaves the All collection totals unchanged', async () => {
    const { userId, collectionId, rootId } = await setup('delbinder')
    const shared = await insertCard(pool, { name: 'Counterspell', priceEur: 1 })
    const onlyInBinder = await insertCard(pool, { name: 'Brainstorm', priceEur: 0.5 })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'Blue',
    })
    // Une clé déjà présente à la racine fusionne, l'autre déménage.
    await addHolding(userId, { containerId: rootId, cardId: shared, ...nm }, 1)
    await addHolding(userId, { containerId: binder.id, cardId: shared, ...nm }, 2)
    await addHolding(userId, { containerId: binder.id, cardId: onlyInBinder, ...nm }, 4)

    const headerBefore = await getContainerHeader(userId, rootId)
    const availableBefore = await availabilityMap(collectionId, [shared, onlyInBinder])

    await deleteBinder(userId, binder.id)

    expect(await availabilityMap(collectionId, [shared, onlyInBinder])).toEqual(
      availableBefore,
    )
    const headerAfter = await getContainerHeader(userId, rootId)
    expect(headerAfter.cardCount).toBe(headerBefore.cardCount)
    expect(headerAfter.valueMinor).toBe(headerBefore.valueMinor)
    expect(await readStats(pool, rootId)).toEqual(await aggregateHoldings(pool, [rootId]))
  })

  it('deleting a list never brings its cards into owned stock', async () => {
    const { userId, collectionId, rootId } = await setup('dellist')
    const cardId = await insertCard(pool, { name: 'Mana Crypt', priceEur: 150 })
    const wishlist = await createContainer(userId, collectionId, {
      kind: 'list',
      name: 'Wants',
    })
    await addHolding(userId, { containerId: wishlist.id, cardId, ...nm }, 1)

    const headerBefore = await getContainerHeader(userId, rootId)
    await deleteContainer(userId, wishlist.id)

    expect((await availabilityMap(collectionId, [cardId])).get(cardId)).toBe(0)
    expect(await getContainerHeader(userId, rootId)).toMatchObject({
      cardCount: headerBefore.cardCount,
      valueMinor: headerBefore.valueMinor,
    })
    const { rows } = await pool.query('SELECT 1 FROM holdings WHERE card_id = $1', [
      cardId,
    ])
    expect(rows).toHaveLength(0)
  })

  // Depuis la racine, une sélection mêle des lignes de binders : le binder
  // d'où part une ligne déplacée doit être recalculé, pas seulement la vue
  // et la destination.
  it(
    'a bulk move from the root view of mixed root and binder rows into a list keeps every container_stats row exact',
    async () => {
      const { userId, collectionId, rootId } = await setup('bulkmove')
      const binder = await createContainer(userId, collectionId, {
        kind: 'binder',
        name: 'Mixed',
      })
      const wishlist = await createContainer(userId, collectionId, {
        kind: 'list',
        name: 'Trade',
      })
      const cards: string[] = []
      for (let i = 0; i < 4; i += 1) {
        cards.push(await insertCard(pool, { name: `Bulk card ${i}`, priceEur: i + 1 }))
      }
      await addHolding(userId, { containerId: rootId, cardId: cards[0]!, ...nm }, 1)
      await addHolding(userId, { containerId: rootId, cardId: cards[1]!, ...nm }, 2)
      await addHolding(userId, { containerId: binder.id, cardId: cards[2]!, ...nm }, 3)
      await addHolding(userId, { containerId: binder.id, cardId: cards[3]!, ...nm }, 4)

      const moved = [
        (await holdingIdsOf(rootId))[0]!,
        (await holdingIdsOf(binder.id))[0]!,
      ]
      await bulkEdit(
        userId,
        { containerId: rootId, holdingIds: moved },
        { targetContainerId: wishlist.id },
      )

      for (const containerId of [rootId, binder.id, wishlist.id]) {
        expect(await readStats(pool, containerId)).toEqual(
          await aggregateHoldings(pool, [containerId]),
        )
      }
      const owned = await aggregateHoldings(
        pool,
        await ownedContainerIds(pool, collectionId),
      )
      expect((await getContainerHeader(userId, rootId)).cardCount).toBe(owned.cards)
      expect(owned.cards + (await readStats(pool, wishlist.id)).cards).toBe(10)
    },
  )

  // Une carte rangée (ou importée) dans un binder reste dans la collection :
  // la carte de valeur et la ligne `All collection` l'incluent, comme l'écran
  // `All collection` (`getContainerHeader`).
  it(
    'the Collection home total counts binder cards, matching the All collection screen',
    async () => {
      const { userId, collectionId, rootId } = await setup('hometotal')
      const loose = await insertCard(pool, { name: 'Loose card', priceEur: 1 })
      const inBinder = await insertCard(pool, { name: 'Binder card', priceEur: 10 })
      const inList = await insertCard(pool, { name: 'Wanted card', priceEur: 100 })
      const binder = await createContainer(userId, collectionId, {
        kind: 'binder',
        name: 'Imported',
      })
      const wishlist = await createContainer(userId, collectionId, {
        kind: 'list',
        name: 'Wishlist',
      })
      await addHolding(userId, { containerId: rootId, cardId: loose, ...nm }, 1)
      await addHolding(userId, { containerId: binder.id, cardId: inBinder, ...nm }, 2)
      await addHolding(userId, { containerId: wishlist.id, cardId: inList, ...nm }, 5)

      const header = await getContainerHeader(userId, rootId)
      expect(header.cardCount).toBe(3)

      const home = await getCollectionHome(userId)
      expect(home.counts.cards).toBe(header.cardCount)
      expect(home.value.amountMinor).toBe(header.valueMinor)
    },
  )
})
