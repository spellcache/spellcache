// Test d'intégration de la revalorisation des containers : la requête
// agrégée unique de `revalueAllContainers()`, la valorisation (formule,
// foil, carte sans prix du jour), la variation à 7 jours (exacte,
// rattrapage, historique trop court), l'indépendance des deux devises, et
// le comportement transactionnel sur erreur. Contre la base éphémère
// `postgres-test` (voir packages/db/testing/global-setup.ts) ; se saute
// lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { randomUUID } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('revalueAllContainers', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let revalueAllContainers: typeof import('../../../worker/src/jobs/revalue-containers.ts').revalueAllContainers
  let readContainerValue: typeof import('@/lib/containers/stats').readContainerValue
  let recomputeContainerStats: typeof import('@/lib/containers/stats').recomputeContainerStats

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ revalueAllContainers } = await import('../../../worker/src/jobs/revalue-containers.ts'))
    ;({ readContainerValue, recomputeContainerStats } = await import('@/lib/containers/stats'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(
      'TRUNCATE holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets, import_runs CASCADE',
    )
  })

  async function createUser(username: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    return row!.id
  }

  async function insertCardsBulk(ids: string[], setCode = 'lea'): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
      [setCode],
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       SELECT id, id, id::text, $2, id::text, 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'
       FROM unnest($1::uuid[]) AS id`,
      [ids, setCode],
    )
  }

  async function insertPricesBulk(
    ids: string[],
    day: string,
    prices: { usd: string | null; usdFoil: string | null; eur: string | null; eurFoil: string | null },
  ): Promise<void> {
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
       SELECT id, $2::date, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS id
       ON CONFLICT (card_id, day) DO UPDATE SET
         usd = excluded.usd, usd_foil = excluded.usd_foil, eur = excluded.eur, eur_foil = excluded.eur_foil`,
      [ids, day, prices.usd, prices.usdFoil, prices.eur, prices.eurFoil],
    )
  }

  async function insertHoldingsBulk(
    containerId: string,
    ids: string[],
    qty: number,
    finish: 'nonfoil' | 'foil',
  ): Promise<void> {
    await pool.query(
      `INSERT INTO holdings (container_id, card_id, qty, finish, condition, language)
       SELECT $2::uuid, id, $3, $4, 'nm', 'en' FROM unnest($1::uuid[]) AS id`,
      [ids, containerId, qty, finish],
    )
  }

  let queryCount = 0
  let updateContainerStatsCount = 0
  let originalClientQuery: typeof Client.prototype.query

  beforeEach(() => {
    queryCount = 0
    updateContainerStatsCount = 0
    originalClientQuery = Client.prototype.query
    // Compte les requêtes réellement émises par le `PoolClient` sous-jacent
    // — `pool.connect()` renvoie une
    // instance de `Client`, dont `.query` est celui-ci, que l'appel vienne
    // de `pool.query()` ou de `conn.query()` directement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
    Client.prototype.query = function (this: any, ...args: unknown[]) {
      queryCount += 1
      const text = typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '')
      if (/UPDATE\s+container_stats/i.test(text)) updateContainerStatsCount += 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
      return (originalClientQuery as any).apply(this, args)
    } as typeof Client.prototype.query
  })

  afterEach(() => {
    Client.prototype.query = originalClientQuery
  })

  it('recomputes all 3 containers (500 holdings) in a single UPDATE ... FROM (...) statement', async () => {
    const userId = await createUser('bulk')
    const { containerId: rootId, collectionId } = await bootstrapCollection(userId, {
      username: 'bulk',
      displayName: null,
    })
    const binderA = await createContainer(userId, collectionId, { kind: 'binder', name: 'Binder A' })
    const binderB = await createContainer(userId, collectionId, { kind: 'binder', name: 'Binder B' })

    const distribution: Array<{ containerId: string; count: number }> = [
      { containerId: rootId, count: 200 },
      { containerId: binderA.id, count: 200 },
      { containerId: binderB.id, count: 100 },
    ]

    const allIds: string[] = []
    for (const { containerId, count } of distribution) {
      const ids = Array.from({ length: count }, () => randomUUID())
      allIds.push(...ids)
      await insertCardsBulk(ids)
      await insertHoldingsBulk(containerId, ids, 1, 'nonfoil')
    }
    await insertPricesBulk(allIds, '2024-06-10', { usd: '1.00', usdFoil: '2.00', eur: '0.90', eurFoil: '1.80' })

    queryCount = 0
    updateContainerStatsCount = 0
    const result = await revalueAllContainers({ asOf: new Date('2024-06-10T12:00:00Z') })

    expect(updateContainerStatsCount).toBe(1)
    expect(result.containersUpdated).toBe(3)
    expect(result.referenceDay).toBe('2024-06-10')

    for (const { containerId, count } of distribution) {
      const value = await readContainerValue(containerId, 'usd')
      expect(value.valueMinor).toBe(count * 100)
      expect(value.cardCount).toBe(count)
      expect(value.uniqueCount).toBe(count)
    }
  }, 30_000)

  it('values a container as qty x price of the matching finish, a priceless card counting as 0 without zeroing the total', async () => {
    const userId = await createUser('valuer')
    const { containerId: rootId } = await bootstrapCollection(userId, { username: 'valuer', displayName: null })

    const nonfoilId = randomUUID()
    const foilId = randomUUID()
    const noPriceId = randomUUID()
    await insertCardsBulk([nonfoilId, foilId, noPriceId])
    await insertPricesBulk([nonfoilId, foilId], '2024-06-10', {
      usd: '1.00',
      usdFoil: '5.00',
      eur: '0.90',
      eurFoil: '4.50',
    })
    // `noPriceId` n'a aucune ligne `card_prices` pour ce jour.

    await insertHoldingsBulk(rootId, [nonfoilId], 3, 'nonfoil') // 3 x 1.00 = 300
    await insertHoldingsBulk(rootId, [foilId], 2, 'foil') // 2 x 5.00 = 1000, jamais le prix non-foil
    await insertHoldingsBulk(rootId, [noPriceId], 4, 'nonfoil') // compte pour 0, n'annule pas le total

    await revalueAllContainers({ asOf: new Date('2024-06-10T12:00:00Z') })

    const value = await readContainerValue(rootId, 'usd')
    // Calcul indépendant : 300 + 1000 + 0 = 1300.
    expect(value.valueMinor).toBe(1300)
    expect(value.cardCount).toBe(9) // 3 + 2 + 4
    expect(value.uniqueCount).toBe(3) // 3 lignes de holdings distinctes

    const eurValue = await readContainerValue(rootId, 'eur')
    expect(eurValue.valueMinor).toBe(3 * 90 + 2 * 450 + 0)
  })

  it('counts a card whose own most recent price predates the catalogue-wide max(day) as 0, not its last known price (lib/containers/stats.ts)', async () => {
    // Démontre la sémantique actuelle : `recomputeContainerStats` lit
    // `p.day = (select max(day) from card_prices)`
    // — un jour de référence unique pour tout le catalogue — jamais le
    // dernier jour connu carte par carte (l'ancienne règle, celle encore
    // implémentée par `computeExpectedValue` de `tests/integration/
    // holdings.test.ts`, qui ne peut donc pas distinguer les deux). Une
    // carte dont le dernier prix connu précède ce jour de référence catalogue
    // doit compter pour 0, jamais pour sa dernière valeur connue.
    const userId = await createUser('stalecard')
    const { containerId } = await bootstrapCollection(userId, { username: 'stalecard', displayName: null })

    const staleId = randomUUID() // dernier prix connu : 2024-06-01 seulement.
    const freshId = randomUUID() // prix à 2024-06-01 ET 2024-06-10 — fixe le max(day) catalogue à 2024-06-10.
    await insertCardsBulk([staleId, freshId])
    await insertPricesBulk([staleId], '2024-06-01', { usd: '7.00', usdFoil: null, eur: '6.00', eurFoil: null })
    await insertPricesBulk([freshId], '2024-06-01', { usd: '1.00', usdFoil: null, eur: '1.00', eurFoil: null })
    await insertPricesBulk([freshId], '2024-06-10', { usd: '2.00', usdFoil: null, eur: '1.50', eurFoil: null })

    await insertHoldingsBulk(containerId, [staleId], 1, 'nonfoil') // vaudrait 700/600 sous l'ancienne règle par carte.
    await insertHoldingsBulk(containerId, [freshId], 1, 'nonfoil') // 200/150 au jour de référence 2024-06-10.

    await recomputeContainerStats(containerId)

    const usdValue = await readContainerValue(containerId, 'usd')
    const eurValue = await readContainerValue(containerId, 'eur')
    // staleId compte pour 0 (aucune ligne card_prices à 2024-06-10, le
    // max(day) catalogue), pas pour ses 700/600 de 2024-06-01 : seul freshId
    // contribue.
    expect(usdValue.valueMinor).toBe(200)
    expect(eurValue.valueMinor).toBe(150)
    expect(usdValue.cardCount).toBe(2)
    expect(usdValue.uniqueCount).toBe(2)
  })

  it('computes delta_eur_7d exactly from J and J-7 when both exist', async () => {
    const userIdA = await createUser('withhistory')
    const { containerId: containerA } = await bootstrapCollection(userIdA, {
      username: 'withhistory',
      displayName: null,
    })
    const cardA = randomUUID()
    await insertCardsBulk([cardA])
    await insertHoldingsBulk(containerA, [cardA], 1, 'nonfoil')
    await insertPricesBulk([cardA], '2023-12-25', { usd: null, usdFoil: null, eur: '80.00', eurFoil: null }) // J-7
    await insertPricesBulk([cardA], '2024-01-01', { usd: null, usdFoil: null, eur: '100.00', eurFoil: null }) // J

    const resultA = await revalueAllContainers({ asOf: new Date('2024-01-01T12:00:00Z') })
    expect(resultA.comparisonDay).toBe('2023-12-25')

    const valueA = await readContainerValue(containerA, 'eur')
    // round(((10000 - 8000) / 8000) * 100, 1) = 25.0
    expect(valueA.delta7d).toBe(25)
  })

  // Scénario isolé dans son propre `it()` (et non partagé avec le précédent
  // via une deuxième valorisation dans le même test) : `resolveComparisonDay`
  // interroge `card_prices` pour tout le catalogue, pas par carte — un
  // `card_prices` non vidé entre les deux scénarios aurait laissé la ligne
  // 2023-12-25 du test précédent visible ici, et `pickComparisonDay` l'aurait
  // choisie comme comparaison malgré un historique de 3 jours seulement pour
  // cette carte. Le `TRUNCATE … card_prices …` de `afterEach` garantit que ce
  // test ne voit que les trois jours insérés ci-dessous.
  it('leaves delta and comparisonDay null with only 3 days of history', async () => {
    const userIdB = await createUser('shorthistory')
    const { containerId: containerB } = await bootstrapCollection(userIdB, {
      username: 'shorthistory',
      displayName: null,
    })
    const cardB = randomUUID()
    await insertCardsBulk([cardB])
    await insertHoldingsBulk(containerB, [cardB], 1, 'nonfoil')
    for (const day of ['2024-01-01', '2023-12-31', '2023-12-30']) {
      await insertPricesBulk([cardB], day, { usd: null, usdFoil: null, eur: '10.00', eurFoil: null })
    }

    const resultB = await revalueAllContainers({ asOf: new Date('2024-01-01T12:00:00Z') })
    expect(resultB.comparisonDay).toBeNull()

    const valueB = await readContainerValue(containerB, 'eur')
    expect(valueB.delta7d).toBeNull()
  })

  it('falls back to the nearest available day (J-6) when the exact J-7 day is missing', async () => {
    const userId = await createUser('catchup')
    const { containerId } = await bootstrapCollection(userId, { username: 'catchup', displayName: null })
    const cardId = randomUUID()
    await insertCardsBulk([cardId])
    await insertHoldingsBulk(containerId, [cardId], 1, 'nonfoil')
    // J-7 (2023-12-25) volontairement absent — le worker a sauté cette nuit.
    await insertPricesBulk([cardId], '2023-12-26', { usd: null, usdFoil: null, eur: '50.00', eurFoil: null }) // J-6
    await insertPricesBulk([cardId], '2024-01-01', { usd: null, usdFoil: null, eur: '100.00', eurFoil: null }) // J

    const result = await revalueAllContainers({ asOf: new Date('2024-01-01T12:00:00Z') })

    expect(result.comparisonDay).toBe('2023-12-26')
    const value = await readContainerValue(containerId, 'eur')
    // round(((10000 - 5000) / 5000) * 100, 1) = 100.0
    expect(value.delta7d).toBe(100)
  })

  it('keeps both currencies populated: reading a different currency never issues a write', async () => {
    const userId = await createUser('currency')
    const { containerId } = await bootstrapCollection(userId, { username: 'currency', displayName: null })
    const cardId = randomUUID()
    await insertCardsBulk([cardId])
    await insertHoldingsBulk(containerId, [cardId], 2, 'nonfoil')
    await insertPricesBulk([cardId], '2024-06-10', { usd: '3.00', usdFoil: null, eur: '2.50', eurFoil: null })

    await revalueAllContainers({ asOf: new Date('2024-06-10T12:00:00Z') })

    queryCount = 0
    const usdValue = await readContainerValue(containerId, 'usd')
    const eurValue = await readContainerValue(containerId, 'eur')

    expect(usdValue.valueMinor).toBe(600)
    expect(eurValue.valueMinor).toBe(500)
    // Deux lectures, aucune écriture (changer de devise ne déclenche jamais
    // de recalcul).
    expect(queryCount).toBe(2)
  })

  it('leaves container_stats untouched and logs a status = error row with the message on failure', async () => {
    const userId = await createUser('faulty')
    const { containerId } = await bootstrapCollection(userId, { username: 'faulty', displayName: null })
    const cardId = randomUUID()
    await insertCardsBulk([cardId])
    await insertHoldingsBulk(containerId, [cardId], 1, 'nonfoil')
    await insertPricesBulk([cardId], '2024-06-10', { usd: '1.00', usdFoil: null, eur: '1.00', eurFoil: null })

    const before = await readContainerValue(containerId, 'usd')

    const failure = new Error('simulated failure in the aggregate UPDATE')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
    Client.prototype.query = function (this: any, ...args: unknown[]) {
      const text = typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '')
      if (/UPDATE\s+container_stats/i.test(text)) {
        return Promise.reject(failure)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
      return (originalClientQuery as any).apply(this, args)
    } as typeof Client.prototype.query

    await expect(revalueAllContainers({ asOf: new Date('2024-06-10T12:00:00Z') })).rejects.toThrow(
      'simulated failure',
    )

    Client.prototype.query = originalClientQuery

    const after = await readContainerValue(containerId, 'usd')
    expect(after.valueMinor).toBe(before.valueMinor)
    expect(after.cardCount).toBe(before.cardCount)

    const { rows } = await pool.query<{ status: string; error_message: string | null; source: string }>(
      `SELECT status, error_message, source FROM import_runs WHERE source = 'revalue-containers'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('error')
    expect(rows[0]?.error_message).toBe('simulated failure in the aggregate UPDATE')
  })
})
