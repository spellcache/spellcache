// Test d'intégration : bootstrap
// idempotent de la collection à la première connexion, matrice d'accès
// owner / editor / étranger, et gestion des membres (dernier `owner`, un
// compte = une collection). Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Autorisation & bootstrap', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/lib/collections/bootstrap`
  // (donc de `@spellcache/db`, singleton créé à l'évaluation du module — même
  // contrainte que tests/integration/auth.test.ts).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let collectionMembers: typeof import('@spellcache/db/schema').collectionMembers
  let containers: typeof import('@spellcache/db/schema').containers
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let resolveAccess: typeof import('@/lib/collections/authorize').resolveAccess
  let requireContainerAccess: typeof import('@/lib/collections/authorize').requireContainerAccess
  let ContainerAccessError: typeof import('@/lib/collections/authorize').ContainerAccessError
  let addMember: typeof import('@/lib/collections/members').addMember
  let removeMember: typeof import('@/lib/collections/members').removeMember
  let changeMemberRole: typeof import('@/lib/collections/members').changeMemberRole

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, collectionMembers, containers } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ resolveAccess, requireContainerAccess, ContainerAccessError } = await import(
      '@/lib/collections/authorize'
    ))
    ;({ addMember, removeMember, changeMemberRole } = await import('@/lib/collections/members'))
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

  async function createUser(username: string, displayName: string | null = null): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username, displayName })
      .returning({ id: users.id })
    return row!.id
  }

  // Attend que la transaction de `bootstrapCollection` soit bloquée sur la
  // clé unique. Sans cette attente, commiter trop tôt ferait passer le test
  // par le chemin idempotent ordinaire, qui ne prouve rien. La requête est
  // filtrée sur l'insertion dans `collection_members` : les fichiers de test
  // s'exécutent en parallèle sur la même base, un `wait_event_type = 'Lock'`
  // nu attraperait le verrou d'un autre fichier.
  async function waitForMembershipLock(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ waiting: string }>(
        `SELECT count(*)::text AS waiting FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query ILIKE '%pg_advisory_xact_lock%'`,
      )
      if (Number(rows[0]!.waiting) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("Aucune session bloquee sur le verrou de bootstrap : la course n'a pas eu lieu.")
  }

  it('creates one collection owned by the account on first bootstrap, none on the second', async () => {
    const userId = await createUser('morgan')

    const first = await bootstrapCollection(userId, { username: 'morgan', displayName: null })
    expect(first.created).toBe(true)

    const second = await bootstrapCollection(userId, { username: 'morgan', displayName: null })
    expect(second.created).toBe(false)
    expect(second.collectionId).toBe(first.collectionId)
    expect(second.containerId).toBe(first.containerId)

    const memberships = await db
      .select()
      .from(collectionMembers)
      .where(eq(collectionMembers.userId, userId))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe('owner')

    const [root] = await db.select().from(containers).where(eq(containers.id, first.containerId))
    expect(root?.kind).toBe('collection')
    // `displayName` non renseigné : repli sur
    // `username` plutôt qu'une collection nommée « null collection ».
    expect(root?.name).toBe('morgan collection')
  })

  // Deux requêtes concurrentes du même compte à la première connexion : le
  // préchargement du routeur et la navigation entrent ensemble dans
  // `requireSession()`, toutes deux ne trouvent aucune adhésion, toutes deux
  // insèrent. L'index unique arrête bien la seconde collection, mais la
  // perdante doit relire la gagnante — sans quoi l'écran remonte un 500 à la
  // toute première connexion.
  //
  // La course est forcée, pas espérée : une transaction concurrente écrit
  // l'adhésion gagnante et reste ouverte. `bootstrapCollection` ne la voit
  // donc pas à la lecture, puis bloque sur la clé unique à l'insertion — on
  // attend d'observer ce blocage dans `pg_stat_activity` avant de commiter,
  // ce qui garantit que c'est bien le chemin de rattrapage qui est mesuré, et
  // non un simple appel idempotent.
  it('resolves a lost first-bootstrap race into the winning collection, never an error', async () => {
    const userId = await createUser('race')

    const winner = await pool.connect()
    let committed = false
    try {
      await winner.query('BEGIN')
      // La gagnante prend le même verrou consultatif par compte que
      // `bootstrapCollection` (multi-collection : plus d'index unique sur
      // `collection_members.user_id` pour trancher la course).
      await winner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bootstrap:${userId}`])
      const { rows } = await winner.query<{ id: string }>(
        "INSERT INTO collections (name) VALUES ('race collection') RETURNING id",
      )
      const winningCollectionId = rows[0]!.id
      await winner.query(
        "INSERT INTO containers (collection_id, kind, name) VALUES ($1, 'collection', 'race collection')",
        [winningCollectionId],
      )
      await winner.query(
        "INSERT INTO collection_members (collection_id, user_id, role) VALUES ($1, $2, 'owner')",
        [winningCollectionId, userId],
      )

      // Démarré sans `await` : sa lecture ne voit rien (la gagnante n'a pas
      // commité), puis il se met en attente sur le verrou de bootstrap.
      const losing = bootstrapCollection(userId, { username: 'race', displayName: null })

      await waitForMembershipLock()
      await winner.query('COMMIT')
      committed = true

      const result = await losing
      expect(result.created).toBe(false)
      expect(result.collectionId).toBe(winningCollectionId)
    } finally {
      if (!committed) await winner.query('ROLLBACK')
      winner.release()
    }

    // Une seule adhésion pour ce compte : la transaction perdante a bien été
    // annulée. Assertions portées sur `userId`, jamais sur un compte de
    // lignes global — les fichiers de test partagent une base.
    const memberships = await db
      .select()
      .from(collectionMembers)
      .where(eq(collectionMembers.userId, userId))
    expect(memberships).toHaveLength(1)
  })

  it('names the collection after displayName when the account has one', async () => {
    const userId = await createUser('alexm', 'Alex Martin')

    const { containerId } = await bootstrapCollection(userId, {
      username: 'alexm',
      displayName: 'Alex Martin',
    })

    const [root] = await db.select().from(containers).where(eq(containers.id, containerId))
    expect(root?.name).toBe('Alex Martin collection')
  })

  it('resolveAccess returns null / editor / owner', async () => {
    const ownerId = await createUser('owner1')
    const editorId = await createUser('editor1')
    const strangerId = await createUser('stranger1')

    const { collectionId, containerId } = await bootstrapCollection(ownerId, {
      username: 'owner1',
      displayName: null,
    })
    await db.insert(collectionMembers).values({ collectionId, userId: editorId, role: 'editor' })

    await expect(resolveAccess(strangerId, containerId)).resolves.toBeNull()
    await expect(resolveAccess(editorId, containerId)).resolves.toEqual({
      collectionId,
      role: 'editor',
    })
    await expect(resolveAccess(ownerId, containerId)).resolves.toEqual({
      collectionId,
      role: 'owner',
    })
  })

  it('requireContainerAccess throws ContainerAccessError for a non-member', async () => {
    const ownerId = await createUser('owner2')
    const strangerId = await createUser('stranger2')
    const { containerId } = await bootstrapCollection(ownerId, {
      username: 'owner2',
      displayName: null,
    })

    await expect(requireContainerAccess(strangerId, containerId)).rejects.toBeInstanceOf(
      ContainerAccessError,
    )
  })

  it('fails to remove the last owner, succeeds when another owner exists', async () => {
    const ownerId = await createUser('owner3')
    const secondOwnerId = await createUser('owner4')
    const { collectionId } = await bootstrapCollection(ownerId, {
      username: 'owner3',
      displayName: null,
    })

    await expect(removeMember(ownerId, collectionId, ownerId)).resolves.toEqual({
      ok: false,
      error: 'last_owner',
    })

    await db.insert(collectionMembers).values({ collectionId, userId: secondOwnerId, role: 'owner' })

    await expect(removeMember(ownerId, collectionId, ownerId)).resolves.toEqual({ ok: true })

    const remaining = await db
      .select()
      .from(collectionMembers)
      .where(eq(collectionMembers.collectionId, collectionId))
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.userId).toBe(secondOwnerId)
  })

  it('fails to demote the last owner the same way', async () => {
    const ownerId = await createUser('owner5')
    const { collectionId } = await bootstrapCollection(ownerId, {
      username: 'owner5',
      displayName: null,
    })

    await expect(changeMemberRole(ownerId, collectionId, ownerId, 'editor')).resolves.toEqual({
      ok: false,
      error: 'last_owner',
    })
  })

  it('adds an account that already owns another collection, and keeps both (multi-collection)', async () => {
    const ownerAId = await createUser('ownerA')
    const targetId = await createUser('nomad')

    const { collectionId: collectionA } = await bootstrapCollection(ownerAId, {
      username: 'ownerA',
      displayName: null,
    })
    // `nomad` possède déjà sa propre collection.
    const { collectionId: ownCollection } = await bootstrapCollection(targetId, {
      username: 'nomad',
      displayName: null,
    })

    await expect(addMember(ownerAId, collectionA, 'nomad')).resolves.toMatchObject({ ok: true })
    // Sa collection active reste la sienne tant qu'il n'en change pas.
    const again = await bootstrapCollection(targetId, { username: 'nomad', displayName: null })
    expect(again).toMatchObject({ collectionId: ownCollection, created: false })
    // Un second ajout dans la même collection est refusé.
    await expect(addMember(ownerAId, collectionA, 'nomad')).resolves.toEqual({
      ok: false,
      error: 'already_member',
    })
  })

  it('adds a fresh account as editor by default', async () => {
    const ownerId = await createUser('owner6')
    const targetId = await createUser('freshie')
    const { collectionId } = await bootstrapCollection(ownerId, {
      username: 'owner6',
      displayName: null,
    })

    await expect(addMember(ownerId, collectionId, 'freshie')).resolves.toEqual({
      ok: true,
      member: { userId: targetId, username: 'freshie', role: 'editor' },
    })
  })

  it('rejects an editor self-promoting to owner and then expelling the owner (privilege escalation)', async () => {
    const ownerId = await createUser('owner7')
    const editorId = await createUser('editor7')
    const { collectionId } = await bootstrapCollection(ownerId, {
      username: 'owner7',
      displayName: null,
    })
    await db.insert(collectionMembers).values({ collectionId, userId: editorId, role: 'editor' })

    // Étape 1 de l'attaque : l'`editor` tente de s'auto-promouvoir `owner`.
    // Réservé aux `owner` (l'invariant du dernier `owner` n'est pas
    // contournable) —
    // un `editor` ne peut pas administrer la liste des membres.
    await expect(
      changeMemberRole(editorId, collectionId, editorId, 'editor'),
    ).rejects.toBeInstanceOf(ContainerAccessError)

    // Étape 2, si l'étape 1 avait réussi : expulser l'owner d'origine.
    // Toujours refusée, l'`editor` n'a jamais obtenu le rôle `owner`.
    await expect(removeMember(editorId, collectionId, ownerId)).rejects.toBeInstanceOf(
      ContainerAccessError,
    )

    // Un `editor` ne peut pas non plus ajouter un tiers directement en
    // `owner`.
    await expect(addMember(editorId, collectionId, 'nobody', 'editor')).rejects.toBeInstanceOf(
      ContainerAccessError,
    )

    // La collection n'a pas changé : l'`owner` d'origine est toujours seul
    // `owner`, l'`editor` toujours `editor`.
    const remaining = await db
      .select({ userId: collectionMembers.userId, role: collectionMembers.role })
      .from(collectionMembers)
      .where(eq(collectionMembers.collectionId, collectionId))
    expect(remaining).toEqual(
      expect.arrayContaining([
        { userId: ownerId, role: 'owner' },
        { userId: editorId, role: 'editor' },
      ]),
    )
    expect(remaining).toHaveLength(2)
  })
})
