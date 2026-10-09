// Test d'intégration : `availableQty`/`availabilityMap` — « disponible » exclut
// le stock réservé par un deck `built`, jamais celui d'un deck encore en
// chantier. Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible), même garde que
// `tests/integration/holdings.test.ts`.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('availableQty / availabilityMap', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let containers: typeof import('@spellcache/db/schema').containers
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let availableQty: typeof import('@/lib/decks/availability').availableQty
  let availabilityMap: typeof import('@/lib/decks/availability').availabilityMap
  let listHoldings: typeof import('@/app/(app)/container/[id]/holdings-data').listHoldings

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, containers } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ availableQty, availabilityMap } = await import('@/lib/decks/availability'))
    ;({ listHoldings } = await import('@/app/(app)/container/[id]/holdings-data'))
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

  async function createUser(username: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    return row!.id
  }

  async function insertCard(id: string, name: string): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('avl', 'Availability set', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $2, $3, 'avl', $1::text, 'common', 1, 'Creature', '{}', '{}', '{nonfoil}', '{}'::jsonb)`,
      [id, randomUUID(), name],
    )
  }

  it('returns 2 for a card owned in 3 copies with 1 reserved by a built deck, and 3 once unbuilt', async () => {
    const userId = await createUser('availtest')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'availtest',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 3)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Reserving deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    // Encore `plan` : la ligne de besoin du deck ne réserve rien.
    expect(await availableQty(collectionId, cardId, 'nonfoil')).toBe(3)

    await db.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deck.id))
    expect(await availableQty(collectionId, cardId, 'nonfoil')).toBe(2)

    await db.update(containers).set({ deckState: 'assemble' }).where(eq(containers.id, deck.id))
    expect(await availableQty(collectionId, cardId, 'nonfoil')).toBe(3)
  })

  it('never counts a list as owned stock — a wishlisted card stays unavailable', async () => {
    const userId = await createUser('listnotowned')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'listnotowned',
      displayName: null,
    })

    const wanted = randomUUID()
    const owned = randomUUID()
    await insertCard(wanted, "Gaea's Cradle")
    await insertCard(owned, 'Llanowar Elves')

    const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const
    const wishlist = await createContainer(userId, collectionId, { kind: 'list', name: 'Wishlist' })
    await addHolding(userId, { containerId: wishlist.id, cardId: wanted, ...nm }, 1)
    await addHolding(userId, { containerId: wishlist.id, cardId: owned, ...nm }, 2)
    await addHolding(userId, { containerId: rootId, cardId: owned, ...nm }, 1)

    expect(await availableQty(collectionId, wanted, 'nonfoil')).toBe(0)
    // Seul l'exemplaire de la racine compte, jamais les 2 de la liste.
    expect(await availableQty(collectionId, owned, 'nonfoil')).toBe(1)
    const map = await availabilityMap(collectionId, [wanted, owned])
    expect(map.get(wanted)).toBe(0)
    expect(map.get(owned)).toBe(1)
  })

  it('scopes availability by finish — a foil reservation never reduces the nonfoil pool', async () => {
    const userId = await createUser('finishscoped')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'finishscoped',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Lightning Bolt')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)
    await addHolding(userId, { containerId: rootId, cardId, finish: 'foil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Foil deck',
      format: 'modern',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'foil', condition: 'nm', language: 'en' }, 1)
    await db.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deck.id))

    expect(await availableQty(collectionId, cardId, 'nonfoil')).toBe(2)
    expect(await availableQty(collectionId, cardId, 'foil')).toBe(0)
  })

  it('batches many cards in a single query via availabilityMap (never N+1)', async () => {
    const userId = await createUser('batchtest')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'batchtest',
      displayName: null,
    })

    const cardIds = Array.from({ length: 5 }, () => randomUUID())
    for (const [index, cardId] of cardIds.entries()) {
      await insertCard(cardId, `Card ${index}`)
      await addHolding(
        userId,
        { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        index + 1,
      )
    }

    const map = await availabilityMap(collectionId, cardIds)
    expect(map.size).toBe(5)
    cardIds.forEach((cardId, index) => expect(map.get(cardId)).toBe(index + 1))
  })

  it('returns 0 (not undefined) for a card the collection never held', async () => {
    const userId = await createUser('unknowncard')
    const { collectionId } = await bootstrapCollection(userId, { username: 'unknowncard', displayName: null })
    const unknownCardId = randomUUID()
    await insertCard(unknownCardId, 'Never owned')

    expect(await availableQty(collectionId, unknownCardId, 'nonfoil')).toBe(0)
    const map = await availabilityMap(collectionId, [unknownCardId])
    expect(map.get(unknownCardId)).toBe(0)
  })

  // Un deck `built` partiellement assemblé porte une ligne `missing` jamais
  // couverte par du stock réel (need > root). La soustraire sans filet ferait
  // passer `available` sous zéro pour une carte que personne ne possède —
  // `· -1 available` sur `CompactRow`. `greatest(0, …)`
  // (`availableQtyExpr`) est la seule garde nécessaire.
  it('never returns a negative availability for a card claimed beyond what the collection actually holds', async () => {
    const userId = await createUser('overclaim')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'overclaim',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Cultivate')
    // La collection ne possède rien du tout de cette carte.

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Overclaiming deck',
      format: 'commander',
      deckState: 'plan',
    })
    // Le deck en déclare 4, jamais achetées — un deck `built` à moitié
    // (l'assemblage partiel est nominal).
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 4)
    await db.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deck.id))

    expect(await availableQty(collectionId, cardId, 'nonfoil')).toBe(0)
    const map = await availabilityMap(collectionId, [cardId])
    expect(map.get(cardId)).toBe(0)

    // Une autre carte, réellement possédée, reste intégralement disponible
    // pour un tiers — le sur-adossement du deck ci-dessus sur SA carte ne
    // doit rien saigner sur une carte différente.
    const otherCardId = randomUUID()
    await insertCard(otherCardId, 'Sol Ring')
    await addHolding(
      userId,
      { containerId: rootId, cardId: otherCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      2,
    )
    expect(await availableQty(collectionId, otherCardId, 'nonfoil')).toBe(2)
  })

  it('surfaces qty and available as two distinct numbers on the collection screen row', async () => {
    const userId = await createUser('rowreserved')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'rowreserved',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Rhystic Study')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 3)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Reserving deck row',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await db.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deck.id))

    const page = await listHoldings(userId, rootId)
    const row = page.items.find((item) => item.cardId === cardId)
    expect(row?.qty).toBe(3)
    expect(row?.available).toBe(2)
    expect(row?.qty).not.toBe(row?.available)
  })
})
