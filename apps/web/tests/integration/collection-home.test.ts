// Test d'intégration : agrégats de
// `getCollectionHome` vérifiés contre une requête indépendante sur
// `holdings`, nombre total de requêtes SQL émises, `added this week` sur une
// fenêtre de 7 jours, et cloisonnement par collection. Contre la base
// éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ; se
// saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Collection home data', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/app/(app)/collection/collection-data`
  // (donc de `@spellcache/db`, singleton créé à l'évaluation du module — même
  // contrainte que tests/integration/holdings.test.ts).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let getCollectionHome: typeof import('@/app/(app)/collection/collection-data').getCollectionHome

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ getCollectionHome } = await import('@/app/(app)/collection/collection-data'))
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

  async function insertCard(id: string, setCode: string): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
      [setCode],
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $2, $1::text, $3, '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [id, randomUUID(), setCode],
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil) VALUES ($1, current_date, 1.00, 2.00, 0.90, 1.80)`,
      [id],
    )
  }

  // Requête indépendante : recompte
  // directement `holdings`, un chemin de calcul distinct de la requête
  // agrégée de `getCollectionHome`.
  async function independentCounts(containerId: string): Promise<{ cards: number; unique: number }> {
    const { rows } = await pool.query<{ cards: string; unique: string }>(
      'SELECT coalesce(sum(qty), 0) AS cards, count(*) AS unique FROM holdings WHERE container_id = $1',
      [containerId],
    )
    return { cards: Number(rows[0]!.cards), unique: Number(rows[0]!.unique) }
  }

  let queryCount = 0
  let originalQuery: typeof Pool.prototype.query

  beforeEach(() => {
    queryCount = 0
    originalQuery = Pool.prototype.query
    // Compte les requêtes SQL réellement émises par le pool `pg` sous-jacent au
    // singleton `db` (pas plus de deux requêtes SQL au total) — pas un simple
    // recomptage manuel des appels `db.select`/`db.execute`, qui ne verrait pas
    // un aller-retour caché dans une couche intermédiaire.
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

  it('matches an independent holdings query and emits at most two SQL statements', async () => {
    const userId = await createUser('collector')
    const { containerId: rootId, collectionId } = await bootstrapCollection(userId, {
      username: 'collector',
      displayName: null,
    })

    const binderIds: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const binder = await createContainer(userId, collectionId, { kind: 'binder', name: `Binder ${i}` })
      binderIds.push(binder.id)
    }

    // 40 holdings au total : 10 dans le container racine, 10 dans chacun des
    // trois binders.
    const containerTargets = [rootId, ...binderIds]
    for (const containerId of containerTargets) {
      for (let i = 0; i < 10; i += 1) {
        const cardId = randomUUID()
        await insertCard(cardId, 'lea')
        await addHolding(userId, { containerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, i + 1)
      }
    }

    const expectedRoot = await independentCounts(rootId)

    // Ne compter que les requêtes émises par l'appel lui-même : tout le montage
    // de la fixture ci-dessus (compte, bootstrap, 3 binders, 40 holdings —
    // plusieurs centaines de requêtes) doit être exclu de l'assertion, sans
    // quoi elle échouerait toujours, qu'il y ait ou non une régression dans
    // `getCollectionHome`.
    queryCount = 0
    const result = await getCollectionHome(userId)

    expect(queryCount).toBeLessThanOrEqual(2)

    expect(result.counts.cards).toBe(expectedRoot.cards)
    expect(result.counts.unique).toBe(expectedRoot.unique)
    expect(result.binders).toHaveLength(3)

    for (const binderId of binderIds) {
      const expectedBinder = await independentCounts(binderId)
      const summary = result.binders.find((b) => b.id === binderId)
      expect(summary?.cardCount).toBe(expectedBinder.cards)
    }
  })

  it('reads the value card amount from the root container_stats row, never aggregating holdings', async () => {
    const userId = await createUser('valuer')
    const { containerId: rootId, collectionId } = await bootstrapCollection(userId, {
      username: 'valuer',
      displayName: null,
    })
    void collectionId

    const cardId = randomUUID()
    await insertCard(cardId, 'lea')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)

    const result = await getCollectionHome(userId)

    // Prix unitaire 1.00 USD, qty 2 → 200 centimes (container_stats, pas une
    // resomme des holdings au rendu).
    expect(result.value.amountMinor).toBe(200)
    expect(result.value.currency).toBe('usd')
  })

  it('a delta of null hides the variation chip; the source module never aggregates via sum(', async () => {
    const userId = await createUser('novariation')
    await bootstrapCollection(userId, { username: 'novariation', displayName: null })

    const result = await getCollectionHome(userId)
    expect(result.value.delta7d).toBeNull()

    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../app/(app)/collection/collection-data.ts', import.meta.url), 'utf-8'),
    )
    // L'interdit d'architecture porte sur l'agrégation des HOLDINGS au rendu
    // (docs/development.md : « le bandeau de valeur lit une ligne ») — sommer quelques
    // lignes `container_stats` précalculées (l'étagère `Built decks`) reste
    // conforme. On interdit donc `sum(h.` (alias des holdings), pas tout
    // `sum(`.
    expect(source).not.toContain('sum(h.')
    expect(source).toContain('container_stats')
  })

  it('surfaces a non-null delta as a number, ready for the chip to render', async () => {
    const userId = await createUser('variation')
    const { containerId: rootContainerId } = await bootstrapCollection(userId, {
      username: 'variation',
      displayName: null,
    })

    // `delta_usd_7d`/`delta_eur_7d` sont posées par la revalorisation
    // quotidienne : ici écrites directement, seul moyen de produire une valeur
    // non nulle sans dépendre du worker.
    await pool.query(`UPDATE container_stats SET delta_usd_7d = 2.4 WHERE container_id = $1`, [
      rootContainerId,
    ])

    const result = await getCollectionHome(userId)
    expect(result.value.delta7d).toBe(2.4)
  })

  it('counts holdings added within the last 7 days across the whole collection, not just the root container', async () => {
    const userId = await createUser('recent')
    const { containerId: rootId, collectionId } = await bootstrapCollection(userId, {
      username: 'recent',
      displayName: null,
    })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Recent binder' })

    const recentRootCardId = randomUUID()
    const recentBinderCardId = randomUUID()
    const staleCardId = randomUUID()
    await insertCard(recentRootCardId, 'lea')
    await insertCard(recentBinderCardId, 'lea')
    await insertCard(staleCardId, 'lea')

    const { holdingId: recentRootHoldingId } = await addHolding(
      userId,
      { containerId: rootId, cardId: recentRootCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    // Ajoutée dans un binder, pas le container racine (« added this week »
    // compte pour la collection, pas le container racine seul) — sans cette
    // ligne, une régression qui borne le compteur au container racine ne serait
    // pas détectée.
    const { holdingId: recentBinderHoldingId } = await addHolding(
      userId,
      { containerId: binder.id, cardId: recentBinderCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    const { holdingId: staleHoldingId } = await addHolding(
      userId,
      { containerId: rootId, cardId: staleCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )

    await pool.query(`UPDATE holdings SET added_at = now() - interval '6 days' WHERE id = $1`, [recentRootHoldingId])
    await pool.query(`UPDATE holdings SET added_at = now() - interval '6 days' WHERE id = $1`, [
      recentBinderHoldingId,
    ])
    await pool.query(`UPDATE holdings SET added_at = now() - interval '8 days' WHERE id = $1`, [staleHoldingId])

    const result = await getCollectionHome(userId)
    expect(result.counts.addedThisWeek).toBe(2)
  })

  it('scopes binders to the caller collection only, never leaking another member', async () => {
    const userA = await createUser('alice')
    const { collectionId: collectionA } = await bootstrapCollection(userA, { username: 'alice', displayName: null })
    await createContainer(userA, collectionA, { kind: 'binder', name: "Alice's binder" })

    const userB = await createUser('bob')
    await bootstrapCollection(userB, { username: 'bob', displayName: null })

    const resultB = await getCollectionHome(userB)
    expect(resultB.binders).toHaveLength(0)

    const resultA = await getCollectionHome(userA)
    expect(resultA.binders.map((b) => b.name)).toEqual(["Alice's binder"])
  })
})
