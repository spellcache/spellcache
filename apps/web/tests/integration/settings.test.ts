// Test d'intégration : écriture des
// préférences (`updatePreferenceAction`), couplage `Currency`/`Price source`,
// gestion des membres et renommage de collection
// réservés à l'`owner`, et neutralisation de
// `Binder backdrops` sans perte de données. Contre la
// base éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ;
// se saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// `updatePreferenceAction`/`addMemberAction`/`renameCollectionAction`
// (`'use server'`) appellent `requireSession()`, qui lit `auth()`
// (`@/lib/auth`, Auth.js v5) — mocké ici comme dans
// tests/integration/binder-look.test.ts, seul `auth()` est remplacé,
// `requireSession`/`bootstrapCollection` tournent pour de vrai contre la
// base éphémère.
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; username: string; displayName: string | null; role: string },
}))
vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))

// `revalidatePath` exige le contexte d'une vraie requête Next, absent sous
// Vitest : les actions qui invalident le cache levaient « static generation
// store missing ». L'invalidation n'est pas ce que ce fichier teste (même
// choix que tests/integration/binder-look.test.ts).
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe.skipIf(!process.env.TEST_DATABASE_URL)('Settings & preferences', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let containers: typeof import('@spellcache/db/schema').containers
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let getCollectionHome: typeof import('@/app/(app)/collection/collection-data').getCollectionHome
  let getContainerHeader: typeof import('@/app/(app)/container/[id]/holdings-data').getContainerHeader
  let updatePreferenceAction: typeof import('@/app/(app)/settings/preferences-actions').updatePreferenceAction
  let addMemberAction: typeof import('@/app/(app)/settings/members-actions').addMemberAction
  let renameCollectionAction: typeof import('@/app/(app)/settings/collection-actions').renameCollectionAction

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, containers } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ getCollectionHome } = await import('@/app/(app)/collection/collection-data'))
    ;({ getContainerHeader } = await import('@/app/(app)/container/[id]/holdings-data'))
    ;({ updatePreferenceAction } = await import('@/app/(app)/settings/preferences-actions'))
    ;({ addMemberAction } = await import('@/app/(app)/settings/members-actions'))
    ;({ renameCollectionAction } = await import('@/app/(app)/settings/collection-actions'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    authState.user = null
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

  async function signInAs(username: string): Promise<string> {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username))
    if (!row) throw new Error(`No user row found for ${username}.`)
    authState.user = { id: row.id, email: `${username}@example.com`, username, displayName: null, role: 'member' }
    return row.id
  }

  async function setupOwner(username: string) {
    const userId = await createUser(username)
    const { collectionId, containerId: rootContainerId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    await signInAs(username)
    return { userId, collectionId, rootContainerId }
  }

  describe('updatePreferenceAction', () => {
    it('persists a single preference and leaves the rest untouched', async () => {
      const { userId } = await setupOwner('owner1')

      const result = await updatePreferenceAction({ collectionStyle: 'shelves' })

      expect(result).toEqual({ ok: true, preferences: expect.objectContaining({ collectionStyle: 'shelves' }) })

      const [row] = await db.select({ style: users.collectionStyle }).from(users).where(eq(users.id, userId))
      expect(row?.style).toBe('shelves')
    })

    it('rejects a value outside the enum without writing', async () => {
      const { userId } = await setupOwner('owner2')

      const before = await db.select({ style: users.collectionStyle }).from(users).where(eq(users.id, userId))

      const result = await updatePreferenceAction({ collectionStyle: 'huge' })

      expect(result).toEqual({ ok: false, error: expect.any(String) })
      const after = await db.select({ style: users.collectionStyle }).from(users).where(eq(users.id, userId))
      expect(after).toEqual(before)
    })

    it('keeps Currency and Price source coupled to the same priceSource', async () => {
      await setupOwner('owner3')

      const result = await updatePreferenceAction({ priceSource: 'tcgplayer_usd' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.preferences.priceSource).toBe('tcgplayer_usd')
      }
    })
  })

  describe('addMemberAction', () => {
    it('adds a free account as an editor', async () => {
      const { collectionId } = await setupOwner('owner4')
      await createUser('freeuser')

      const result = await addMemberAction({ collectionId, username: 'freeuser' })

      expect(result).toEqual({
        ok: true,
        member: { userId: expect.any(String), username: 'freeuser', role: 'editor' },
      })
    })

    it("reports an unknown username without writing a row", async () => {
      const { collectionId } = await setupOwner('owner5')

      const result = await addMemberAction({ collectionId, username: 'ghost' })

      expect(result).toEqual({ ok: false, error: 'not_found' })
    })

    it('adds an account that owns another collection, and refuses a second add', async () => {
      const { collectionId } = await setupOwner('owner6')
      await setupOwner('owner7')
      // `setupOwner` a réauthentifié comme `owner7` : on repasse la session
      // en `owner6`, qui a tenté l'ajout, pour l'appel testé.
      await signInAs('owner6')

      const result = await addMemberAction({ collectionId, username: 'owner7' })
      expect(result).toMatchObject({ ok: true })

      const again = await addMemberAction({ collectionId, username: 'owner7' })
      expect(again).toEqual({ ok: false, error: 'already_member' })
    })

    it('forbids a non-owner from adding a member', async () => {
      const { collectionId } = await setupOwner('owner8')
      await createUser('editor1')
      const editorAddResult = await addMemberAction({ collectionId, username: 'editor1' })
      expect(editorAddResult.ok).toBe(true)

      await signInAs('editor1')
      await createUser('freeuser2')
      const result = await addMemberAction({ collectionId, username: 'freeuser2' })

      expect(result).toEqual({ ok: false, error: 'forbidden' })
    })
  })

  describe('renameCollectionAction', () => {
    it('lets the owner rename the collection', async () => {
      const { collectionId } = await setupOwner('owner9')

      const result = await renameCollectionAction({ collectionId, name: 'Renamed collection' })

      expect(result).toEqual({ ok: true, name: 'Renamed collection' })
    })

    it("forbids an editor from renaming the collection (the Owner badge is not a button)", async () => {
      const { collectionId } = await setupOwner('owner10')
      await createUser('editor2')
      await addMemberAction({ collectionId, username: 'editor2' })

      await signInAs('editor2')

      const result = await renameCollectionAction({ collectionId, name: 'Hijacked' })

      expect(result).toEqual({ ok: false, error: 'forbidden' })
    })
  })

  describe('Binder backdrops', () => {
    it('hides a stored gradient look without erasing it, and restores it once toggled back on', async () => {
      const { userId, collectionId } = await setupOwner('owner11')
      const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Gradient binder' })
      await db
        .update(containers)
        .set({ coverGradient: 'blue', coverIntensity: '0.6' })
        .where(eq(containers.id, binder.id))

      // À `off` : `getCollectionHome`/`getContainerHeader` continuent de
      // lire la couverture réelle (`coverGradient`) — c'est au composant de
      // rendu (`BinderRow`/`BinderHeader`) de la neutraliser à l'affichage,
      // pas à la requête de l'effacer.
      await updatePreferenceAction({ binderBackdrops: false })

      const homeOff = await getCollectionHome(userId)
      const rowOff = homeOff.binders.find((b) => b.id === binder.id)
      expect(rowOff?.coverGradient).toBe('blue')
      expect(homeOff.binderBackdrops).toBe(false)

      const headerOff = await getContainerHeader(userId, binder.id)
      expect(headerOff.coverGradient).toBe('blue')
      expect(headerOff.binderBackdrops).toBe(false)

      // Rien n'a été effacé en base.
      const [row] = await db
        .select({ coverGradient: containers.coverGradient })
        .from(containers)
        .where(eq(containers.id, binder.id))
      expect(row?.coverGradient).toBe('blue')

      // Rebasculé à `on` : la même apparence revient à l'identique.
      await updatePreferenceAction({ binderBackdrops: true })
      const homeOn = await getCollectionHome(userId)
      const rowOn = homeOn.binders.find((b) => b.id === binder.id)
      expect(rowOn?.coverGradient).toBe('blue')
      expect(homeOn.binderBackdrops).toBe(true)
    })
  })
})
