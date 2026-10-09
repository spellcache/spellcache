// Test d'intégration : persistance de
// `BinderLook` (les trois modes s'excluent mutuellement en base), la
// contrainte « la carte doit appartenir au binder » du mode `Card art`, et
// la suppression d'un binder qui déplace ses holdings vers le container
// racine dans la même transaction. Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// `saveBinderLookAction` ('use server', app/(app)/container/[id]/binder-actions.ts)
// appelle `requireSession()` (lib/auth-guards.ts), qui lit `auth()`
// (`@/lib/auth`, Auth.js v5 — construction complète du provider Email hors
// de portée d'un test d'intégration base-only). Mocké ici plutôt que rejoué
// via un vrai cycle de lien magique (réservé à `tests/e2e/`) : seul `auth()`
// est remplacé, `requireSession` et `bootstrapCollection` tournent pour de
// vrai contre la base éphémère. `vi.hoisted` : la factory de `vi.mock` est
// hissée avant les imports, elle ne peut donc pas fermer sur une variable
// `let` déclarée plus bas sans passer par lui.
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; username: string; displayName: string | null; role: string },
}))
// `revalidatePath` exige un contexte de requête Next qui n'existe pas sous
// vitest — le chemin succès de `saveBinderLookAction` planterait dessus
// (même mur que settings.test.ts, préexistant). L'invalidation de cache
// n'est pas ce que ce fichier teste.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))

describe.skipIf(!process.env.TEST_DATABASE_URL)('Binder look & delete', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let containers: typeof import('@spellcache/db/schema').containers
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let updateContainer: typeof import('@/lib/containers/containers').updateContainer
  let deleteBinder: typeof import('@/lib/containers/containers').deleteBinder
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let saveBinderLookAction: typeof import('@/app/(app)/container/[id]/binder-actions').saveBinderLookAction

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, containers } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer, updateContainer, deleteBinder } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ saveBinderLookAction } = await import('@/app/(app)/container/[id]/binder-actions'))
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

  async function setupCollection(username: string) {
    const userId = await createUser(username)
    const { collectionId, containerId: rootContainerId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    return { userId, collectionId, rootContainerId }
  }

  async function insertCard(id: string, name: string): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('lea', 'lea', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, 'lea', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [id, randomUUID(), name],
    )
  }

  it('saves the Colour mode: cover_gradient set, cover_card_id cleared (exclusivite des trois etats)', async () => {
    const { userId, collectionId } = await setupCollection('colour-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trade binder' })

    await updateContainer(userId, binder.id, { coverGradient: 'green', coverCardId: null, coverIntensity: '0.8' })

    const [row] = await db.select().from(containers).where(eq(containers.id, binder.id)).limit(1)
    expect(row!.coverGradient).toBe('green')
    expect(row!.coverCardId).toBeNull()
    expect(Number(row!.coverIntensity)).toBeCloseTo(0.8)
  })

  it('saves the Card art mode: cover_card_id set, cover_gradient cleared', async () => {
    const { userId, collectionId } = await setupCollection('art-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Commander staples' })
    const cardId = randomUUID()
    await insertCard(cardId, 'Atraxa, Praetors Voice')
    await addHolding(userId, { containerId: binder.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    await updateContainer(userId, binder.id, { coverGradient: null, coverCardId: cardId, coverIntensity: '0.6' })

    const [row] = await db.select().from(containers).where(eq(containers.id, binder.id)).limit(1)
    expect(row!.coverCardId).toBe(cardId)
    expect(row!.coverGradient).toBeNull()
  })

  it("saveBinderLookAction accepts any catalogue card as backdrop, owned or not (« Any card can be the backdrop »)", async () => {
    const { userId, collectionId } = await setupCollection('outsider-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Empty binder' })
    const outsideCardId = randomUUID()
    await insertCard(outsideCardId, 'Not in this binder')

    authState.user = { id: userId, email: 'outsider-user@example.com', username: 'outsider-user', displayName: null, role: 'member' }
    const result = await saveBinderLookAction({
      containerId: binder.id,
      look: { mode: 'art', cardId: outsideCardId, intensity: 1 },
    })
    expect(result).toEqual({ ok: true, coverArtist: null })

    // Le fond est posé, mais la carte n'a PAS rejoint le binder pour autant.
    const { rows } = await pool.query('SELECT 1 FROM holdings WHERE container_id = $1 AND card_id = $2', [
      binder.id,
      outsideCardId,
    ])
    expect(rows).toHaveLength(0)

    const [row] = await db.select().from(containers).where(eq(containers.id, binder.id)).limit(1)
    expect(row!.coverCardId).toBe(outsideCardId)
  })

  it('saveBinderLookAction rejects a card absent from the catalogue before any write', async () => {
    const { userId, collectionId } = await setupCollection('ghostcard-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Ghost binder' })

    authState.user = { id: userId, email: 'ghostcard-user@example.com', username: 'ghostcard-user', displayName: null, role: 'member' }
    const result = await saveBinderLookAction({
      containerId: binder.id,
      look: { mode: 'art', cardId: randomUUID(), intensity: 1 },
    })
    expect(result).toEqual({ ok: false, error: 'unknown_card' })

    const [row] = await db.select().from(containers).where(eq(containers.id, binder.id)).limit(1)
    expect(row!.coverCardId).toBeNull()
  })

  it("saveBinderLookAction rejects a caller without access to the collection before reading any holding (docs/development.md — une seule voie d'autorisation)", async () => {
    const { userId: ownerId, collectionId } = await setupCollection('owner-user')
    const binder = await createContainer(ownerId, collectionId, { kind: 'binder', name: 'Not yours' })
    const { userId: outsiderId } = await setupCollection('unrelated-user')
    const someCardId = randomUUID()
    await insertCard(someCardId, 'Irrelevant to the authorization check')

    // `outsiderId` n'est membre d'aucune collection touchant `binder.id` :
    // l'appel doit échouer par `forbidden`, jamais par `unknown_card` (qui
    // supposerait avoir déjà lu `holdings` pour ce container).
    authState.user = {
      id: outsiderId,
      email: 'unrelated-user@example.com',
      username: 'unrelated-user',
      displayName: null,
      role: 'member',
    }
    const result = await saveBinderLookAction({
      containerId: binder.id,
      look: { mode: 'art', cardId: someCardId, intensity: 1 },
    })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('deleteBinder moves every holding to the root container and reports the moved count', async () => {
    const { userId, collectionId, rootContainerId } = await setupCollection('delete-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: '64-card binder' })

    const cardIds: string[] = []
    for (let i = 0; i < 64; i += 1) {
      const cardId = randomUUID()
      cardIds.push(cardId)
      await insertCard(cardId, `Card ${i}`)
      await addHolding(
        userId,
        { containerId: binder.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        1,
      )
    }

    const result = await deleteBinder(userId, binder.id)
    expect(result.movedHoldings).toBe(64)

    const { rows: remaining } = await pool.query('SELECT count(*)::int AS n FROM holdings WHERE container_id = $1', [
      binder.id,
    ])
    expect(remaining[0].n).toBe(0)

    const { rows: moved } = await pool.query('SELECT count(*)::int AS n FROM holdings WHERE container_id = $1', [
      rootContainerId,
    ])
    expect(moved[0].n).toBe(64)

    const { rows: binderRow } = await pool.query('SELECT 1 FROM containers WHERE id = $1', [binder.id])
    expect(binderRow).toHaveLength(0)
  })

  it('deleteBinder merges a moved holding into an existing root holding of the same key instead of losing quantity', async () => {
    const { userId, collectionId, rootContainerId } = await setupCollection('merge-user')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Overlap binder' })
    const cardId = randomUUID()
    await insertCard(cardId, 'Shared card')

    await addHolding(userId, { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)
    await addHolding(userId, { containerId: binder.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 3)

    const result = await deleteBinder(userId, binder.id)
    expect(result.movedHoldings).toBe(1)

    const { rows } = await pool.query('SELECT qty FROM holdings WHERE container_id = $1 AND card_id = $2', [
      rootContainerId,
      cardId,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].qty).toBe(5)
  })

  it('refuses to delete a non-binder container', async () => {
    const { userId, rootContainerId } = await setupCollection('root-user')
    await expect(deleteBinder(userId, rootContainerId)).rejects.toThrow()
  })
})
