// Limiteur de débit avec Redis indisponible : il doit continuer à refuser
// au-delà de la limite (fail-closed ou repli en mémoire), jamais tout laisser
// passer. Redis « en panne » = un vrai client ioredis pointé sur un port
// fermé — le même chemin d'erreur qu'en production (« Stream isn't
// writeable… » puis « Connection is closed. »).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signInMock = vi.fn(async () => '/login/check-email')

vi.mock('@/lib/auth', () => ({ signIn: (...args: unknown[]) => signInMock(...(args as [])) }))
vi.mock('@/lib/site-settings', () => ({ canRequestMagicLink: async () => true }))
vi.mock('@/lib/auth-codes/login-code', () => ({ canSendLoginCode: async () => true }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}))

const UNREACHABLE_REDIS = 'redis://127.0.0.1:1'

describe('rate limiting with Redis down', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    vi.resetModules()
    delete globalThis.__spellcacheRedis
    delete globalThis.__spellcacheRateLimits
    signInMock.mockClear()
    process.env.REDIS_URL = UNREACHABLE_REDIS
  })

  afterEach(() => {
    process.env.REDIS_URL = originalRedisUrl
    globalThis.__spellcacheRedis?.disconnect()
    delete globalThis.__spellcacheRedis
    delete globalThis.__spellcacheRateLimits
    vi.resetModules()
  })

  it('rateLimit still refuses the call past the limit', async () => {
    const { rateLimit } = await import('@/lib/redis')

    const results: boolean[] = []
    for (let i = 0; i < 6; i++) results.push(await rateLimit('ratelimit:test:key', 5, 900))

    expect(results.slice(0, 5).every(Boolean)).toBe(true)
    expect(results[5]).toBe(false)
  }, 20_000)

  it('requestMagicLinkAction stops sending past 5 requests for the same email', async () => {
    const { requestMagicLinkAction } = await import('@/app/(public)/login/actions')

    for (let i = 0; i < 8; i++) await requestMagicLinkAction('victim@example.com')

    expect(signInMock).toHaveBeenCalledTimes(5)
  }, 20_000)

  it('requestMagicLinkAction stops sending past 30 requests from the same IP', async () => {
    const { requestMagicLinkAction } = await import('@/app/(public)/login/actions')

    for (let i = 0; i < 35; i++) await requestMagicLinkAction(`user${i}@example.com`)

    expect(signInMock).toHaveBeenCalledTimes(30)
  }, 20_000)
})
