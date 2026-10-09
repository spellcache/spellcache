// Réglage des inscriptions : `invite` par défaut, `open` sur choix d'un
// admin. Contre la base éphémère `postgres-test` ; se saute sans
// `TEST_DATABASE_URL`, même garde que les autres tests d'intégration.
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Signup mode', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let settings: typeof import('@/lib/site-settings')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    settings = await import('@/lib/site-settings')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('TRUNCATE site_settings, users CASCADE')
  })

  it('defaults to invite-only with no settings row', async () => {
    expect(await settings.getSignupMode()).toBe('invite')
  })

  it('lets the very first account in, whatever the mode', async () => {
    expect(await settings.canRequestMagicLink('first@example.com')).toBe(true)
  })

  it('refuses an unknown email once an account exists, until sign-ups open', async () => {
    await pool.query("INSERT INTO users (email, username) VALUES ('admin@example.com', 'admin')")

    expect(await settings.canRequestMagicLink('stranger@example.com')).toBe(false)
    // Un compte existant ou invité reçoit toujours son lien, casse ignorée.
    expect(await settings.canRequestMagicLink('Admin@Example.com')).toBe(true)

    await settings.setSignupMode('open')
    expect(await settings.getSignupMode()).toBe('open')
    expect(await settings.canRequestMagicLink('stranger@example.com')).toBe(true)

    await settings.setSignupMode('invite')
    expect(await settings.canRequestMagicLink('stranger@example.com')).toBe(false)
  })

  it('reserves the very first account to ADMIN_EMAIL when it is set', async () => {
    process.env.ADMIN_EMAIL = 'Owner@Example.com'
    try {
      expect(await settings.canRequestMagicLink('first@example.com')).toBe(false)
      expect(await settings.canRequestMagicLink('owner@example.com')).toBe(true)

      const auth = await import('@/lib/auth')
      const {
        rows: [first],
      } = await pool.query("INSERT INTO users (email) VALUES ('early@example.com') RETURNING id")
      const {
        rows: [owner],
      } = await pool.query("INSERT INTO users (email) VALUES ('owner@example.com') RETURNING id")
      await auth.promoteFirstUserToAdmin(first.id)
      await auth.promoteFirstUserToAdmin(owner.id)

      const { rows } = await pool.query('SELECT email, role FROM users ORDER BY email')
      expect(rows).toEqual([
        { email: 'early@example.com', role: 'member' },
        { email: 'owner@example.com', role: 'admin' },
      ])
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })
})
