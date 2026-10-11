// Invariants de la collection, vérifiés après chaque mutation plutôt que
// fonction par fonction : une fonctionnalité nouvelle qui écrit dans
// `holdings` sans tenir `container_stats`, qui duplique une clé de fusion ou
// qui fait entrer une liste dans le stock casse l'un d'eux, quel que soit
// l'écran par lequel elle passe.
//
// La séquence aléatoire est tirée d'une graine fixe : un échec se rejoue à
// l'identique, et le message d'échec donne l'étape et l'opération.
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  TRUNCATE_ALL,
  aggregateHoldings,
  insertCard,
  insertUser,
  ownedContainerIds,
  readStats,
  snapshotHoldings,
} from '../utils/collection-fixture'

const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string
    email: string
    username: string
    displayName: string | null
    role: string
  },
}))
vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}))

// mulberry32 : générateur déterministe minimal, suffisant pour tirer des
// opérations.
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FINISHES = ['nonfoil', 'foil'] as const
const CONDITIONS = ['nm', 'lp', 'mp'] as const
const LANGUAGES = ['en', 'fr'] as const

describe.skipIf(!process.env.TEST_DATABASE_URL)('collection invariants', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let containersLib: typeof import('@/lib/containers/containers')
  let holdingsLib: typeof import('@/lib/containers/holdings')
  let bulkLib: typeof import('@/lib/containers/bulk')
  let availabilityMap: typeof import('@/lib/decks/availability').availabilityMap
  let getContainerHeader: typeof import('@/app/(app)/container/[id]/holdings-data').getContainerHeader
  let sharingActions: typeof import('@/app/(app)/container/[id]/sharing-actions')
  let containerActions: typeof import('@/app/(app)/container/[id]/actions')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    containersLib = await import('@/lib/containers/containers')
    holdingsLib = await import('@/lib/containers/holdings')
    bulkLib = await import('@/lib/containers/bulk')
    ;({ availabilityMap } = await import('@/lib/decks/availability'))
    ;({ getContainerHeader } = await import('@/app/(app)/container/[id]/holdings-data'))
    sharingActions = await import('@/app/(app)/container/[id]/sharing-actions')
    containerActions = await import('@/app/(app)/container/[id]/actions')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    authState.user = null
    await pool.query(TRUNCATE_ALL)
  })

  async function setup(username: string) {
    const userId = await insertUser(pool, username)
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    authState.user = {
      id: userId,
      email: `${username}@example.com`,
      username,
      displayName: null,
      role: 'member',
    }
    return { userId, collectionId, rootId }
  }

  async function allContainerIds(collectionId: string): Promise<string[]> {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM containers WHERE collection_id = $1',
      [collectionId],
    )
    return rows.map((row) => row.id)
  }

  async function holdingsIn(
    containerId: string,
  ): Promise<Array<{ id: string; qty: number }>> {
    const { rows } = await pool.query<{ id: string; qty: number }>(
      'SELECT id, qty FROM holdings WHERE container_id = $1 ORDER BY id',
      [containerId],
    )
    return rows
  }

  async function allStats(collectionId: string): Promise<Record<string, unknown>> {
    const entries = await Promise.all(
      (await allContainerIds(collectionId)).map(
        async (id) => [id, await readStats(pool, id)] as const,
      ),
    )
    return Object.fromEntries(entries)
  }

  async function assertInvariants(
    userId: string,
    collectionId: string,
    rootId: string,
    cardIds: string[],
    context: string,
  ) {
    for (const containerId of await allContainerIds(collectionId)) {
      expect(
        await readStats(pool, containerId),
        `${context}: container_stats of ${containerId}`,
      ).toEqual(await aggregateHoldings(pool, [containerId]))
    }

    const owned = await aggregateHoldings(
      pool,
      await ownedContainerIds(pool, collectionId),
    )
    const header = await getContainerHeader(userId, rootId)
    expect(header.cardCount, `${context}: All collection count`).toBe(owned.cards)

    const { rows: duplicates } = await pool.query(
      `SELECT 1 FROM holdings h JOIN containers c ON c.id = h.container_id
        WHERE c.collection_id = $1
        GROUP BY h.container_id, h.card_id, h.finish, h.condition, h.language, h.zone
       HAVING count(*) > 1`,
      [collectionId],
    )
    expect(duplicates, `${context}: duplicated merge keys`).toHaveLength(0)

    const { rows: nonPositive } = await pool.query(
      `SELECT 1 FROM holdings h JOIN containers c ON c.id = h.container_id
        WHERE c.collection_id = $1 AND h.qty <= 0`,
      [collectionId],
    )
    expect(nonPositive, `${context}: non-positive quantities`).toHaveLength(0)

    const { rows: expectedRows } = await pool.query<{ card_id: string; qty: string }>(
      `SELECT h.card_id, sum(h.qty) AS qty FROM holdings h JOIN containers c ON c.id = h.container_id
        WHERE c.collection_id = $1 AND c.kind IN ('collection', 'binder')
        GROUP BY h.card_id`,
      [collectionId],
    )
    const expected = new Map(cardIds.map((id) => [id, 0]))
    for (const row of expectedRows) expected.set(row.card_id, Number(row.qty))
    expect(
      await availabilityMap(collectionId, cardIds),
      `${context}: availability`,
    ).toEqual(expected)
  }

  it('keeps stats, merge keys and ownership consistent across a seeded random sequence of 200 mutations', async () => {
    const { userId, collectionId, rootId } = await setup('randomwalk')
    const random = seeded(20261011)
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!

    const cards: Array<{ id: string; name: string; setCode: string; number: string }> = []
    for (let i = 0; i < 8; i += 1) {
      const setCode = 'inv'
      const number = String(100 + i)
      const name = `Invariant card ${i}`
      cards.push({
        id: await insertCard(pool, {
          name,
          setCode,
          collectorNumber: number,
          priceEur: i + 0.5,
          priceEurFoil: i + 2,
        }),
        name,
        setCode,
        number,
      })
    }
    const cardIds = cards.map((card) => card.id)

    const binders = [
      (
        await containersLib.createContainer(userId, collectionId, {
          kind: 'binder',
          name: 'Binder A',
        })
      ).id,
      (
        await containersLib.createContainer(userId, collectionId, {
          kind: 'binder',
          name: 'Binder B',
        })
      ).id,
    ]
    const list = (
      await containersLib.createContainer(userId, collectionId, {
        kind: 'list',
        name: 'Wishlist',
      })
    ).id
    const live = () => [rootId, ...binders, list]

    const randomKey = (containerId: string) => ({
      containerId,
      cardId: pick(cardIds),
      finish: pick(FINISHES),
      condition: pick(CONDITIONS),
      language: pick(LANGUAGES),
    })

    const operations: Record<string, () => Promise<void>> = {
      add: async () => {
        await holdingsLib.addHolding(
          userId,
          randomKey(pick(live())),
          1 + Math.floor(random() * 3),
        )
      },
      setQuantity: async () => {
        const rows = await holdingsIn(pick(live()))
        if (rows.length === 0) return
        const row = pick(rows)
        await holdingsLib.setHoldingQuantity(
          userId,
          row.id,
          row.qty + pick([-2, -1, 1, 2]),
        )
      },
      move: async () => {
        const source = pick(live())
        const rows = await holdingsIn(source)
        if (rows.length === 0) return
        const target = pick(live().filter((id) => id !== source))
        await holdingsLib.moveHoldings(userId, [pick(rows).id], target)
      },
      edit: async () => {
        const rows = await holdingsIn(pick(live()))
        if (rows.length === 0) return
        await holdingsLib.updateHolding(userId, pick(rows).id, {
          condition: pick(CONDITIONS),
          finish: pick(FINISHES),
        })
      },
      bulkEdit: async () => {
        const containerId = pick(live())
        const rows = await holdingsIn(containerId)
        if (rows.length < 2) return
        const ids = rows.slice(0, 2).map((row) => row.id)
        await bulkLib.bulkEdit(
          userId,
          { containerId, holdingIds: ids },
          { condition: pick(CONDITIONS) },
        )
      },
      // Depuis la vue racine, une sélection mêle le vrac et les binders, et
      // part vers un autre container : chaque binder d'origine doit être
      // recalculé.
      bulkMoveFromRoot: async () => {
        const mixed = [...(await holdingsIn(rootId)), ...(await holdingsIn(pick(binders)))]
        if (mixed.length === 0) return
        const ids = [pick(mixed).id, pick(mixed).id].filter((id, i, all) => all.indexOf(id) === i)
        await bulkLib.bulkEdit(
          userId,
          { containerId: rootId, holdingIds: ids },
          { targetContainerId: pick([...binders, list]) },
        )
      },
      removeThenUndo: async () => {
        const rows = await holdingsIn(pick(live()))
        if (rows.length === 0) return
        const { undoToken } = await holdingsLib.removeHoldings(userId, [pick(rows).id])
        if (random() < 0.5) await holdingsLib.restoreHoldings(userId, undoToken)
      },
      importCsv: async () => {
        const lines = ['Name,Quantity,Set code,Collector number,Foil,Condition,Language']
        for (let i = 0; i < 3; i += 1) {
          const card = pick(cards)
          lines.push(
            `${card.name},${1 + Math.floor(random() * 3)},${card.setCode},${card.number},${pick(['normal', 'foil'])},${pick(['near_mint', 'lightly_played'])},${pick(LANGUAGES)}`,
          )
        }
        const result = await sharingActions.importListAction({
          containerId: pick(live()),
          text: lines.join('\n'),
        })
        if (!result.ok) throw new Error(`import failed: ${result.error}`)
        if (random() < 0.3)
          await sharingActions.undoImportAction({ undoToken: result.undoToken })
      },
      deleteBinder: async () => {
        // Rare : garde au moins un binder vivant la plupart du temps.
        if (binders.length === 0 || random() > 0.15) return
        const index = Math.floor(random() * binders.length)
        await containersLib.deleteBinder(userId, binders[index]!)
        binders.splice(index, 1)
        binders.push(
          (
            await containersLib.createContainer(userId, collectionId, {
              kind: 'binder',
              name: `Binder ${Date.now()}`,
            })
          ).id,
        )
      },
    }
    const names = Object.keys(operations)

    for (let step = 0; step < 200; step += 1) {
      const name = pick(names)
      await operations[name]!()
      await assertInvariants(
        userId,
        collectionId,
        rootId,
        cardIds,
        `step ${step} (${name})`,
      )
    }

    // La séquence a bien laissé du stock et une liste remplie à vérifier.
    expect(
      (await aggregateHoldings(pool, await ownedContainerIds(pool, collectionId))).cards,
    ).toBeGreaterThan(0)
    expect((await readStats(pool, list)).cards).toBeGreaterThan(0)
  }, 120_000)

  describe('undo restores holdings and stats exactly', () => {
    async function fixture(username: string) {
      const base = await setup(username)
      const { userId, collectionId, rootId } = base
      const binder = (
        await containersLib.createContainer(userId, collectionId, {
          kind: 'binder',
          name: 'Undo binder',
        })
      ).id
      const list = (
        await containersLib.createContainer(userId, collectionId, {
          kind: 'list',
          name: 'Undo list',
        })
      ).id
      const cards: string[] = []
      for (let i = 0; i < 4; i += 1) {
        cards.push(
          await insertCard(pool, {
            name: `Undo card ${i}`,
            setCode: 'und',
            collectorNumber: String(i + 1),
            priceEur: i + 1,
          }),
        )
      }
      const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const
      await holdingsLib.addHolding(
        userId,
        { containerId: rootId, cardId: cards[0]!, ...nm },
        2,
      )
      await holdingsLib.addHolding(
        userId,
        { containerId: rootId, cardId: cards[1]!, ...nm },
        1,
      )
      await holdingsLib.addHolding(
        userId,
        { containerId: binder, cardId: cards[1]!, ...nm },
        3,
      )
      await holdingsLib.addHolding(
        userId,
        { containerId: binder, cardId: cards[2]!, ...nm },
        4,
      )
      await holdingsLib.addHolding(
        userId,
        { containerId: list, cardId: cards[3]!, ...nm },
        1,
      )
      return { ...base, binder, list, cards }
    }

    type Fixture = Awaited<ReturnType<typeof fixture>>
    const cases: Array<[string, (f: Fixture) => Promise<() => Promise<unknown>>]> = [
      [
        'quantity set to zero, then Undo',
        async (f) => {
          const [row] = await holdingsIn(f.binder)
          const result = await containerActions.setQuantityAction({
            holdingId: row!.id,
            qty: 0,
          })
          if (!result.ok || !result.undoToken) throw new Error('no undo token')
          return () => containerActions.undoAction({ undoToken: result.undoToken })
        },
      ],
      [
        'bulk condition edit across root and binder, then Undo',
        async (f) => {
          const ids = [
            ...(await holdingsIn(f.rootId)),
            ...(await holdingsIn(f.binder)),
          ].map((row) => row.id)
          const { undoToken } = await bulkLib.bulkEdit(
            f.userId,
            { containerId: f.rootId, holdingIds: ids },
            { condition: 'hp' },
          )
          return () => bulkLib.bulkUndo(f.userId, undoToken)
        },
      ],
      [
        'bulk move into the list, then Undo',
        async (f) => {
          const ids = (await holdingsIn(f.binder)).map((row) => row.id)
          const { undoToken } = await bulkLib.bulkEdit(
            f.userId,
            { containerId: f.binder, holdingIds: ids },
            { targetContainerId: f.list },
          )
          return () => bulkLib.bulkUndo(f.userId, undoToken)
        },
      ],
      [
        'bulk delete, then Undo',
        async (f) => {
          const ids = (await holdingsIn(f.rootId)).map((row) => row.id)
          const { undoToken } = await bulkLib.bulkDelete(f.userId, {
            containerId: f.rootId,
            holdingIds: ids,
          })
          return () => bulkLib.bulkUndo(f.userId, undoToken)
        },
      ],
      [
        'list deletion, then Undo',
        async (f) => {
          const { undoToken } = await containersLib.deleteContainer(f.userId, f.list)
          return () => containersLib.restoreContainer(f.userId, undoToken)
        },
      ],
      [
        'CSV import into the binder, then Undo',
        async (f) => {
          const text = [
            'Name,Quantity,Set code,Collector number',
            'Undo card 1,2,und,2',
            'Undo card 3,5,und,4',
          ].join('\n')
          const result = await sharingActions.importListAction({
            containerId: f.binder,
            text,
          })
          if (!result.ok) throw new Error(result.error)
          return () => sharingActions.undoImportAction({ undoToken: result.undoToken })
        },
      ],
    ]

    it.each(cases)('%s', async (_label, act) => {
      const f = await fixture(`undo${Math.random().toString(36).slice(2, 10)}`)
      const holdingsBefore = await snapshotHoldings(pool, f.collectionId)
      const statsBefore = await allStats(f.collectionId)

      const undo = await act(f)
      expect(await snapshotHoldings(pool, f.collectionId)).not.toEqual(holdingsBefore)
      await undo()

      expect(await snapshotHoldings(pool, f.collectionId)).toEqual(holdingsBefore)
      expect(await allStats(f.collectionId)).toEqual(statsBefore)
    })
  })
})
