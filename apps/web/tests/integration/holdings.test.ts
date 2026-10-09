// Test d'intégration : unicité de la clé
// de holding, quantités (mise à zéro, undo de suppression), refus d'accès
// pour les cinq mutations, et `container_stats` recalculées. Contre la base
// éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ; se
// saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Holdings & container_stats', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/lib/containers/holdings`
  // (donc de `@spellcache/db`, singleton créé à l'évaluation du module — même
  // contrainte que tests/integration/authorize.test.ts).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let holdings: typeof import('@spellcache/db/schema').holdings
  let containerStats: typeof import('@spellcache/db/schema').containerStats
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let ContainerAccessError: typeof import('@/lib/collections/authorize').ContainerAccessError
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let setHoldingQuantity: typeof import('@/lib/containers/holdings').setHoldingQuantity
  let updateHolding: typeof import('@/lib/containers/holdings').updateHolding
  let moveHoldings: typeof import('@/lib/containers/holdings').moveHoldings
  let removeHoldings: typeof import('@/lib/containers/holdings').removeHoldings
  let restoreHoldings: typeof import('@/lib/containers/holdings').restoreHoldings

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, holdings, containerStats } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ ContainerAccessError } = await import('@/lib/collections/authorize'))
    ;({ addHolding, setHoldingQuantity, updateHolding, moveHoldings, removeHoldings, restoreHoldings } =
      await import('@/lib/containers/holdings'))
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

  async function createContainerFor(username: string): Promise<{ userId: string; containerId: string }> {
    const userId = await createUser(username)
    const { containerId } = await bootstrapCollection(userId, { username, displayName: null })
    return { userId, containerId }
  }

  async function insertCard(opts: {
    id: string
    name: string
    setCode: string
  }): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
      [opts.setCode],
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, $4, '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [opts.id, randomUUID(), opts.name, opts.setCode],
    )
  }

  async function insertPrice(opts: {
    cardId: string
    usd?: number
    usdFoil?: number
    eur?: number
    eurFoil?: number
  }): Promise<void> {
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, $2, $3, $4, $5)`,
      [opts.cardId, opts.usd ?? null, opts.usdFoil ?? null, opts.eur ?? null, opts.eurFoil ?? null],
    )
  }

  // Calcul indépendant de la valorisation :
  // lit les holdings et le dernier prix connu par carte ligne à ligne, puis
  // additionne côté test — un chemin de calcul distinct de la requête
  // agrégée unique de `recomputeContainerStats` (lib/containers/stats.ts).
  async function computeExpectedValue(
    containerId: string,
  ): Promise<{ usdMinor: number; eurMinor: number; cardCount: number; uniqueCount: number }> {
    const { rows: holdingRows } = await pool.query<{ qty: number; finish: string; card_id: string }>(
      'SELECT qty, finish, card_id FROM holdings WHERE container_id = $1',
      [containerId],
    )

    let usdMinor = 0
    let eurMinor = 0
    let cardCount = 0

    for (const row of holdingRows) {
      cardCount += row.qty
      const { rows: priceRows } = await pool.query<{
        usd: string | null
        usd_foil: string | null
        eur: string | null
        eur_foil: string | null
      }>(
        'SELECT usd, usd_foil, eur, eur_foil FROM card_prices WHERE card_id = $1 ORDER BY day DESC LIMIT 1',
        [row.card_id],
      )
      const price = priceRows[0]
      const usd = price ? (row.finish === 'nonfoil' ? price.usd : price.usd_foil) : null
      const eur = price ? (row.finish === 'nonfoil' ? price.eur : price.eur_foil) : null
      usdMinor += usd === null ? 0 : Math.round(row.qty * Number(usd) * 100)
      eurMinor += eur === null ? 0 : Math.round(row.qty * Number(eur) * 100)
    }

    return { usdMinor, eurMinor, cardCount, uniqueCount: holdingRows.length }
  }

  it('merges duplicate keys, splits on a different finish', async () => {
    const { userId, containerId } = await createContainerFor('collector')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Llanowar Elves', setCode: 'lea' })

    const key = {
      containerId,
      cardId,
      finish: 'nonfoil' as const,
      condition: 'nm' as const,
      language: 'en',
    }

    const first = await addHolding(userId, key, 2)
    const second = await addHolding(userId, key, 3)
    expect(second.holdingId).toBe(first.holdingId)
    expect(second.qty).toBe(5)

    const foil = await addHolding(userId, { ...key, finish: 'foil' }, 1)
    expect(foil.holdingId).not.toBe(first.holdingId)

    const rows = await db.select().from(holdings).where(eq(holdings.containerId, containerId))
    expect(rows).toHaveLength(2)
  })

  it('setHoldingQuantity(_, id, 0) removes the row', async () => {
    const { userId, containerId } = await createContainerFor('zeroer')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Giant Growth', setCode: 'lea' })

    const { holdingId } = await addHolding(
      userId,
      { containerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      4,
    )

    await expect(setHoldingQuantity(userId, holdingId, 0)).resolves.toEqual({
      removed: true,
      qty: 0,
    })

    const rows = await db.select().from(holdings).where(eq(holdings.id, holdingId))
    expect(rows).toHaveLength(0)
  })

  it('restoreHoldings replays a fresh undoToken exactly', async () => {
    const { userId, containerId } = await createContainerFor('undoer')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Counterspell', setCode: 'lea' })

    const { holdingId } = await addHolding(
      userId,
      { containerId, cardId, finish: 'foil', condition: 'lp', language: 'en' },
      7,
    )

    const { removed, undoToken } = await removeHoldings(userId, [holdingId])
    expect(removed).toBe(1)
    expect(await db.select().from(holdings).where(eq(holdings.id, holdingId))).toHaveLength(0)

    const { restored } = await restoreHoldings(userId, undoToken)
    expect(restored).toBe(1)

    const [restoredRow] = await db.select().from(holdings).where(eq(holdings.id, holdingId))
    expect(restoredRow).toMatchObject({
      id: holdingId,
      containerId,
      cardId,
      qty: 7,
      finish: 'foil',
      condition: 'lp',
    })
  })

  it('recomputes container_stats after a mutation, matching an independent aggregate', async () => {
    const { userId, containerId } = await createContainerFor('valuer')
    const cardA = randomUUID()
    const cardB = randomUUID()
    const cardC = randomUUID()
    await insertCard({ id: cardA, name: 'Card A', setCode: 'lea' })
    await insertCard({ id: cardB, name: 'Card B', setCode: 'lea' })
    await insertCard({ id: cardC, name: 'Card C (no price)', setCode: 'lea' })
    await insertPrice({ cardId: cardA, usd: 2, eur: 1.8 })
    await insertPrice({ cardId: cardB, usdFoil: 5.25, eurFoil: 4.1 })

    const before = Date.now()

    await addHolding(userId, { containerId, cardId: cardA, finish: 'nonfoil', condition: 'nm', language: 'en' }, 3)
    await addHolding(userId, { containerId, cardId: cardB, finish: 'foil', condition: 'nm', language: 'en' }, 2)
    await addHolding(userId, { containerId, cardId: cardC, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const [stats] = await db.select().from(containerStats).where(eq(containerStats.containerId, containerId))
    expect(stats).toBeDefined()
    expect(stats!.computedAt.getTime()).toBeGreaterThanOrEqual(before)

    const expected = await computeExpectedValue(containerId)
    expect(stats!.cardCount).toBe(expected.cardCount)
    expect(stats!.uniqueCount).toBe(expected.uniqueCount)
    expect(stats!.valueUsdMinor).toBe(expected.usdMinor)
    expect(stats!.valueEurMinor).toBe(expected.eurMinor)
    // Une carte sans prix du jour compte pour 0 sans annuler le total.
    expect(stats!.valueUsdMinor).toBe(600 + 1050)
    expect(stats!.valueEurMinor).toBe(540 + 820)
  })

  it('rejects a non-member on all five holding mutations, without changing any row', async () => {
    const { userId, containerId } = await createContainerFor('holder')
    const strangerId = await createUser('stranger')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Swords to Plowshares', setCode: 'lea' })

    const { holdingId } = await addHolding(
      userId,
      { containerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    const otherContainer = await createContainerFor('otherholder')

    await expect(
      addHolding(strangerId, { containerId, cardId, finish: 'foil', condition: 'nm', language: 'en' }, 1),
    ).rejects.toBeInstanceOf(ContainerAccessError)
    await expect(setHoldingQuantity(strangerId, holdingId, 9)).rejects.toBeInstanceOf(
      ContainerAccessError,
    )
    await expect(
      updateHolding(strangerId, holdingId, { condition: 'lp' }),
    ).rejects.toBeInstanceOf(ContainerAccessError)
    await expect(
      moveHoldings(strangerId, [holdingId], otherContainer.containerId),
    ).rejects.toBeInstanceOf(ContainerAccessError)
    await expect(removeHoldings(strangerId, [holdingId])).rejects.toBeInstanceOf(ContainerAccessError)

    const rows = await db.select().from(holdings).where(eq(holdings.id, holdingId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ qty: 1, condition: 'nm', containerId })
  })
})
