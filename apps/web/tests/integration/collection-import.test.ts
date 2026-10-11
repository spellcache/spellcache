// Test d'intégration de l'import CSV vu depuis la collection : où les cartes
// atterrissent, et si chaque lecture (disponibilité, couverture de deck,
// compteurs de l'accueil, `container_stats`) les compte comme possédées
// selon leur destination. Le classement des lignes et l'annulation unitaire
// restent couverts par `import-list.test.ts`.
//
// Les Server Actions passent par `requireSession()` : seul `auth()` est
// mocké, le reste tourne contre la base éphémère `postgres-test`.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  TRUNCATE_ALL,
  aggregateHoldings,
  insertCard,
  insertUser,
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

const MANABOX_HEADER =
  'Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Signed,Condition,Language,Proxy,Purchase price currency'

function manaboxRow(
  name: string,
  setCode: string,
  number: string,
  qty: number,
  foil = 'normal',
): string {
  return `Imported,binder,"${name}",${setCode.toUpperCase()},Set,${number},${foil},rare,${qty},1,${randomUUID()},0,false,false,false,near_mint,en,false,EUR`
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('collection CSV import', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let availabilityMap: typeof import('@/lib/decks/availability').availabilityMap
  let getDeck: typeof import('@/app/(app)/decks/[id]/deck-data').getDeck
  let getCollectionHome: typeof import('@/app/(app)/collection/collection-data').getCollectionHome
  let getContainerHeader: typeof import('@/app/(app)/container/[id]/holdings-data').getContainerHeader
  let createBinderOrListAction: typeof import('@/app/(app)/collection/actions').createBinderOrListAction
  let importListAction: typeof import('@/app/(app)/container/[id]/sharing-actions').importListAction
  let undoImportAction: typeof import('@/app/(app)/container/[id]/sharing-actions').undoImportAction

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ availabilityMap } = await import('@/lib/decks/availability'))
    ;({ getDeck } = await import('@/app/(app)/decks/[id]/deck-data'))
    ;({ getCollectionHome } = await import('@/app/(app)/collection/collection-data'))
    ;({ getContainerHeader } = await import('@/app/(app)/container/[id]/holdings-data'))
    ;({ createBinderOrListAction } = await import('@/app/(app)/collection/actions'))
    ;({ importListAction, undoImportAction } =
      await import('@/app/(app)/container/[id]/sharing-actions'))
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

  async function importInto(containerId: string, text: string) {
    const result = await importListAction({ containerId, text })
    if (!result.ok) throw new Error(`Import failed: ${result.error}`)
    return result
  }

  it('a ManaBox CSV imported into an existing binder makes a planned deck owned', async () => {
    const { userId, collectionId } = await setup('csvbinderdeck')
    const ring = await insertCard(pool, {
      name: 'Sol Ring',
      setCode: 'c21',
      collectorNumber: '263',
    })
    const signet = await insertCard(pool, {
      name: 'Arcane Signet',
      setCode: 'c21',
      collectorNumber: '236',
    })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'From ManaBox',
    })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Needs rocks',
      format: 'commander',
      deckState: 'plan',
    })
    const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const
    await addHolding(userId, { containerId: deck.id, cardId: ring, ...nm }, 1)
    await addHolding(userId, { containerId: deck.id, cardId: signet, ...nm }, 1)
    expect((await getDeck(userId, deck.id)).coverage).toMatchObject({
      owned: 0,
      missing: 2,
    })

    const csv = [
      MANABOX_HEADER,
      manaboxRow('Sol Ring', 'c21', '263', 2),
      manaboxRow('Arcane Signet', 'c21', '236', 1),
    ]
    const result = await importInto(binder.id, csv.join('\r\n'))
    expect(result.imported).toBe(3)

    const available = await availabilityMap(collectionId, [ring, signet])
    expect(available.get(ring)).toBe(2)
    expect(available.get(signet)).toBe(1)
    const after = await getDeck(userId, deck.id)
    expect(after.coverage).toMatchObject({ owned: 2, total: 2, missing: 0 })
    expect(after.slots.every((slot) => slot.state === 'owned')).toBe(true)
  })

  it('the New binder and New list destinations create the container kind they name, and only the binder is owned after an import', async () => {
    const { collectionId } = await setup('newdest')
    await insertCard(pool, { name: 'Ponder', setCode: 'm12', collectorNumber: '73' })
    const preordain = await insertCard(pool, {
      name: 'Preordain',
      setCode: 'm11',
      collectorNumber: '70',
    })
    const binder = await createBinderOrListAction({
      kind: 'binder',
      name: 'Imported binder',
    })
    const list = await createBinderOrListAction({ kind: 'list', name: 'Imported list' })
    expect(binder).toMatchObject({ ok: true, kind: 'binder' })
    expect(list).toMatchObject({ ok: true, kind: 'list' })
    if (!binder.ok || !list.ok) throw new Error('unreachable')

    const { rows } = await pool.query<{ id: string; kind: string }>(
      'SELECT id, kind FROM containers WHERE id = ANY($1::uuid[])',
      [[binder.containerId, list.containerId]],
    )
    expect(Object.fromEntries(rows.map((row) => [row.id, row.kind]))).toEqual({
      [binder.containerId]: 'binder',
      [list.containerId]: 'list',
    })

    const home = await getCollectionHome(authState.user!.id)
    expect(home.binders.map((b) => b.name)).toEqual(['Imported binder'])
    expect(home.lists.map((l) => l.name)).toEqual(['Imported list'])

    // Même enchaînement que la feuille d'import : création, puis import
    // dans le container tout juste créé.
    await importInto(
      binder.containerId,
      [MANABOX_HEADER, manaboxRow('Ponder', 'm12', '73', 2)].join('\n'),
    )
    await importInto(
      list.containerId,
      [MANABOX_HEADER, manaboxRow('Preordain', 'm11', '70', 3)].join('\n'),
    )
    const ponder = (
      await pool.query<{ id: string }>("SELECT id FROM cards WHERE name = 'Ponder'")
    ).rows[0]!.id
    const available = await availabilityMap(collectionId, [ponder, preordain])
    expect(available.get(ponder)).toBe(2)
    expect(available.get(preordain)).toBe(0)
  })

  it('a CSV imported into the root is owned, the same CSV imported into a list is not', async () => {
    const { userId, collectionId, rootId } = await setup('rootvslist')
    const owned = await insertCard(pool, {
      name: 'Path to Exile',
      setCode: '2xm',
      collectorNumber: '25',
    })
    const wanted = await insertCard(pool, {
      name: 'Force of Will',
      setCode: '2xm',
      collectorNumber: '51',
    })
    const wishlist = await createContainer(userId, collectionId, {
      kind: 'list',
      name: 'Wants',
    })

    await importInto(
      rootId,
      [MANABOX_HEADER, manaboxRow('Path to Exile', '2xm', '25', 2)].join('\n'),
    )
    await importInto(
      wishlist.id,
      [MANABOX_HEADER, manaboxRow('Force of Will', '2xm', '51', 4)].join('\n'),
    )

    const available = await availabilityMap(collectionId, [owned, wanted])
    expect(available.get(owned)).toBe(2)
    expect(available.get(wanted)).toBe(0)
    expect((await getContainerHeader(userId, rootId)).cardCount).toBe(2)
    const home = await getCollectionHome(userId)
    expect(home.lists[0]).toMatchObject({ name: 'Wants', cardCount: 4 })
  })

  it('importing the same CSV twice merges quantities, and undoing the second import restores the first', async () => {
    const { userId, collectionId } = await setup('twice')
    await insertCard(pool, {
      name: 'Lightning Bolt',
      setCode: '2x2',
      collectorNumber: '117',
      priceEur: 1,
    })
    await insertCard(pool, {
      name: 'Counterspell',
      setCode: '2x2',
      collectorNumber: '48',
      priceEur: 1,
    })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'Twice',
    })
    const csv = [
      MANABOX_HEADER,
      manaboxRow('Lightning Bolt', '2x2', '117', 4),
      manaboxRow('Lightning Bolt', '2x2', '117', 1, 'foil'),
      manaboxRow('Counterspell', '2x2', '48', 2),
    ].join('\n')

    await importInto(binder.id, csv)
    const afterFirst = await snapshotHoldings(pool, collectionId)
    const statsAfterFirst = await readStats(pool, binder.id)

    const second = await importInto(binder.id, csv)
    const { rows } = await pool.query<{ qty: number }>(
      'SELECT qty FROM holdings WHERE container_id = $1 ORDER BY qty',
      [binder.id],
    )
    // Trois clés, jamais six lignes : chaque quantité a doublé.
    expect(rows.map((row) => row.qty)).toEqual([2, 4, 8])

    expect(await undoImportAction({ undoToken: second.undoToken })).toEqual({
      ok: true,
      undone: true,
    })
    expect(await snapshotHoldings(pool, collectionId)).toEqual(afterFirst)
    expect(await readStats(pool, binder.id)).toEqual(statsAfterFirst)
  })

  it('one card name in two printings becomes two holdings, each owned as the same card', async () => {
    const { userId, collectionId } = await setup('twoprints')
    const oracleId = randomUUID()
    const lea = await insertCard(pool, {
      name: 'Dark Ritual',
      oracleId,
      setCode: 'lea',
      collectorNumber: '98',
    })
    const mmq = await insertCard(pool, {
      name: 'Dark Ritual',
      oracleId,
      setCode: 'mmq',
      collectorNumber: '127',
    })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'Black',
    })

    await importInto(
      binder.id,
      [
        MANABOX_HEADER,
        manaboxRow('Dark Ritual', 'lea', '98', 1),
        manaboxRow('Dark Ritual', 'mmq', '127', 3),
      ].join('\n'),
    )

    const { rows } = await pool.query<{ card_id: string; qty: number }>(
      'SELECT card_id, qty FROM holdings WHERE container_id = $1',
      [binder.id],
    )
    expect(Object.fromEntries(rows.map((row) => [row.card_id, row.qty]))).toEqual({
      [lea]: 1,
      [mmq]: 3,
    })
    const available = await availabilityMap(collectionId, [lea, mmq])
    // La disponibilité compte la carte, pas l'impression : 1 + 3 sous l'une
    // comme sous l'autre.
    expect(available.get(lea)).toBe(4)
    expect(available.get(mmq)).toBe(4)
  })

  it('after an import, the binder stats, its home row and the All collection header all match the holdings', async () => {
    const { userId, collectionId, rootId } = await setup('statsafter')
    await insertCard(pool, {
      name: 'Rhystic Study',
      setCode: 'pcy',
      collectorNumber: '45',
      priceEur: 30,
      priceEurFoil: 90,
    })
    await insertCard(pool, {
      name: 'Cyclonic Rift',
      setCode: 'rtr',
      collectorNumber: '35',
      priceEur: 20,
    })
    const ring = await insertCard(pool, {
      name: 'Sol Ring',
      setCode: 'c21',
      collectorNumber: '263',
      priceEur: 1,
    })
    const binder = await createContainer(userId, collectionId, {
      kind: 'binder',
      name: 'Staples',
    })
    await addHolding(
      userId,
      {
        containerId: rootId,
        cardId: ring,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
      },
      1,
    )

    await importInto(
      binder.id,
      [
        MANABOX_HEADER,
        manaboxRow('Rhystic Study', 'pcy', '45', 1, 'foil'),
        manaboxRow('Rhystic Study', 'pcy', '45', 2),
        manaboxRow('Cyclonic Rift', 'rtr', '35', 1),
      ].join('\n'),
    )

    const binderStats = await readStats(pool, binder.id)
    expect(binderStats).toEqual(await aggregateHoldings(pool, [binder.id]))
    expect(binderStats).toEqual({
      cards: 4,
      unique: 3,
      valueEurMinor: 9000 + 6000 + 2000,
    })

    const home = await getCollectionHome(userId)
    expect(home.binders[0]).toMatchObject({ cardCount: 4, valueMinor: 17000 })

    const header = await getContainerHeader(userId, rootId)
    expect(header.cardCount).toBe(5)
    expect(header.valueMinor).toBe(17100)
  })
})
