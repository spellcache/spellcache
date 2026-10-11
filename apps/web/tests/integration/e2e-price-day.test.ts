// Jour de prix des cartes posées par les parcours E2E (`tests/e2e/price-day.ts`).
// Ces parcours écrivent dans la base de développement : une carte de test
// datée `current_date` alors que le dernier import est plus ancien faisait de
// ce jour le jour de référence, et tout binder recalculé ensuite valait zéro.
// Contre la base éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ;
// se saute lui-même si `TEST_DATABASE_URL` n'est pas exposé.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { testPriceDay } from '../e2e/price-day'

describe.skipIf(!process.env.TEST_DATABASE_URL)('E2E card price day', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  const importDay = '2026-01-15'

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let recomputeContainerStats: typeof import('@/lib/containers/stats').recomputeContainerStats
  let readContainerValue: typeof import('@/lib/containers/stats').readContainerValue

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ recomputeContainerStats, readContainerValue } = await import('@/lib/containers/stats'))
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

  async function insertCard(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO sets (code, name, card_count) VALUES ('lea', 'lea', 0) ON CONFLICT (code) DO NOTHING`)
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $1::uuid, $2, 'lea', $2, 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [id, id],
    )
    return id
  }

  async function latestPriceDay(): Promise<string | null> {
    const { rows } = await pool.query<{ day: string | null }>('SELECT max(day)::text AS day FROM card_prices')
    return rows[0]!.day
  }

  it('keeps the last import day as the reference day, so real binders keep their value', async () => {
    const userId = await createUser('collector')
    const { collectionId } = await bootstrapCollection(userId, { username: 'collector', displayName: null })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Bulk rares' })

    const realCard = await insertCard()
    await pool.query(`INSERT INTO card_prices (card_id, day, eur, usd) VALUES ($1, $2::date, 4.50, 5.00)`, [
      realCard,
      importDay,
    ])
    await pool.query(
      `INSERT INTO holdings (container_id, card_id, qty, finish, condition, language)
       VALUES ($1, $2, 2, 'nonfoil', 'nm', 'en')`,
      [binder.id, realCard],
    )

    const e2eCard = await insertCard()
    await db.execute(sql`
      insert into card_prices (card_id, day, eur, usd) values (${e2eCard}::uuid, ${testPriceDay}, 1, 1)
    `)

    expect(await latestPriceDay()).toBe(importDay)

    await recomputeContainerStats(binder.id)
    const value = await readContainerValue(binder.id, 'eur')
    expect(value.valueMinor).toBe(900)
  })

  it('falls back to today on an empty catalogue', async () => {
    const e2eCard = await insertCard()
    await db.execute(sql`
      insert into card_prices (card_id, day, eur, usd) values (${e2eCard}::uuid, ${testPriceDay}, 1, 1)
    `)

    const { rows } = await pool.query<{ today: string }>('SELECT current_date::text AS today')
    expect(await latestPriceDay()).toBe(rows[0]!.today)
  })

  async function createUser(username: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    return row!.id
  }
})
