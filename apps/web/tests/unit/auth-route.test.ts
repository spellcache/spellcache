// Garde d'essais de la route Auth.js : chaque essai de code est compté avant
// Auth.js, sans contournement par POST ni par un `email` répété.
// `@/lib/auth` et le compteur sont mockés — le compteur est couvert contre
// une base réelle par tests/integration/login-code.test.ts.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlerGet = vi.fn(async () => new Response('auth-get'))
const handlerPost = vi.fn(async () => new Response('auth-post'))
const registerLoginAttemptMock = vi.fn<(email: string) => Promise<boolean>>()

vi.mock('@/lib/auth', () => ({ handlers: { GET: handlerGet, POST: handlerPost } }))
vi.mock('@/lib/auth-codes/login-code', () => ({
  registerLoginAttempt: (email: string) => registerLoginAttemptMock(email),
}))

const { GET, POST } = await import('@/app/api/auth/[...nextauth]/route')

const BASE = 'https://spellcache.test/api/auth'

function request(path: string, method = 'GET') {
  return new NextRequest(`${BASE}${path}`, { method })
}

beforeEach(() => {
  handlerGet.mockClear()
  handlerPost.mockClear()
  registerLoginAttemptMock.mockReset().mockResolvedValue(true)
})

describe('auth route — login code attempts', () => {
  it('counts the attempt before handing the callback to Auth.js', async () => {
    const response = await GET(request('/callback/resend?email=a%40b.com&token=123456'))

    expect(registerLoginAttemptMock).toHaveBeenCalledWith('a@b.com')
    expect(await response.text()).toBe('auth-get')
  })

  it('redirects without calling Auth.js once the attempts are exhausted', async () => {
    registerLoginAttemptMock.mockResolvedValueOnce(false)

    const response = await GET(request('/callback/resend?email=a%40b.com&token=123456'))

    expect(response.headers.get('location')).toContain('/login?error=TooManyAttempts')
    expect(handlerGet).not.toHaveBeenCalled()
  })

  it('rejects a repeated email so the counted address is the checked one', async () => {
    const response = await GET(
      request('/callback/resend?email=decoy%40x.com&email=victim%40x.com&token=123456'),
    )

    expect(response.headers.get('location')).toContain('/login?error=Verification')
    expect(registerLoginAttemptMock).not.toHaveBeenCalled()
    expect(handlerGet).not.toHaveBeenCalled()
  })

  it('rejects a code without an email', async () => {
    const response = await GET(request('/callback/resend?token=123456'))

    expect(response.headers.get('location')).toContain('/login?error=Verification')
    expect(handlerGet).not.toHaveBeenCalled()
  })

  it('closes the POST callback, which Auth.js would accept without counting', async () => {
    const response = await POST(
      request('/callback/resend?email=a%40b.com&token=123456', 'POST'),
    )

    expect(response.status).toBe(405)
    expect(handlerPost).not.toHaveBeenCalled()
    expect(registerLoginAttemptMock).not.toHaveBeenCalled()
  })

  it('closes direct sign-in requests, which would skip the login screen limits', async () => {
    const response = await POST(request('/signin/resend', 'POST'))

    expect(response.status).toBe(405)
    expect(handlerPost).not.toHaveBeenCalled()
  })

  it('still forwards the other POST actions to Auth.js', async () => {
    const response = await POST(request('/signout', 'POST'))

    expect(await response.text()).toBe('auth-post')
  })
})
