// `requireSession`/`requireAdmin` : redirections
// et `ForbiddenError`, `@/lib/auth` mocké — le cycle contre une session réelle
// est couvert par tests/integration/auth.test.ts.
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { describe, expect, it, vi } from 'vitest'

const authMock = vi.fn()
// `bootstrapCollection` touche la base réelle : mocké ici, couvert
// contre une base réelle par tests/integration/authorize.test.ts.
const bootstrapCollectionMock = vi.fn().mockResolvedValue({
  collectionId: 'c1',
  containerId: 'root1',
  created: false,
})

vi.mock('@/lib/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock('@/lib/collections/bootstrap', () => ({
  bootstrapCollection: (...args: unknown[]) => bootstrapCollectionMock(...args),
}))

const { ForbiddenError, requireAdmin, requireSession } = await import('@/lib/auth-guards')

describe('requireSession', () => {
  it('redirects to /login without a session', async () => {
    authMock.mockResolvedValueOnce(null)

    const error = await requireSession().catch((e: unknown) => e)

    expect(isRedirectError(error)).toBe(true)
    expect((error as { digest?: string }).digest).toContain('/login')
  })

  it('redirects to /onboarding/username when the username is not set', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', username: null, role: 'member' },
    })

    const error = await requireSession().catch((e: unknown) => e)

    expect(isRedirectError(error)).toBe(true)
    expect((error as { digest?: string }).digest).toContain('/onboarding/username')
  })

  it('resolves to a SessionUser once session and username are both present', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', username: 'morgan', role: 'member' },
    })

    await expect(requireSession()).resolves.toEqual({
      id: 'u1',
      email: 'a@b.com',
      username: 'morgan',
      role: 'member',
    })
  })
})

describe('requireAdmin', () => {
  it('throws ForbiddenError for a member', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', username: 'morgan', role: 'member' },
    })

    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('resolves for an admin', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', username: 'morgan', role: 'admin' },
    })

    await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin' })
  })
})
