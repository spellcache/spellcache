// Multi-collection : un compte membre de plusieurs collections, une
// collection active par compte, et la règle de repli quand elle disparaît.
// Contre la base éphémère `postgres-test` (packages/db/testing/global-setup.ts) ;
// se saute lui-même sans `TEST_DATABASE_URL`, même garde que les autres.
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Multi-collection', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let schema: typeof import('@spellcache/db/schema')
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let active: typeof import('@/lib/collections/active')
  let members: typeof import('@/lib/collections/members')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    schema = await import('@spellcache/db/schema')
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    active = await import('@/lib/collections/active')
    members = await import('@/lib/collections/members')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(
      'TRUNCATE holdings, container_stats, containers, collection_members, collections, users CASCADE',
    )
  })

  async function createUser(username: string): Promise<string> {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: schema.users.id })
    return row!.id
  }

  async function setupOwner(username: string) {
    const userId = await createUser(username)
    const { collectionId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    return { userId, collectionId }
  }

  it('lists every collection of an account and switches the shown one', async () => {
    const alice = await setupOwner('alice')
    const bob = await setupOwner('bob')
    await members.addMember(alice.userId, alice.collectionId, 'bob')

    const before = await active.listMyCollections(bob.userId)
    expect(before.map((c) => [c.id, c.role, c.active])).toEqual([
      [bob.collectionId, 'owner', true],
      [alice.collectionId, 'editor', false],
    ])

    expect(await active.setActiveCollection(bob.userId, alice.collectionId)).toBe(true)
    expect(await active.getActiveCollectionId(bob.userId)).toBe(alice.collectionId)
    // `bootstrapCollection` — « ma collection » pour tous les écrans —
    // suit la collection active.
    const shown = await bootstrapCollection(bob.userId, {
      username: 'bob',
      displayName: null,
    })
    expect(shown).toMatchObject({ collectionId: alice.collectionId, created: false })
  })

  it('never activates a collection the account is not a member of', async () => {
    const alice = await setupOwner('alice')
    const mallory = await setupOwner('mallory')

    expect(await active.setActiveCollection(mallory.userId, alice.collectionId)).toBe(
      false,
    )
    expect(await active.getActiveCollectionId(mallory.userId)).toBe(mallory.collectionId)
  })

  it('falls back to the own collection after leaving the shown one', async () => {
    const alice = await setupOwner('alice')
    const bob = await setupOwner('bob')
    await members.addMember(alice.userId, alice.collectionId, 'bob')
    await active.setActiveCollection(bob.userId, alice.collectionId)

    await members.leaveCollection(bob.userId, alice.collectionId)

    expect(await active.getActiveCollectionId(bob.userId)).toBe(bob.collectionId)
  })

  it('gives no own collection to an account invited straight into one', async () => {
    const alice = await setupOwner('alice')
    // Compte invité « Add to my collection » : l'adhésion existe avant sa
    // première connexion (app/(app)/settings/actions.ts#inviteUserAction).
    const guestId = await createUser('guest')
    await db
      .insert(schema.collectionMembers)
      .values({ collectionId: alice.collectionId, userId: guestId, role: 'editor' })

    const result = await bootstrapCollection(guestId, {
      username: 'guest',
      displayName: null,
    })

    expect(result).toMatchObject({ collectionId: alice.collectionId, created: false })
    const memberships = await db
      .select()
      .from(schema.collectionMembers)
      .where(eq(schema.collectionMembers.userId, guestId))
    expect(memberships).toHaveLength(1)
  })

  it('offers accounts that own another collection as member candidates', async () => {
    const alice = await setupOwner('alice')
    await setupOwner('bob')

    const candidates = await members.listMemberCandidates(
      alice.userId,
      alice.collectionId,
    )
    expect(candidates.map((c) => c.username)).toEqual(['bob'])

    await members.addMember(alice.userId, alice.collectionId, 'bob')
    expect(await members.listMemberCandidates(alice.userId, alice.collectionId)).toEqual(
      [],
    )
    const [row] = await db
      .select()
      .from(schema.collectionMembers)
      .where(
        and(
          eq(schema.collectionMembers.collectionId, alice.collectionId),
          eq(schema.collectionMembers.role, 'editor'),
        ),
      )
    expect(row).toBeDefined()
  })

  it('lets only an owner delete a collection, and falls back for its members', async () => {
    const alice = await setupOwner('alice')
    const bob = await setupOwner('bob')
    await members.addMember(alice.userId, alice.collectionId, 'bob')
    await active.setActiveCollection(bob.userId, alice.collectionId)

    // Un `editor` ne peut pas supprimer.
    await expect(
      members.deleteCollection(bob.userId, alice.collectionId),
    ).rejects.toThrow()

    await members.deleteCollection(alice.userId, alice.collectionId)

    const remaining = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, alice.collectionId))
    expect(remaining).toHaveLength(0)
    // Ses containers partent en cascade.
    const roots = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.collectionId, alice.collectionId))
    expect(roots).toHaveLength(0)
    // Bob retombe sur sa propre collection ; Alice, sans collection, en
    // recevra une neuve à sa prochaine requête.
    expect(await active.getActiveCollectionId(bob.userId)).toBe(bob.collectionId)
    expect(await active.getActiveCollectionId(alice.userId)).toBeNull()
    const fresh = await bootstrapCollection(alice.userId, {
      username: 'alice',
      displayName: null,
    })
    expect(fresh.created).toBe(true)
  })

  it('invites by email: creates a pending account with the chosen role, or adds an existing one', async () => {
    const alice = await setupOwner('alice')
    await setupOwner('bob')

    const fresh = await members.inviteMemberByEmail(
      alice.userId,
      alice.collectionId,
      'New@Example.com',
      'viewer',
      { allowAccountCreation: true },
    )
    expect(fresh).toMatchObject({
      ok: true,
      created: true,
      member: { username: 'new@example.com', role: 'viewer' },
    })
    const [pending] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'new@example.com'))
    expect(pending?.username).toBeNull()

    // Compte existant (bob@example.com) : ajouté, aucun compte créé.
    const existing = await members.inviteMemberByEmail(
      alice.userId,
      alice.collectionId,
      'bob@example.com',
      'editor',
      { allowAccountCreation: false },
    )
    expect(existing).toMatchObject({
      ok: true,
      created: false,
      member: { username: 'bob', role: 'editor' },
    })

    // Second envoi : déjà membre.
    await expect(
      members.inviteMemberByEmail(alice.userId, alice.collectionId, 'bob@example.com', 'editor', {
        allowAccountCreation: false,
      }),
    ).resolves.toEqual({ ok: false, error: 'already_member' })

    // Inscriptions fermées pour l'appelant : aucun compte n'est créé.
    await expect(
      members.inviteMemberByEmail(alice.userId, alice.collectionId, 'stranger@example.com', 'editor', {
        allowAccountCreation: false,
      }),
    ).resolves.toEqual({ ok: false, error: 'signup_closed' })
    const [stranger] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'stranger@example.com'))
    expect(stranger).toBeUndefined()

    // Le compte en attente apparaît par son email dans la liste des membres.
    const list = await members.listMembers(alice.userId, alice.collectionId)
    expect(list.map((m) => m.username).sort()).toEqual([
      'alice',
      'bob',
      'new@example.com',
    ])
  })

  it('lets a viewer read the collection but never write to it', async () => {
    const alice = await setupOwner('alice')
    const bob = await setupOwner('bob')
    await members.addMember(alice.userId, alice.collectionId, 'bob', 'viewer')
    const { requireContainerAccess, requireCollectionAccess } = await import(
      '@/lib/collections/authorize'
    )
    const [root] = await db
      .select({ id: schema.containers.id })
      .from(schema.containers)
      .where(eq(schema.containers.collectionId, alice.collectionId))

    await expect(requireContainerAccess(bob.userId, root!.id, 'read')).resolves.toMatchObject({
      role: 'viewer',
    })
    await expect(requireContainerAccess(bob.userId, root!.id, 'write')).rejects.toThrow()
    await expect(requireCollectionAccess(bob.userId, alice.collectionId, 'write')).rejects.toThrow()
    // Une vraie mutation passe par la même garde.
    const { createContainer } = await import('@/lib/containers/containers')
    await expect(
      createContainer(bob.userId, alice.collectionId, { kind: 'binder', name: 'Sneaky' }),
    ).rejects.toThrow()
    // Le propriétaire, lui, écrit toujours.
    await expect(requireContainerAccess(alice.userId, root!.id, 'write')).resolves.toMatchObject({
      role: 'owner',
    })
  })

  it('deletes an account with its solo collection, keeps shared ones, and refuses a sharing owner', async () => {
    const { deleteAccounts, deleteOrphanCollections } = await import('@/lib/accounts/delete-accounts')
    const alice = await setupOwner('alice') // possède une collection partagée
    const bob = await setupOwner('bob') // seul dans la sienne, membre de celle d'Alice
    await members.addMember(alice.userId, alice.collectionId, 'bob', 'editor')

    const result = await deleteAccounts([alice.userId, bob.userId])

    // Alice est refusée : sa collection a un autre membre.
    expect(result.blocked.map((entry) => entry.label)).toEqual(['alice'])
    expect(result.deleted).toBe(1)
    // La collection solo de Bob est partie avec lui ; celle d'Alice reste.
    const left = await db.select({ id: schema.collections.id }).from(schema.collections)
    expect(left.map((row) => row.id)).toEqual([alice.collectionId])

    // Une collection orpheline héritée d'avant la règle se nettoie.
    await db.insert(schema.collections).values({ name: 'Orphan' })
    expect(await deleteOrphanCollections()).toBe(1)
  })
})
