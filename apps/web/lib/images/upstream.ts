// Téléchargement des vignettes depuis le CDN de Scryfall pour le proxy
// d'images (app/api/card-image). Sur un cache disque froid, une liste de
// 1 000 cartes déclencherait 1 000 téléchargements simultanés : ce module les
// plafonne, partage un téléchargement entre demandes identiques simultanées,
// et réessaie poliment sur 429/5xx (« It is not acceptable to ignore HTTP 429
// responses », docs de l'API Scryfall).
import { SCRYFALL_USER_AGENT } from '@spellcache/core/scryfall/client'

export const MAX_CONCURRENT_DOWNLOADS = 8
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 250
const MAX_RETRY_AFTER_MS = 10_000

export class UpstreamImageError extends Error {
  constructor(readonly status: number) {
    super(`upstream HTTP ${status}`)
  }
}

interface LimiterState {
  active: number
  waiting: Array<() => void>
  inFlight: Map<string, Promise<Uint8Array>>
}

declare global {
  var __spellcacheImageLimiter: LimiterState | undefined
}

// Sur `globalThis` : un seul plafond par process, même si Next charge ce
// module dans plusieurs bundles.
function state(): LimiterState {
  return (globalThis.__spellcacheImageLimiter ??= { active: 0, waiting: [], inFlight: new Map() })
}

async function acquire(): Promise<void> {
  const s = state()
  if (s.active < MAX_CONCURRENT_DOWNLOADS) {
    s.active += 1
    return
  }
  await new Promise<void>((resolve) => s.waiting.push(resolve))
}

function release(): void {
  const s = state()
  const next = s.waiting.shift()
  if (next) next()
  else s.active -= 1
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelay(response: Response | null, attempt: number): number {
  const header = response?.headers.get('Retry-After')
  const seconds = header ? Number(header) : Number.NaN
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  return BASE_BACKOFF_MS * 2 ** attempt
}

// Seul le CDN de Scryfall est joignable par ce proxy : l'URL vient du
// catalogue, mais une ligne corrompue ne doit pas en faire un relais vers
// n'importe quel hôte.
export function isScryfallImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.scryfall.io')
  } catch {
    return false
  }
}

async function download(url: string): Promise<Uint8Array> {
  await acquire()
  try {
    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null
      try {
        response = await fetch(url, {
          headers: { 'User-Agent': SCRYFALL_USER_AGENT, Accept: 'image/*' },
        })
      } catch (error) {
        if (attempt + 1 >= MAX_ATTEMPTS) throw error
        await sleep(retryDelay(null, attempt))
        continue
      }
      if (response.ok) return new Uint8Array(await response.arrayBuffer())
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS) throw new UpstreamImageError(response.status)
      await sleep(retryDelay(response, attempt))
    }
  } finally {
    release()
  }
}

// Une seule requête sortante par URL à la fois : les demandes simultanées
// de la même vignette attendent le même téléchargement.
export function fetchScryfallImage(url: string): Promise<Uint8Array> {
  const s = state()
  const pending = s.inFlight.get(url)
  if (pending) return pending
  const promise = download(url).finally(() => s.inFlight.delete(url))
  s.inFlight.set(url, promise)
  return promise
}
