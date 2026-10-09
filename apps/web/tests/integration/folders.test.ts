// Test d'intégration des dossiers de decks : déplacement, ordre,
// suppression. Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Les Server Actions de `folder-actions.ts` appellent `requireSession()`
// (lib/auth-guards.ts), qui lit `auth()` — mocké ici comme dans
// `binder-look.test.ts` : seul `auth()` est remplacé,
// `requireSession`, `bootstrapCollection` et toutes les requêtes tournent
// pour de vrai contre la base éphémère.
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; username: string; displayName: string | null; role: string },
}))
vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))

describe.skipIf(!process.env.TEST_DATABASE_URL)('Deck folders', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let containers: typeof import('@spellcache/db/schema').containers
  let deckFolders: typeof import('@spellcache/db/schema').deckFolders
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let getFolderShelves: typeof import('@/app/(app)/decks/folders-data').getFolderShelves
  let createFolderAction: typeof import('@/app/(app)/decks/folder-actions').createFolderAction
  let deleteFolderAction: typeof import('@/app/(app)/decks/folder-actions').deleteFolderAction
  let moveDeckToFolderAction: typeof import('@/app/(app)/decks/folder-actions').moveDeckToFolderAction
  let renameFolderAction: typeof import('@/app/(app)/decks/folder-actions').renameFolderAction
  let reorderFoldersAction: typeof import('@/app/(app)/decks/folder-actions').reorderFoldersAction

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, containers, deckFolders } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ getFolderShelves } = await import('@/app/(app)/decks/folders-data'))
    ;({
      createFolderAction,
      deleteFolderAction,
      moveDeckToFolderAction,
      renameFolderAction,
      reorderFoldersAction,
    } = await import('@/app/(app)/decks/folder-actions'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    authState.user = null
    await pool.query(
      'TRUNCATE deck_folders, holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE',
    )
  })

  async function setupCollection(username: string) {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username, priceSource: 'tcgplayer_usd' })
      .returning({ id: users.id })
    const userId = row!.id
    const { collectionId } = await bootstrapCollection(userId, { username, displayName: null })
    return { userId, collectionId }
  }

  function signIn(userId: string, username: string) {
    authState.user = {
      id: userId,
      email: `${username}@example.com`,
      username,
      displayName: null,
      role: 'user',
    }
  }

  async function createDeck(userId: string, collectionId: string, name: string, sortOrder = 0) {
    return createContainer(userId, collectionId, {
      kind: 'deck',
      name,
      deckState: 'plan',
      format: 'modern',
      sortOrder,
    })
  }

  function shelfNames(shelves: Array<{ name: string }>): string[] {
    return shelves.map((shelf) => shelf.name)
  }

  it('drops every folder-less deck into a final Unsorted shelf', async () => {
    const { userId, collectionId } = await setupCollection('unsorted-user')
    signIn(userId, 'unsorted-user')
    await createDeck(userId, collectionId, 'Loose deck A', 1)
    await createDeck(userId, collectionId, 'Loose deck B', 2)
    const created = await createFolderAction({ name: 'Commander' })
    expect(created.ok).toBe(true)

    const { shelves } = await getFolderShelves(userId)

    expect(shelfNames(shelves)).toEqual(['Commander', 'Unsorted'])
    const unsorted = shelves.at(-1)!
    expect(unsorted.folderId).toBeNull()
    expect(unsorted.deckCount).toBe(2)
    expect(unsorted.decks.map((deck) => deck.name)).toEqual(['Loose deck A', 'Loose deck B'])
  })

  it('renders a single Unsorted shelf when no folder exists (empty state)', async () => {
    const { userId } = await setupCollection('empty-user')
    signIn(userId, 'empty-user')

    const { shelves } = await getFolderShelves(userId)

    expect(shelves).toHaveLength(1)
    expect(shelves[0]!.folderId).toBeNull()
    expect(shelves[0]!.name).toBe('Unsorted')
    expect(shelves[0]!.deckCount).toBe(0)
  })

  it('moves a deck into a folder and back to Unsorted, writing folder_id', async () => {
    const { userId, collectionId } = await setupCollection('move-user')
    signIn(userId, 'move-user')
    const deck = await createDeck(userId, collectionId, 'Atraxa Superfriends')
    const created = await createFolderAction({ name: 'Commander' })
    if (!created.ok) throw new Error('folder not created')

    const moved = await moveDeckToFolderAction({ deckId: deck.id, folderId: created.folderId })
    expect(moved.ok).toBe(true)

    const [afterMove] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(afterMove!.folderId).toBe(created.folderId)

    let shelves = (await getFolderShelves(userId)).shelves
    expect(shelves[0]!.decks.map((d) => d.name)).toEqual(['Atraxa Superfriends'])
    expect(shelves[0]!.deckCount).toBe(1)
    expect(shelves.at(-1)!.deckCount).toBe(0)

    // `folderId: null` renvoie le deck dans `Unsorted` — le même chemin, pas
    // une seconde action.
    const back = await moveDeckToFolderAction({ deckId: deck.id, folderId: null })
    expect(back.ok).toBe(true)

    const [afterBack] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(afterBack!.folderId).toBeNull()

    shelves = (await getFolderShelves(userId)).shelves
    expect(shelves[0]!.deckCount).toBe(0)
    expect(shelves.at(-1)!.decks.map((d) => d.name)).toEqual(['Atraxa Superfriends'])
  })

  it('refuses to file a deck into another collection folder', async () => {
    const mine = await setupCollection('owner-user')
    const other = await setupCollection('other-user')
    const deck = await createDeck(mine.userId, mine.collectionId, 'My deck')

    signIn(other.userId, 'other-user')
    const otherFolder = await createFolderAction({ name: 'Their folder' })
    if (!otherFolder.ok) throw new Error('folder not created')

    signIn(mine.userId, 'owner-user')
    const result = await moveDeckToFolderAction({ deckId: deck.id, folderId: otherFolder.folderId })
    expect(result.ok).toBe(false)

    const [row] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(row!.folderId).toBeNull()
  })

  it('refuses to move a deck the account cannot reach', async () => {
    const mine = await setupCollection('reach-owner')
    const other = await setupCollection('reach-intruder')
    const deck = await createDeck(mine.userId, mine.collectionId, 'Private deck')

    signIn(other.userId, 'reach-intruder')
    const folder = await createFolderAction({ name: 'Intruder folder' })
    if (!folder.ok) throw new Error('folder not created')

    const result = await moveDeckToFolderAction({ deckId: deck.id, folderId: folder.folderId })
    expect(result.ok).toBe(false)

    const [row] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(row!.folderId).toBeNull()
  })

  it('rewrites position for every folder of the collection, and the order survives a reload', async () => {
    const { userId, collectionId } = await setupCollection('order-user')
    signIn(userId, 'order-user')
    const first = await createFolderAction({ name: 'Commander' })
    const second = await createFolderAction({ name: '60-card' })
    const third = await createFolderAction({ name: 'Cube' })
    if (!first.ok || !second.ok || !third.ok) throw new Error('folders not created')

    expect(shelfNames((await getFolderShelves(userId)).shelves)).toEqual([
      'Commander',
      '60-card',
      'Cube',
      'Unsorted',
    ])

    const reordered = await reorderFoldersAction({
      folderIds: [third.folderId, first.folderId, second.folderId],
    })
    expect(reordered.ok).toBe(true)

    // `position` réécrite pour les trois, sans doublon.
    const rows = await db
      .select()
      .from(deckFolders)
      .where(eq(deckFolders.collectionId, collectionId))
    expect(rows.map((row) => row.position).sort()).toEqual([0, 1, 2])

    // « L'ordre survit à un rechargement » : relu depuis la base, pas depuis
    // un état client.
    expect(shelfNames((await getFolderShelves(userId)).shelves)).toEqual([
      'Cube',
      'Commander',
      '60-card',
      'Unsorted',
    ])
  })

  it('keeps the folder order private to each collection', async () => {
    const mine = await setupCollection('order-mine')
    const other = await setupCollection('order-other')

    signIn(other.userId, 'order-other')
    const otherA = await createFolderAction({ name: 'Their A' })
    const otherB = await createFolderAction({ name: 'Their B' })
    if (!otherA.ok || !otherB.ok) throw new Error('folders not created')

    signIn(mine.userId, 'order-mine')
    const mineA = await createFolderAction({ name: 'My A' })
    const mineB = await createFolderAction({ name: 'My B' })
    if (!mineA.ok || !mineB.ok) throw new Error('folders not created')

    // Chaque collection repart de 0 : les positions ne sont pas globales.
    expect(shelfNames((await getFolderShelves(mine.userId)).shelves)).toEqual(['My A', 'My B', 'Unsorted'])

    const reordered = await reorderFoldersAction({ folderIds: [mineB.folderId, mineA.folderId] })
    expect(reordered.ok).toBe(true)

    expect(shelfNames((await getFolderShelves(mine.userId)).shelves)).toEqual(['My B', 'My A', 'Unsorted'])
    // L'autre collection n'a pas bougé.
    expect(shelfNames((await getFolderShelves(other.userId)).shelves)).toEqual([
      'Their A',
      'Their B',
      'Unsorted',
    ])
  })

  it('rejects a partial or foreign reorder rather than writing a half order', async () => {
    const mine = await setupCollection('partial-mine')
    const other = await setupCollection('partial-other')

    signIn(other.userId, 'partial-other')
    const foreign = await createFolderAction({ name: 'Foreign' })
    if (!foreign.ok) throw new Error('folder not created')

    signIn(mine.userId, 'partial-mine')
    const a = await createFolderAction({ name: 'A' })
    const b = await createFolderAction({ name: 'B' })
    if (!a.ok || !b.ok) throw new Error('folders not created')

    expect((await reorderFoldersAction({ folderIds: [b.folderId] })).ok).toBe(false)
    expect((await reorderFoldersAction({ folderIds: [b.folderId, foreign.folderId] })).ok).toBe(false)
    expect((await reorderFoldersAction({ folderIds: [b.folderId, b.folderId] })).ok).toBe(false)

    // Rien n'a bougé.
    expect(shelfNames((await getFolderShelves(mine.userId)).shelves)).toEqual(['A', 'B', 'Unsorted'])
  })

  it('leaves the 5 decks of a deleted folder intact, folder_id null, so in Unsorted', async () => {
    const { userId, collectionId } = await setupCollection('delete-user')
    signIn(userId, 'delete-user')
    const folder = await createFolderAction({ name: 'Commander' })
    if (!folder.ok) throw new Error('folder not created')

    const deckIds: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const deck = await createDeck(userId, collectionId, `Deck ${i}`, i)
      deckIds.push(deck.id)
      await moveDeckToFolderAction({ deckId: deck.id, folderId: folder.folderId })
    }

    const deleted = await deleteFolderAction({ folderId: folder.folderId })
    expect(deleted.ok).toBe(true)

    const rows = await db.select().from(containers).where(eq(containers.kind, 'deck'))
    expect(rows).toHaveLength(5)
    expect(rows.every((row) => row.folderId === null)).toBe(true)

    const { shelves } = await getFolderShelves(userId)
    expect(shelves).toHaveLength(1)
    expect(shelves[0]!.name).toBe('Unsorted')
    expect(shelves[0]!.deckCount).toBe(5)
    expect(new Set(shelves[0]!.decks.map((deck) => deck.id))).toEqual(new Set(deckIds))
  })

  it('renames a folder, and refuses to rename another collection folder', async () => {
    const mine = await setupCollection('rename-mine')
    const other = await setupCollection('rename-other')

    signIn(other.userId, 'rename-other')
    const foreign = await createFolderAction({ name: 'Foreign' })
    if (!foreign.ok) throw new Error('folder not created')

    signIn(mine.userId, 'rename-mine')
    const folder = await createFolderAction({ name: 'Commander' })
    if (!folder.ok) throw new Error('folder not created')

    expect((await renameFolderAction({ folderId: folder.folderId, name: 'EDH' })).ok).toBe(true)
    expect(shelfNames((await getFolderShelves(mine.userId)).shelves)).toEqual(['EDH', 'Unsorted'])

    expect((await renameFolderAction({ folderId: foreign.folderId, name: 'Stolen' })).ok).toBe(false)
    expect(shelfNames((await getFolderShelves(other.userId)).shelves)).toEqual(['Foreign', 'Unsorted'])
  })

  describe('query budget', () => {
    let queryCount = 0
    let originalQuery: typeof Pool.prototype.query

    beforeEach(() => {
      queryCount = 0
      originalQuery = Pool.prototype.query
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

    it('loads at most 10 decks per shelf while reporting the real deck count', async () => {
      const { userId, collectionId } = await setupCollection('cap-user')
      signIn(userId, 'cap-user')
      const folder = await createFolderAction({ name: 'Commander' })
      if (!folder.ok) throw new Error('folder not created')

      for (let i = 0; i < 14; i += 1) {
        const deck = await createDeck(userId, collectionId, `Deck ${String(i).padStart(2, '0')}`, i)
        await moveDeckToFolderAction({ deckId: deck.id, folderId: folder.folderId })
      }

      const { shelves } = await getFolderShelves(userId)

      expect(shelves[0]!.deckCount).toBe(14)
      expect(shelves[0]!.decks).toHaveLength(10)
      // Les 10 premières dans l'ordre de l'étagère, pas 10 au hasard.
      expect(shelves[0]!.decks.map((deck) => deck.name)).toEqual([
        'Deck 00',
        'Deck 01',
        'Deck 02',
        'Deck 03',
        'Deck 04',
        'Deck 05',
        'Deck 06',
        'Deck 07',
        'Deck 08',
        'Deck 09',
      ])
    })

    it('costs the same number of queries at 1 folder and at 6 — no N+1 on the folder count', async () => {
      const { userId, collectionId } = await setupCollection('n1-user')
      signIn(userId, 'n1-user')

      const firstFolder = await createFolderAction({ name: 'Folder 0' })
      if (!firstFolder.ok) throw new Error('folder not created')
      const firstDeck = await createDeck(userId, collectionId, 'Deck 0', 0)
      await moveDeckToFolderAction({ deckId: firstDeck.id, folderId: firstFolder.folderId })

      queryCount = 0
      await getFolderShelves(userId)
      const withOneFolder = queryCount

      for (let i = 1; i < 6; i += 1) {
        const folder = await createFolderAction({ name: `Folder ${i}` })
        if (!folder.ok) throw new Error('folder not created')
        const deck = await createDeck(userId, collectionId, `Deck ${i}`, i)
        await moveDeckToFolderAction({ deckId: deck.id, folderId: folder.folderId })
      }

      queryCount = 0
      const { shelves } = await getFolderShelves(userId)
      const withSixFolders = queryCount

      expect(shelves).toHaveLength(7) // 6 dossiers + Unsorted
      expect(withOneFolder).toBe(2)
      expect(withSixFolders).toBe(withOneFolder)
    })
  })
})
