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

  // Unique par exécution : le plafond horaire survit à la base de test
  // quand Redis tourne.
  const email = `player-${Date.now()}@example.com`

  async function insertCode(token: string, minutesLeft = 10) {
    await pool.query(
      `INSERT INTO verification_tokens (identifier, token, expires)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [email, token, String(minutesLeft)],
    )
  }

  it('generates six-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(code.generateLoginCode()).toMatch(/^\d{6}$/)
  })

  it('revokes pending codes once the attempt limit is passed', async () => {
    await insertCode('hash-a')
    for (let i = 0; i < code.MAX_LOGIN_ATTEMPTS; i++) {
      expect(await code.registerLoginAttempt(email.toUpperCase())).toBe(true)
    }
    expect(await code.registerLoginAttempt(email)).toBe(false)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM verification_tokens')
    expect(rows[0].n).toBe(0)
  })

  it('caps attempts per hour even when fresh codes keep being requested', async () => {
    const hourly = `hourly-${Date.now()}@example.com`
    let allowed = 0
    for (let i = 0; i < code.MAX_LOGIN_ATTEMPTS_PER_HOUR + 5; i++) {
      // Un code neuf avant chaque essai : seul le plafond horaire peut refuser.
      await pool.query(
        `INSERT INTO verification_tokens (identifier, token, expires)
         VALUES ($1, $2, now() + interval '10 minutes')`,
        [hourly, `hash-${i}`],
      )
      if (await code.registerLoginAttempt(hourly)) allowed++
      await pool.query('DELETE FROM verification_tokens WHERE identifier = $1', [hourly])
    }
    expect(allowed).toBe(code.MAX_LOGIN_ATTEMPTS_PER_HOUR)
  })

  it('stops sending new codes past the active-code limit, expired ones excepted', async () => {
    for (let i = 0; i < code.MAX_ACTIVE_CODES - 1; i++) await insertCode(`hash-${i}`)
    await insertCode('hash-expired', -1)
    expect(await code.canSendLoginCode(email)).toBe(true)
    await insertCode('hash-last')
    expect(await code.canSendLoginCode(email)).toBe(false)
  })
})
