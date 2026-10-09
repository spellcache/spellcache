// Test d'intégration des actions groupées : transaction
// atomique, un seul recalcul de `container_stats` par container touché,
// undo à l'identique dans la fenêtre de 6 secondes puis expiré au-delà, «
// Select all » sur la vue filtrée entière, et refus sur un deck monté. Contre
// la base éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ;
// se saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible) — même garde que `tests/integration/holdings.test.ts`.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Actions groupées', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/lib/containers/bulk` (donc
  // de `@spellcache/db`, singleton créé à l'évaluation du module — même contrainte
  // que `tests/integration/holdings.test.ts`).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let holdings: typeof import('@spellcache/db/schema').holdings
  let containers: typeof import('@spellcache/db/schema').containers
  let containerStats: typeof import('@spellcache/db/schema').containerStats
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let statsModule: typeof import('@/lib/containers/stats')
  let bulkEdit: typeof import('@/lib/containers/bulk').bulkEdit
  let bulkDelete: typeof import('@/lib/containers/bulk').bulkDelete
  let bulkUndo: typeof import('@/lib/containers/bulk').bulkUndo
  let DeckLockedError: typeof import('@/lib/containers/bulk').DeckLockedError
  let EMPTY_FILTERS: typeof import('@/lib/view-state/parse').EMPTY_FILTERS

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, holdings, containers, containerStats } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    statsModule = await import('@/lib/containers/stats')
    ;({ bulkEdit, bulkDelete, bulkUndo, DeckLockedError } = await import('@/lib/containers/bulk'))
    ;({ EMPTY_FILTERS } = await import('@/lib/view-state/parse'))
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

  async function createContainerFor(username: string): Promise<{ userId: string; collectionId: string; containerId: string }> {
    const userId = await createUser(username)
    const { containerId, collectionId } = await bootstrapCollection(userId, { username, displayName: null })
    return { userId, collectionId, containerId }
  }

  async function insertCard(opts: { id: string; name: string; setCode: string }): Promise<void> {
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

  async function addHoldingRow(opts: {
    containerId: string
    cardId: string
    qty?: number
    condition?: string
    finish?: string
  }): Promise<string> {
    const [row] = await db
      .insert(holdings)
      .values({
        containerId: opts.containerId,
        cardId: opts.cardId,
        qty: opts.qty ?? 1,
        condition: (opts.condition ?? 'nm') as 'nm',
        finish: (opts.finish ?? 'nonfoil') as 'nonfoil',
      })
      .returning({ id: holdings.id })
    return row!.id
  }

  async function readHolding(id: string) {
    const [row] = await db.select().from(holdings).where(eq(holdings.id, id)).limit(1)
    return row
  }

  it('modifies exactly the targeted holdings, leaves other fields untouched, and recomputes stats once', async () => {
    const { userId, containerId } = await createContainerFor('bulk-condition')
    const ids: string[] = []
    for (let i = 0; i < 12; i++) {
      const cardId = randomUUID()
      await insertCard({ id: cardId, name: `Card ${i}`, setCode: 'mh2' })
      ids.push(await addHoldingRow({ containerId, cardId, qty: 3, finish: 'foil' }))
    }
    // Une ligne hors sélection : ne doit jamais être touchée.
    const outsideCardId = randomUUID()
    await insertCard({ id: outsideCardId, name: 'Outside', setCode: 'mh2' })
    const outsideId = await addHoldingRow({ containerId, cardId: outsideCardId, qty: 5, condition: 'mp' })

    const spy = vi.spyOn(statsModule, 'recomputeContainerStats')
    spy.mockClear()

    const result = await bulkEdit(userId, { containerId, holdingIds: ids }, { condition: 'lp' })

    expect(result.affected).toBe(12)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()

    for (const id of ids) {
      const row = await readHolding(id)
      expect(row?.condition).toBe('lp')
      expect(row?.qty).toBe(3)
      expect(row?.finish).toBe('foil')
    }
    const outsideRow = await readHolding(outsideId)
    expect(outsideRow?.condition).toBe('mp')
  })

  it('rolls back the whole transaction when a targeted holding no longer exists', async () => {
    const { userId, containerId } = await createContainerFor('bulk-rollback')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Brainstorm', setCode: 'mh2' })
    const survivorId = await addHoldingRow({ containerId, cardId, qty: 4, condition: 'nm' })
    const missingId = randomUUID()

    await expect(
      bulkEdit(userId, { containerId, holdingIds: [survivorId, missingId] }, { condition: 'hp' }),
    ).rejects.toThrow()

    const survivorRow = await readHolding(survivorId)
    expect(survivorRow?.condition).toBe('nm')
    expect(survivorRow?.qty).toBe(4)
  })

  it('restores identical rows within the undo window, then refuses an expired token', async () => {
    vi.useFakeTimers()
    const { userId, containerId } = await createContainerFor('bulk-undo')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Ponder', setCode: 'thb' })
    const id = await addHoldingRow({ containerId, cardId, qty: 2, condition: 'lp', finish: 'foil' })
    const before = await readHolding(id)

    const result = await bulkDelete(userId, { containerId, holdingIds: [id] })
    expect(result.affected).toBe(1)
    expect(await readHolding(id)).toBeUndefined()

    const restored = await bulkUndo(userId, result.undoToken)
    expect(restored.restored).toBe(1)
    const after = await readHolding(id)
    expect(after?.qty).toBe(before?.qty)
    expect(after?.condition).toBe(before?.condition)
    expect(after?.finish).toBe(before?.finish)
    expect(after?.addedAt).toEqual(before?.addedAt)

    // Au-delà de 6 secondes, le jeton est expiré et rien n'est restauré —
    // le magasin en mémoire (`globalThis.__spellcacheBulkUndo`) est manipulé
    // directement plutôt que d'attendre 6 secondes réelles ou de mélanger
    // de faux timers avec le vrai pilote `pg` (source connue de tests
    // instables) : même contrainte que le TTL en mémoire documenté par
    // `lib/containers/holdings.ts`.
    const second = await bulkDelete(userId, { containerId, holdingIds: [id] })
    const store = globalThis.__spellcacheBulkUndo
    const entry = store?.get(second.undoToken)
    expect(entry).toBeDefined()
    store!.set(second.undoToken, { ...entry!, expiresAt: Date.now() - 1 })

    const expired = await bulkUndo(userId, second.undoToken)
    expect(expired.restored).toBe(0)
    expect(await readHolding(id)).toBeUndefined()
  })

  it('preserves the total quantity and stays reversible when a bulk edit merges two selected rows (regression)', async () => {
    // A(nm, qty 2) et B(lp, qty 3) de la même carte ; { condition: 'lp' } les
    // fait coïncider sur la même clé (container, carte, finish, condition,
    // langue) — répétition exacte d'une régression passée : la fusion perdait
    // silencieusement la quantité déjà fusionnée à cause d'un instantané
    // périmé relu au tour suivant de la boucle.
    const { userId, containerId } = await createContainerFor('bulk-merge')
    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Griselbrand', setCode: 'mh2' })
    const idA = await addHoldingRow({ containerId, cardId, qty: 2, condition: 'nm' })
    const idB = await addHoldingRow({ containerId, cardId, qty: 3, condition: 'lp' })

    const result = await bulkEdit(userId, { containerId, holdingIds: [idA, idB] }, { condition: 'lp' })
    expect(result.affected).toBe(2)

    const survivingRow = (await readHolding(idA)) ?? (await readHolding(idB))
    expect(survivingRow).toBeDefined()
    expect(survivingRow?.qty).toBe(5)
    expect(survivingRow?.condition).toBe('lp')
    // L'une des deux lignes d'origine a disparu, fusionnée dans l'autre —
    // jamais les deux, jamais aucune.
    const remaining = [await readHolding(idA), await readHolding(idB)].filter(Boolean)
    expect(remaining).toHaveLength(1)

    const restored = await bulkUndo(userId, result.undoToken)
    expect(restored.restored).toBe(2)
    const afterA = await readHolding(idA)
    const afterB = await readHolding(idB)
    expect(afterA?.qty).toBe(2)
    expect(afterA?.condition).toBe('nm')
    expect(afterB?.qty).toBe(3)
    expect(afterB?.condition).toBe('lp')
  })

  // Voir le commentaire de tête de `listHoldings`,
  // `app/(app)/container/[id]/holdings-data.ts` : une sélection groupée
  // depuis « All collection » peut mêler des
  // lignes de la racine ET d'un binder. `target.containerId` reste la racine
  // (l'écran ouvert) — la garde de container devait s'élargir au périmètre de
  // la collection entière (`resolveContainerScope`), sinon la relecture
  // verrouillée exclurait les lignes de binder et ferait échouer toute la
  // transaction (« Selection changed before the bulk edit could be applied »)
  // pour un cas qui n'a rien changé du tout.
  it('edits and deletes a selection mixing root and binder holdings from the root container target', async () => {
    const { userId, collectionId, containerId: rootId } = await createContainerFor('bulk-root-binder')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vintage cube' })

    const looseCardId = randomUUID()
    const binderCardId = randomUUID()
    await insertCard({ id: looseCardId, name: 'Loose Card', setCode: 'lea' })
    await insertCard({ id: binderCardId, name: 'Binder Card', setCode: 'lea' })
    const looseId = await addHoldingRow({ containerId: rootId, cardId: looseCardId, qty: 2, condition: 'nm' })
    const binderHoldingId = await addHoldingRow({
      containerId: binder.id,
      cardId: binderCardId,
      qty: 3,
      condition: 'nm',
    })

    const editResult = await bulkEdit(
      userId,
      { containerId: rootId, holdingIds: [looseId, binderHoldingId] },
      { condition: 'lp' },
    )
    expect(editResult.affected).toBe(2)
    expect((await readHolding(looseId))?.condition).toBe('lp')
    expect((await readHolding(binderHoldingId))?.condition).toBe('lp')

    const deleteResult = await bulkDelete(userId, {
      containerId: rootId,
      holdingIds: [looseId, binderHoldingId],
    })
    expect(deleteResult.affected).toBe(2)
    expect(await readHolding(looseId)).toBeUndefined()
    expect(await readHolding(binderHoldingId)).toBeUndefined()

    // Le binder (pas seulement la racine) a bien vu sa propre
    // `container_stats` recalculée après la suppression.
    const [binderStats] = await db
      .select()
      .from(containerStats)
      .where(eq(containerStats.containerId, binder.id))
    expect(binderStats?.uniqueCount).toBe(0)

    const restored = await bulkUndo(userId, deleteResult.undoToken)
    expect(restored.restored).toBe(2)
    expect((await readHolding(looseId))?.qty).toBe(2)
    expect((await readHolding(binderHoldingId))?.qty).toBe(3)
  })

  it('targets the whole filtered view on Select all, including rows never paginated', async () => {
    const { userId, containerId } = await createContainerFor('bulk-select-all')
    const matchingIds: string[] = []
    for (let i = 0; i < 5; i++) {
      const cardId = randomUUID()
      await insertCard({ id: cardId, name: `Lightning Bolt ${i}`, setCode: 'lea' })
      matchingIds.push(await addHoldingRow({ containerId, cardId }))
    }
    const otherCardId = randomUUID()
    await insertCard({ id: otherCardId, name: 'Counterspell', setCode: 'lea' })
    const otherId = await addHoldingRow({ containerId, cardId: otherCardId })

    const result = await bulkDelete(userId, {
      containerId,
      matching: {
        query: 'Lightning Bolt',
        filters: EMPTY_FILTERS,
        sort: { key: 'name', dir: 'low' },
        groupBy: null,
        density: null,
      },
    })

    expect(result.affected).toBe(5)
    for (const id of matchingIds) {
      expect(await readHolding(id)).toBeUndefined()
    }
    expect(await readHolding(otherId)).toBeDefined()
  })

  it('refuses a bulk action on a built deck without modifying anything', async () => {
    const { userId, collectionId } = await createContainerFor('bulk-deck-locked')
    const deck = await createContainer(userId, collectionId, { kind: 'deck', name: 'Modern deck' })
    await db.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deck.id))

    const cardId = randomUUID()
    await insertCard({ id: cardId, name: 'Ragavan', setCode: 'mh2' })
    const id = await addHoldingRow({ containerId: deck.id, cardId, qty: 1 })

    await expect(bulkEdit(userId, { containerId: deck.id, holdingIds: [id] }, { qty: 4 })).rejects.toThrow(
      DeckLockedError,
    )
    await expect(bulkDelete(userId, { containerId: deck.id, holdingIds: [id] })).rejects.toThrow(DeckLockedError)

    const row = await readHolding(id)
    expect(row?.qty).toBe(1)
  })
})
