// Connexion par code : format du code, plafond d'essais (révocation des
// codes en attente) et plafond de codes actifs par email. Contre la base
// éphémère `postgres-test` ; se saute sans `TEST_DATABASE_URL`.
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Login code', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let code: typeof import('@/lib/auth-codes/login-code')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    code = await import('@/lib/auth-codes/login-code')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('TRUNCATE verification_tokens')
  })

  async function insertCode(token: string, minutesLeft = 10) {
    await pool.query(
      `INSERT INTO verification_tokens (identifier, token, expires)
       VALUES ('player@example.com', $1, now() + ($2 || ' minutes')::interval)`,
      [token, String(minutesLeft)],
    )
  }

  it('generates six-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(code.generateLoginCode()).toMatch(/^\d{6}$/)
  })

  it('revokes pending codes once the attempt limit is passed', async () => {
    await insertCode('hash-a')
    for (let i = 0; i < code.MAX_LOGIN_ATTEMPTS; i++) {
      expect(await code.registerLoginAttempt('Player@Example.com')).toBe(true)
    }
    expect(await code.registerLoginAttempt('player@example.com')).toBe(false)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM verification_tokens')
    expect(rows[0].n).toBe(0)
  })

  it('stops sending new codes past the active-code limit, expired ones excepted', async () => {
    for (let i = 0; i < code.MAX_ACTIVE_CODES - 1; i++) await insertCode(`hash-${i}`)
    await insertCode('hash-expired', -1)
    expect(await code.canSendLoginCode('player@example.com')).toBe(true)
    await insertCode('hash-last')
    expect(await code.canSendLoginCode('player@example.com')).toBe(false)
  })
})
