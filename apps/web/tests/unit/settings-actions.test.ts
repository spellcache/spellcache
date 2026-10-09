// `setUsernameAction`/`inviteUserAction` : la validation Zod et le mapping
// d'erreurs sous test, indépendamment de la base réelle — mêmes principes que
// tests/unit/search-actions.test.ts.
// Le cycle complet contre une base réelle est couvert par
// tests/integration/auth.test.ts.
import { describe, expect, it, vi } from 'vitest'

const authMock = vi.fn()
const dbUpdateWhereMock = vi.fn()
const dbInsertReturningMock = vi.fn()
const dbSelectWhereLimitMock = vi.fn()
const requireAdminMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

class ForbiddenError extends Error {}

vi.mock('@/lib/auth-guards', () => ({
  ForbiddenError,
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}))

vi.mock('@spellcache/db', () => ({
  db: {
    update: () => ({
      set: () => ({ where: (...args: unknown[]) => dbUpdateWhereMock(...args) }),
    }),
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => ({
          limit: (...limitArgs: unknown[]) =>
            dbSelectWhereLimitMock(...args, ...limitArgs),
        }),
      }),
    }),
    insert: () => ({
      values: (...args: unknown[]) => ({
        returning: (...returningArgs: unknown[]) =>
          dbInsertReturningMock(...args, ...returningArgs),
      }),
    }),
  },
}))

const { setUsernameAction, inviteUserAction } = await import('@/app/(app)/settings/actions')
const { usernameSchema } = await import('@/lib/username')

describe('usernameSchema', () => {
  it('accepts lowercase alphanumerics, - and _, 3-20 chars', () => {
    expect(usernameSchema.safeParse('morgan_smith-01').success).toBe(true)
  })

  it('rejects uppercase, punctuation and out-of-range lengths', () => {
    expect(usernameSchema.safeParse('AB').success).toBe(false)
    expect(usernameSchema.safeParse('a'.repeat(21)).success).toBe(false)
    expect(usernameSchema.safeParse('bad username').success).toBe(false)
  })
})

describe('setUsernameAction', () => {
  it("returns { ok: false, error: 'invalid' } for a malformed username", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user-1' } })

    const result = await setUsernameAction('AB')

    expect(result).toEqual({ ok: false, error: 'invalid' })
    expect(dbUpdateWhereMock).not.toHaveBeenCalled()
  })

  it("returns { ok: false, error: 'taken' } on a unique-violation without altering the row otherwise", async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    dbUpdateWhereMock.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    )

    const result = await setUsernameAction('taken-name')

    expect(result).toEqual({ ok: false, error: 'taken' })
  })

  it('returns { ok: true } once the update succeeds', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    dbUpdateWhereMock.mockResolvedValueOnce(undefined)

    const result = await setUsernameAction('morgan')

    expect(result).toEqual({ ok: true })
  })
})

describe('inviteUserAction', () => {
  it("returns { ok: false, error: 'forbidden' } for a non-admin caller", async () => {
    requireAdminMock.mockRejectedValueOnce(new ForbiddenError('Admin role required.'))

    const result = await inviteUserAction({ email: 'member@example.com' })

    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(dbInsertReturningMock).not.toHaveBeenCalled()
  })

  it("returns { ok: false, error: 'exists' } for an already-registered email", async () => {
    requireAdminMock.mockResolvedValueOnce({ id: 'admin-1', role: 'admin' })
    dbSelectWhereLimitMock.mockResolvedValueOnce([{ id: 'user-1' }])

    const result = await inviteUserAction({ email: 'taken@example.com' })

    expect(result).toEqual({ ok: false, error: 'exists' })
    expect(dbInsertReturningMock).not.toHaveBeenCalled()
  })
})
