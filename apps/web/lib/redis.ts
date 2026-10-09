// Client Valkey (protocole Redis) — utilisé par le cache de recherche.
// Toute panne (absent, injoignable, timeout) doit se dégrader en silence :
// une recherche ne doit jamais échouer parce que Redis est arrêté.
// `getRedisClient()` retourne `null` quand `REDIS_URL` n'est pas
// défini ; `cacheGet`/`cacheSet` journalisent puis avalent toute autre erreur.
import Redis from 'ioredis'

declare global {
  var __spellcacheRedis: Redis | null | undefined
  var __spellcacheRateLimits: Map<string, { count: number; resetAt: number }> | undefined
}

function createClient(url: string): Redis {
  const client = new Redis(url, {
    // Pas de file d'attente hors-ligne : un Redis arrêté doit faire échouer
    // une commande tout de suite, pas mettre la requête en attente. Les
    // appelants ont chacun leur repli (cache vide, limiteur en mémoire).
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Reconnexion sans fin, espacée jusqu'à 2 s : sans elle, une seule
    // coupure (redémarrage de Redis, réseau) laissait le client fermé
    // jusqu'au redémarrage de l'app. Connexion ouverte dès la création
    // (pas `lazyConnect`) pour que la première commande n'arrive pas
    // pendant la poignée de main.
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  })
  // ioredis fait planter le process sur un événement `error` sans listener —
  // on le journalise et on laisse les appelants avaler l'échec. Une panne
  // émet une erreur à chaque tentative de reconnexion : seul un message
  // différent du précédent est journalisé, puis le retour à la normale.
  let lastError: string | null = null
  client.on('error', (error: Error) => {
    if (error.message === lastError) return
    lastError = error.message
    console.warn(`[redis] ${error.message}`)
  })
  client.on('ready', () => {
    if (lastError === null) return
    lastError = null
    console.warn('[redis] connection restored')
  })
  return client
}

export function getRedisClient(): Redis | null {
  if (globalThis.__spellcacheRedis !== undefined) return globalThis.__spellcacheRedis

  const url = process.env.REDIS_URL
  const client = url ? createClient(url) : null
  globalThis.__spellcacheRedis = client
  return client
}

export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedisClient()
  if (!client) return null

  try {
    return await client.get(key)
  } catch (error) {
    console.warn(`[redis] get(${key}) failed: ${(error as Error).message}`)
    return null
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.set(key, value, 'EX', ttlSeconds)
  } catch (error) {
    console.warn(`[redis] set(${key}) failed: ${(error as Error).message}`)
  }
}

// Repli du limiteur quand Redis ne répond pas : même fenêtre fixe, tenue en
// mémoire par process. Une seule instance d'app tourne (docker-compose.example.yml),
// donc le plafond reste exact ; il repart de zéro au redémarrage, ce qui est
// acceptable pour une fenêtre de 15 min. Borné pour ne pas grossir sans fin
// sous un flot de clés distinctes.
const MEMORY_LIMITER_MAX_KEYS = 10_000

function memoryRateLimit(key: string, limit: number, windowSeconds: number): boolean {
  // Sur `globalThis`, comme le client : un seul compteur par process, même si
  // Next charge ce module dans plusieurs bundles (Server Actions, routes).
  const memoryWindows = (globalThis.__spellcacheRateLimits ??= new Map())
  const now = Date.now()
  let entry = memoryWindows.get(key)
  if (!entry || entry.resetAt <= now) {
    if (memoryWindows.size >= MEMORY_LIMITER_MAX_KEYS) {
      for (const [k, v] of memoryWindows) if (v.resetAt <= now) memoryWindows.delete(k)
      // Encore plein de fenêtres actives : refuser plutôt que d'oublier un
      // compteur, ce qui reviendrait à laisser passer.
      if (memoryWindows.size >= MEMORY_LIMITER_MAX_KEYS) return false
    }
    entry = { count: 0, resetAt: now + windowSeconds * 1000 }
    memoryWindows.set(key, entry)
  }
  entry.count += 1
  return entry.count <= limit
}

// Limiteur à fenêtre fixe (`INCR` + `EXPIRE`) : `true` tant que `key` n'a pas
// dépassé `limit` appels dans la fenêtre. Ne laisse jamais tout passer :
// Redis absent (pas de `REDIS_URL`) ou en panne, le compte continue en
// mémoire (`memoryRateLimit`) — les plafonds de connexion protègent une
// boîte mail et le quota Resend, ils ne doivent pas tomber avec Redis.
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const client = getRedisClient()
  if (!client) return memoryRateLimit(key, limit, windowSeconds)

  try {
    const count = await client.incr(key)
    if (count === 1) await client.expire(key, windowSeconds)
    return count <= limit
  } catch (error) {
    console.error(
      `[redis] rateLimit(${key}) failed, falling back to the in-memory limiter: ${(error as Error).message}`,
    )
    return memoryRateLimit(key, limit, windowSeconds)
  }
}
