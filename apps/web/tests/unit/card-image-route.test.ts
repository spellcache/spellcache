// Proxy de vignettes : mémorise le
// `GET /api/card-image/<id>/<variant>` et compte les appels du client HTTP
// sortant — la seconde requête doit être servie depuis le disque sans en
// émettre un nouveau. `@spellcache/db` est mocké : ce test ne dépend d'aucune base
// réelle, seul le comportement du proxy sur disque est sous test.
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE_URL = 'https://cards.scryfall.io/small/front/1/1234-fixture.jpg'
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

vi.mock('@spellcache/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ imageUris: { small: SOURCE_URL, art_crop: SOURCE_URL } }],
      }),
    }),
  },
}))

const authMock = vi.fn(async (): Promise<unknown> => ({ user: { id: 'u1' } }))
const rateLimitMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/redis', () => ({ rateLimit: (...args: unknown[]) => rateLimitMock(...args) }))

const { GET } = await import('@/app/api/card-image/[cardId]/[variant]/route')

describe('GET /api/card-image/[cardId]/[variant]', () => {
  let thumbnailsDir: string
  let originalThumbnailsDir: string | undefined
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    originalThumbnailsDir = process.env.THUMBNAILS_DIR
    thumbnailsDir = await mkdtemp(join(tmpdir(), 'spellcache-thumbs-'))
    process.env.THUMBNAILS_DIR = thumbnailsDir

    fetchMock = vi.fn(async () => new Response(IMAGE_BYTES, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    process.env.THUMBNAILS_DIR = originalThumbnailsDir
    await rm(thumbnailsDir, { recursive: true, force: true })
  })

  function call(cardId: string, variant: string, headers?: HeadersInit): Promise<Response> {
    return GET(new Request('http://localhost/api/card-image', { headers }), {
      params: Promise.resolve({ cardId, variant }),
    })
  }

  it('serves the second request from disk without an outbound call, with the required headers', async () => {
    const cardId = randomUUID()

    const first = await call(cardId, 'small')
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toMatch(/^image\//)
    expect(first.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await call(cardId, 'small')
    expect(second.status).toBe(200)
    expect(second.headers.get('Content-Type')).toMatch(/^image\//)
    expect(second.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    )
    // Servi depuis le disque : aucun appel sortant supplémentaire.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const secondBytes = new Uint8Array(await second.arrayBuffer())
    expect(secondBytes).toEqual(IMAGE_BYTES)
  })

  it('rejects variants outside small/art_crop with 400', async () => {
    const response = await call(randomUUID(), 'normal')

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits downloads per IP for visitors without an account', async () => {
    authMock.mockResolvedValueOnce(null)
    rateLimitMock.mockResolvedValueOnce(false)

    const response = await call(randomUUID(), 'small', {
      'x-forwarded-for': '198.51.100.1, 203.0.113.9',
    })

    expect(response.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rateLimitMock).toHaveBeenCalledWith('ratelimit:card-image:203.0.113.9', 300, 600)
  })

  it('leaves no partial file behind once the thumbnail is written', async () => {
    const cardId = randomUUID()
    await call(cardId, 'art_crop')

    const files = await readdir(join(thumbnailsDir, 'art_crop'))
    expect(files).toEqual([`${cardId}.jpg`])
  })
})
