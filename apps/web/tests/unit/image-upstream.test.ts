// Téléchargement des vignettes vers le CDN de Scryfall (lib/images/upstream.ts) :
// concurrence plafonnée, téléchargement partagé entre demandes identiques,
// réessais sur 429/5xx en respectant `Retry-After`, hôte limité au CDN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchScryfallImage,
  isScryfallImageUrl,
  MAX_CONCURRENT_DOWNLOADS,
  MAX_IMAGE_BYTES,
  MAX_WAITING_DOWNLOADS,
  UpstreamImageError,
} from '@/lib/images/upstream'

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const url = (n: number | string) => `https://cards.scryfall.io/small/front/x/${n}.jpg`

describe('lib/images/upstream', () => {
  beforeEach(() => {
    delete globalThis.__spellcacheImageLimiter
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it(`never runs more than ${MAX_CONCURRENT_DOWNLOADS} downloads at once`, async () => {
    let active = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return new Response(BYTES, { status: 200 })
      }),
    )

    await Promise.all(Array.from({ length: 30 }, (_, i) => fetchScryfallImage(url(i))))

    expect(peak).toBe(MAX_CONCURRENT_DOWNLOADS)
  })

  it('shares one download between simultaneous requests for the same image', async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response(BYTES, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await Promise.all(Array.from({ length: 5 }, () => fetchScryfallImage(url('same'))))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const bytes of results) expect(bytes).toEqual(BYTES)
  })

  it('retries after a 429, honouring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(BYTES, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchScryfallImage(url('rate-limited'))).resolves.toEqual(BYTES)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after 3 attempts on a persistent 503', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchScryfallImage(url('down'))).rejects.toBeInstanceOf(UpstreamImageError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 404', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchScryfallImage(url('missing'))).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses an image larger than the cap, declared or streamed', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(huge, { headers: { 'Content-Length': String(huge.length) } })),
    )
    await expect(fetchScryfallImage(url('declared'))).rejects.toMatchObject({ status: 413 })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([huge]).stream())))
    await expect(fetchScryfallImage(url('streamed'))).rejects.toMatchObject({ status: 413 })
  })

  it('never follows redirects and always sets a timeout', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(BYTES),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchScryfallImage(url('options'))

    const init = fetchMock.mock.calls[0]![1]
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('refuses new downloads once the waiting queue is full', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate
        return new Response(BYTES)
      }),
    )

    const total = MAX_CONCURRENT_DOWNLOADS + MAX_WAITING_DOWNLOADS + 1
    const results = Array.from({ length: total }, (_, i) => fetchScryfallImage(url(`queue-${i}`)))
    await expect(results[total - 1]).rejects.toMatchObject({ status: 503 })
    release()
    await Promise.all(results.slice(0, total - 1))
  })

  it('only accepts https URLs on the Scryfall CDN', () => {
    expect(isScryfallImageUrl('https://cards.scryfall.io/small/front/a/b.jpg')).toBe(true)
    expect(isScryfallImageUrl('http://cards.scryfall.io/small/front/a/b.jpg')).toBe(false)
    expect(isScryfallImageUrl('https://evil.example/scryfall.io.jpg')).toBe(false)
    expect(isScryfallImageUrl('not a url')).toBe(false)
  })
})
