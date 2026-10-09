// Dégradation silencieuse du client Redis : sans `REDIS_URL`, ou avec un
// serveur injoignable, une recherche ne doit jamais échouer. `getRedisClient()`
// est mise en cache sur `globalThis` — chaque test réimporte le module dans un
// registre frais (`vi.resetModules`) pour repartir d'un client non initialisé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('lib/redis', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    vi.resetModules()
    delete globalThis.__spellcacheRedis
  })

  afterEach(() => {
    process.env.REDIS_URL = originalRedisUrl
    vi.resetModules()
    delete globalThis.__spellcacheRedis
  })

  it('returns null and never throws when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL
    const { getRedisClient, cacheGet, cacheSet } = await import('@/lib/redis')

    expect(getRedisClient()).toBeNull()
    await expect(cacheGet('search:v1:whatever')).resolves.toBeNull()
    await expect(cacheSet('search:v1:whatever', '{}', 600)).resolves.toBeUndefined()
  })

  it('degrades silently when REDIS_URL points at an unreachable server', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'
    const { cacheGet, cacheSet } = await import('@/lib/redis')

    await expect(cacheGet('search:v1:whatever')).resolves.toBeNull()
    await expect(cacheSet('search:v1:whatever', '{}', 600)).resolves.toBeUndefined()
  }, 10_000)
})
