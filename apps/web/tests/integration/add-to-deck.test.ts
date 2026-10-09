// Test d'intégration : `addToDeckAction`
// écrit un holding zoné, la couverture retournée reflète l'état réel de la
// collection, et la zone `commander` refuse un second commandant. Contre la
// base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// `addToDeckAction` est une Server Action : elle lit la session (`auth()` →
// `headers()`), qui n'existe que dans une vraie requête Next. Seul `auth()`
// est remplacé, comme dans tests/integration/settings.test.ts ;
// `requireSession` et le reste tournent pour de vrai contre la base.
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; username: string; displayName: string | null; role: string },
}))
vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))
// `revalidatePath` exige lui aussi le contexte d'une requête Next.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe.skipIf(!process.env.TEST_DATABASE_URL)('addToDeckAction / getDeck', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let holdings: typeof import('@spellcache/db/schema').holdings
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addToDeckAction: typeof import('@/app/(app)/decks/[id]/builder-actions').addToDeckAction
  let getDeck: typeof import('@/app/(app)/decks/[id]/deck-data').getDeck

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, holdings } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addToDeckAction } = await import('@/app/(app)/decks/[id]/builder-actions'))
    ;({ getDeck } = await import('@/app/(app)/decks/[id]/deck-data'))
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
      .values({ email: `${username}@example.com`, username, priceSource: 'tcgplayer_usd' })
      .returning({ id: users.id })
    // Le compte créé est aussi celui de la session des actions.
    authState.user = {
      id: row!.id,
      email: `${username}@example.com`,
      username,
      displayName: null,
      role: 'member',
    }
    return row!.id
  }

  async function insertCard(
    id: string,
    name: string,
    options: { colorIdentity?: string[]; typeLine?: string } = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('e2e', 'E2E set', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $2, $3, 'e2e', $1::text, 'common', 1, $4, '{}', $5::text[], '{nonfoil}', '{}'::jsonb)`,
      [id, randomUUID(), name, options.typeLine ?? 'Creature — Human', options.colorIdentity ?? []],
    )
  }

  it('writes a zoned holding, distinct from the same card added to another zone', async () => {
    const userId = await createUser('builder')
    const { collectionId } = await bootstrapCollection(userId, { username: 'builder', displayName: null })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Zone test',
      format: 'modern',
      deckState: 'plan',
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Lightning Bolt')

    const mainResult = await addToDeckAction({ deckId: deck.id, cardId, zone: 'main' })
    expect(mainResult.ok).toBe(true)
    const sideResult = await addToDeckAction({ deckId: deck.id, cardId, zone: 'side' })
    expect(sideResult.ok).toBe(true)

    // Un ajout au side ne doit jamais écraser (fusionner avec) le main — la
    // clé d'unicité de `addHolding` inclut désormais la zone.
    if (mainResult.ok) expect(mainResult.qtyInDeck).toBe(1)
    if (sideResult.ok) expect(sideResult.qtyInDeck).toBe(1)

    const deckDetail = await getDeck(userId, deck.id)
    const mainSlot = deckDetail.slots.find((slot) => slot.zone === 'main')
    const sideSlot = deckDetail.slots.find((slot) => slot.zone === 'side')
    expect(mainSlot?.need).toBe(1)
    expect(sideSlot?.need).toBe(1)
    // Deux lignes distinctes, pas une seule ligne fusionnée à qty=2.
    expect(mainSlot?.holdingId).not.toBe(sideSlot?.holdingId)
  })

  it('increments qtyInDeck and coverage when the same card/zone is added again', async () => {
    const userId = await createUser('stacker')
    const { collectionId } = await bootstrapCollection(userId, { username: 'stacker', displayName: null })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Stack test',
      format: 'modern',
      deckState: 'plan',
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Mountain', { typeLine: 'Basic Land — Mountain' })

    await addToDeckAction({ deckId: deck.id, cardId, zone: 'main' })
    const second = await addToDeckAction({ deckId: deck.id, cardId, zone: 'main' })

    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.qtyInDeck).toBe(2)
      expect(second.coverage.total).toBe(2)
    }
  })

  it('caps the commander zone at one card, refusing a second commander', async () => {
    const userId = await createUser('twocommanders')
    const { collectionId } = await bootstrapCollection(userId, { username: 'twocommanders', displayName: null })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Partner test',
      format: 'commander',
      deckState: 'plan',
    })

    const firstCommanderId = randomUUID()
    await insertCard(firstCommanderId, 'Atraxa, Praetors’ Voice', { colorIdentity: ['W', 'U', 'B', 'G'] })
    const secondCommanderId = randomUUID()
    await insertCard(secondCommanderId, 'Thrasios, Triton Hero', { colorIdentity: ['U', 'G'] })

    const first = await addToDeckAction({ deckId: deck.id, cardId: firstCommanderId, zone: 'commander' })
    expect(first.ok).toBe(true)

    const second = await addToDeckAction({ deckId: deck.id, cardId: secondCommanderId, zone: 'commander' })
    expect(second).toEqual({ ok: false, error: 'commander_full' })

    const deckDetail = await getDeck(userId, deck.id)
    expect(deckDetail.commander?.cardId).toBe(firstCommanderId)
  })

  it('excludes exemplaires reserved by a built deck from ownedElsewhere', async () => {
    const userId = await createUser('reserver')
    const { collectionId } = await bootstrapCollection(userId, { username: 'reserver', displayName: null })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring')

    const builtDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Built deck',
      format: 'commander',
      deckState: 'built',
    })
    // Insertion directe plutôt que `addToDeckAction` :
    // `lib/containers/holdings.ts` refuse désormais toute écriture sur un
    // deck `built`, y compris via cette action. Ce test simule un deck déjà
    // monté portant ce holding, sans passer par la voie d'écriture verrouillée.
    await db.insert(holdings).values({
      containerId: builtDeck.id,
      cardId,
      qty: 1,
      zone: 'main',
    })

    const planningDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Planning deck',
      format: 'commander',
      deckState: 'plan',
    })
    const result = await addToDeckAction({ deckId: planningDeck.id, cardId, zone: 'main' })
    expect(result.ok).toBe(true)

    const deckDetail = await getDeck(userId, planningDeck.id)
    const slot = deckDetail.slots.find((s) => s.zone === 'main')
    // L'exemplaire du deck monté ne doit jamais compter comme disponible ici
    // — sinon le bandeau de couverture mentirait.
    expect(slot?.ownedElsewhere).toBe(0)
    expect(slot?.state).toBe('missing')
  })
})
