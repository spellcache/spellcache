import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScryfallClient } from '@spellcache/core/scryfall/client'

// La forme **actuelle** de la réponse : Scryfall sert le bulk en JSONL et a
// renommé les deux champs du fichier (`jsonl_download_uri`,
// `compressed_size`). L'ancienne graphie reste couverte par le test qui suit,
// pour que le repli ne se casse pas sans qu'on le voie.
function bulkDataResponse(): Response {
  return new Response(
    JSON.stringify({
      object: 'bulk_data',
      id: 'bulk-1',
      type: 'default_cards',
      updated_at: '2024-01-01T00:00:00Z',
      jsonl_download_uri: 'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
      compressed_size: 123,
    }),
    { status: 200 },
  )
}

function legacyBulkDataResponse(): Response {
  return new Response(
    JSON.stringify({
      object: 'bulk_data',
      id: 'bulk-1',
      type: 'default_cards',
      updated_at: '2024-01-01T00:00:00Z',
      download_uri: 'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
      size: 123,
    }),
    { status: 200 },
  )
}

describe('ScryfallClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('spaces three consecutive calls over at least 1000ms at 2 req/s', async () => {
    fetchMock.mockImplementation(async () => bulkDataResponse())
    const client = new ScryfallClient({ maxRps: 2 })

    const start = performance.now()
    await Promise.all([
      client.getBulkDataEntry('default_cards'),
      client.getBulkDataEntry('default_cards'),
      client.getBulkDataEntry('default_cards'),
    ])
    const elapsed = performance.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(950)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a 429 after a delay and eventually succeeds', async () => {
    const callTimes: number[] = []
    fetchMock.mockImplementation(async () => {
      callTimes.push(performance.now())
      if (callTimes.length === 1) {
        return new Response(null, { status: 429, headers: {} })
      }
      return bulkDataResponse()
    })
    // maxRps élevé pour isoler le délai de backoff de l'espacement du limiteur.
    const client = new ScryfallClient({ maxRps: 1000 })

    const result = await client.getBulkDataEntry('default_cards')

    expect(result.downloadUri).toBe(
      'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
    )
    expect(callTimes).toHaveLength(2)
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200)
  })

  it('grows the backoff delay across two consecutive 429s', async () => {
    const callTimes: number[] = []
    fetchMock.mockImplementation(async () => {
      callTimes.push(performance.now())
      if (callTimes.length <= 2) {
        return new Response(null, { status: 429, headers: {} })
      }
      return bulkDataResponse()
    })
    // maxRps élevé pour isoler le délai de backoff de l'espacement du limiteur.
    const client = new ScryfallClient({ maxRps: 1000 })

    const result = await client.getBulkDataEntry('default_cards')

    expect(result.downloadUri).toBe(
      'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
    )
    expect(callTimes).toHaveLength(3)
    const firstDelay = callTimes[1] - callTimes[0]
    const secondDelay = callTimes[2] - callTimes[1]
    expect(firstDelay).toBeGreaterThanOrEqual(200)
    // Le backoff exponentiel doit croître d'un essai au suivant, pas rester
    // constant.
    expect(secondDelay).toBeGreaterThan(firstDelay * 1.5)
  })

  it('sends User-Agent: spellcache/1.0 on every request', async () => {
    fetchMock.mockImplementation(async () => bulkDataResponse())
    const client = new ScryfallClient({ maxRps: 1000 })

    await client.getBulkDataEntry('default_cards')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('User-Agent')).toBe('spellcache/1.0')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('falls back to download_uri when Scryfall serves the older field names', async () => {
    fetchMock.mockResolvedValueOnce(legacyBulkDataResponse())

    const client = new ScryfallClient()
    const entry = await client.getBulkDataEntry('default_cards')

    expect(entry.downloadUri).toBe(
      'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
    )
  })

  it('lists sets across pages and keeps the icon cache-buster', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'list',
            has_more: true,
            next_page: 'https://api.scryfall.com/sets?page=2',
            data: [
              {
                object: 'set',
                code: 'frc',
                icon_svg_uri: 'https://svgs.scryfall.io/sets/frc.svg?1788148800',
                parent_set_code: 'fra',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'list',
            has_more: false,
            data: [
              {
                object: 'set',
                code: 'mbc',
                icon_svg_uri: 'https://svgs.scryfall.io/sets/mbc.svg?1',
              },
            ],
          }),
          { status: 200 },
        ),
      )

    const client = new ScryfallClient({ maxRps: 1000 })
    const sets = await client.listSets()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.scryfall.com/sets',
      'https://api.scryfall.com/sets?page=2',
    ])
    expect(sets.map((set) => set.code)).toEqual(['frc', 'mbc'])
    expect(sets[0]?.icon_svg_uri).toBe('https://svgs.scryfall.io/sets/frc.svg?1788148800')
    expect(sets[0]?.parent_set_code).toBe('fra')
  })
})
