// Client Scryfall unique — seul point du code autorisé à parler à Scryfall
// (docs/development.md). Porte le plafond de débit, le
// backoff exponentiel sur 429 et les en-têtes requis.
// Import relatif avec extension explicite (et non l'alias `@/`) : ce module
// est aussi exécuté tel quel par `node apps/worker/src/import-bulk.ts`, sans bundler,
// où seule la résolution ESM native de Node est disponible.
import {
  bulkDataEntrySchema,
  cardCollectionResponseSchema,
  setListResponseSchema,
  type ScryfallCard,
  type ScryfallSet,
} from './schemas.ts'

const BASE_URL = 'https://api.scryfall.com'
// Scryfall exige un `User-Agent` qui identifie l'appelant, et son CDN
// d'images répond `400` à celui que Node envoie par défaut (`node`). Exporté
// pour que le proxy d'images (`app/api/card-image/…`) envoie exactement le
// même, plutôt qu'une seconde chaîne qui dériverait de celle-ci.
export const SCRYFALL_USER_AGENT = 'spellcache/1.0'
const USER_AGENT = SCRYFALL_USER_AGENT
const ACCEPT = 'application/json'
const MAX_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 250
const MAX_COLLECTION_BATCH = 75

export class ScryfallRateLimitError extends Error {}
export class ScryfallUnavailableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type CardIdentifier = { id: string } | { set: string; collector_number: string }

export class ScryfallClient {
  private readonly minIntervalMs: number
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(opts?: { maxRps?: number }) {
    const maxRps = opts?.maxRps ?? 2
    this.minIntervalMs = 1000 / maxRps
  }

  // Un `429` ignoré peut mener à un blocage définitif de l'IP par Scryfall
  // — chaque appel passe par cette file, qui
  // sérialise les requêtes concurrentes et espace leur départ.
  private async throttle(): Promise<void> {
    const previous = this.queue
    let release = (): void => {}
    this.queue = new Promise((resolve) => {
      release = resolve
    })
    await previous

    const wait = Math.max(0, this.lastRequestAt + this.minIntervalMs - Date.now())
    if (wait > 0) await sleep(wait)
    this.lastRequestAt = Date.now()
    release()
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.throttle()

      let response: Response
      try {
        response = await fetch(`${BASE_URL}${path}`, {
          ...init,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: ACCEPT,
            ...init?.headers,
          },
        })
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          throw new ScryfallUnavailableError(
            `Scryfall unreachable: ${(error as Error).message}`,
          )
        }
        await sleep(INITIAL_BACKOFF_MS * 2 ** attempt)
        continue
      }

      if (response.status === 429) {
        if (attempt === MAX_ATTEMPTS) {
          throw new ScryfallRateLimitError('Scryfall rate limit exceeded after retries')
        }
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : INITIAL_BACKOFF_MS * 2 ** attempt
        await sleep(delay)
        continue
      }

      if (response.status >= 500) {
        if (attempt === MAX_ATTEMPTS) {
          throw new ScryfallUnavailableError(
            `Scryfall unavailable: HTTP ${response.status}`,
          )
        }
        await sleep(INITIAL_BACKOFF_MS * 2 ** attempt)
        continue
      }

      return response
    }
    // Inatteignable : la boucle retourne ou lève à chaque itération.
    throw new ScryfallUnavailableError('Scryfall unreachable')
  }

  async getBulkDataEntry(
    type: 'default_cards',
  ): Promise<{ updatedAt: Date; downloadUri: string }> {
    const response = await this.request(`/bulk-data/${type}`)
    if (!response.ok) {
      throw new ScryfallUnavailableError(
        `Scryfall bulk-data lookup failed: HTTP ${response.status}`,
      )
    }
    const entry = bulkDataEntrySchema.parse(await response.json())
    // `jsonl_download_uri` d'abord : c'est le nom actuel, et le fichier qu'il
    // sert est du JSONL — une ligne par carte, ce que `import-bulk.ts` lit
    // déjà. `download_uri` reste le repli si Scryfall le remet.
    const downloadUri = entry.jsonl_download_uri ?? entry.download_uri
    if (!downloadUri) {
      throw new ScryfallUnavailableError('Scryfall bulk-data entry has no download URI')
    }
    return { updatedAt: new Date(entry.updated_at), downloadUri }
  }

  async postCardCollection(ids: CardIdentifier[]): Promise<ScryfallCard[]> {
    if (ids.length === 0) return []
    if (ids.length > MAX_COLLECTION_BATCH) {
      throw new RangeError(
        `postCardCollection accepts at most ${MAX_COLLECTION_BATCH} identifiers per call`,
      )
    }
    const response = await this.request('/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids }),
    })
    if (!response.ok) {
      throw new ScryfallUnavailableError(
        `Scryfall /cards/collection failed: HTTP ${response.status}`,
      )
    }
    const parsed = cardCollectionResponseSchema.parse(await response.json())
    return parsed.data
  }

  // Liste complète des sets — worker uniquement, une requête par import
  // (`apps/worker/src/import-bulk.ts`), jamais pendant une requête utilisateur. Suit
  // `next_page` si Scryfall se met à paginer ; aujourd'hui les ~1 050 sets
  // tiennent en une page (`has_more: false`).
  async listSets(): Promise<ScryfallSet[]> {
    const sets: ScryfallSet[] = []
    let path: string | null = '/sets'
    while (path) {
      const response = await this.request(path)
      if (!response.ok) {
        throw new ScryfallUnavailableError(
          `Scryfall /sets failed: HTTP ${response.status}`,
        )
      }
      const page = setListResponseSchema.parse(await response.json())
      sets.push(...page.data)
      path =
        page.has_more && page.next_page?.startsWith(BASE_URL)
          ? page.next_page.slice(BASE_URL.length)
          : null
    }
    return sets
  }
}
