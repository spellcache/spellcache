// Test d'intégration : cycle de
// connexion (jetons de vérification), unicité du username, et promotion du
// premier compte en `admin`. Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Auth & comptes', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  // Doit être posé avant l'import dynamique de `@/lib/auth` (donc de
  // `@spellcache/db`, singleton créé à l'évaluation du module — même contrainte que
  // tests/integration/search-cards.test.ts).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let verificationTokens: typeof import('@spellcache/db/schema').verificationTokens
  let promoteFirstUserToAdmin: typeof import('@/lib/auth').promoteFirstUserToAdmin

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, verificationTokens } = await import('@spellcache/db/schema'))
    ;({ promoteFirstUserToAdmin } = await import('@/lib/auth'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('TRUNCATE verification_tokens, sessions, accounts, users CASCADE')
  })

  it('promotes the first account on an empty base to admin, and the second stays member', async () => {
    const [first] = await db
      .insert(users)
      .values({ email: 'first@example.com' })
      .returning({ id: users.id })
    await promoteFirstUserToAdmin(first!.id)

    const [second] = await db
      .insert(users)
      .values({ email: 'second@example.com' })
      .returning({ id: users.id })
    await promoteFirstUserToAdmin(second!.id)

    const rows = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .orderBy(users.email)

    expect(rows).toEqual([
      { email: 'first@example.com', role: 'admin' },
      { email: 'second@example.com', role: 'member' },
    ])
  })

  it('enforces a case-sensitive-storage unique username at the database level', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: 'owner@example.com', username: 'morgan' })
      .returning({ id: users.id })
    const [other] = await db
      .insert(users)
      .values({ email: 'other@example.com' })
      .returning({ id: users.id })
    void owner

    await expect(
      db.update(users).set({ username: 'morgan' }).where(eq(users.id, other!.id)),
    ).rejects.toMatchObject({
      cause: { code: '23505' },
    })

    const [otherRow] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, other!.id))
    expect(otherRow?.username).toBeNull()
  })

  it('creates a verification_tokens row for a magic-link request', async () => {
    const identifier = 'unknown@example.com'
    const token = randomUUID()
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await db.insert(verificationTokens).values({ identifier, token, expires })

    const rows = await db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, identifier))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toBe(token)
  })

  it('a consumed verification token cannot be used twice', async () => {
    const identifier = 'used@example.com'
    const token = randomUUID()
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await db.insert(verificationTokens).values({ identifier, token, expires })

    // `useVerificationToken` de l'adapter Drizzle supprime la ligne en la
    // renvoyant (un jeton consommé, ou expiré, ne doit
    // jamais ouvrir de session une seconde fois) ; reproduit ici sans passer
    // par l'adapter pour ne dépendre que du schéma.
    const [consumed] = await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.token, token))
      .returning()
    expect(consumed?.identifier).toBe(identifier)

    const remaining = await db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.token, token))
    expect(remaining).toHaveLength(0)
  })
})
