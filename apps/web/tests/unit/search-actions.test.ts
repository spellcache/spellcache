// `searchCatalogAction` : validation Zod à la frontière, et traduction de
// `InvalidCursorError` en réponse d'erreur propre plutôt qu'en rejet opaque.
// `@/lib/search/search-cards` est mocké : ce test ne dépend d'aucune base
// réelle, seul le comportement de la Server Action est sous test (le
// comportement de `searchCards()` lui-même est couvert par
// tests/integration/search-cards.test.ts). `@/lib/auth-guards`/
// `@/lib/preferences` sont mockés aussi (la devise du compte est résolue ici,
// jamais un paramètre client) — même patron que
// tests/unit/settings-actions.test.ts.
import { z } from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidCursorError } from '@/lib/search/cursor'
import type { CardSearchResult } from '@/lib/search/search-cards'

const searchCardsMock = vi.fn<(...args: unknown[]) => Promise<CardSearchResult>>()
const requireSessionMock = vi.fn()
const getPreferencesMock = vi.fn()

vi.mock('@/lib/search/search-cards', () => ({
  searchCards: (...args: unknown[]) => searchCardsMock(...args),
  getPrintingsByName: vi.fn(),
}))

vi.mock('@/lib/auth-guards', () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}))

vi.mock('@/lib/preferences', () => ({
  getPreferences: (...args: unknown[]) => getPreferencesMock(...args),
}))

const { searchCatalogAction } = await import('@/app/(app)/search/actions')

describe('searchCatalogAction', () => {
  beforeEach(() => {
    requireSessionMock.mockResolvedValue({ id: 'user-1' })
    getPreferencesMock.mockResolvedValue({ priceSource: 'tcgplayer_usd' })
  })

  it('rejects with a ZodError on malformed input', async () => {
    await expect(searchCatalogAction({ query: 42 })).rejects.toBeInstanceOf(z.ZodError)
    expect(searchCardsMock).not.toHaveBeenCalled()
  })

  it('rejects with a ZodError when input is not an object', async () => {
    await expect(searchCatalogAction('lightning bolt')).rejects.toBeInstanceOf(z.ZodError)
  })

  it('forwards valid input to searchCards(), with the account currency resolved server-side', async () => {
    const result: CardSearchResult = { items: [], nextCursor: null, totalEstimate: 0, currency: 'usd' }
    searchCardsMock.mockResolvedValueOnce(result)

    const returned = await searchCatalogAction({ query: 'bolt' })

    expect(searchCardsMock).toHaveBeenCalledWith({ query: 'bolt', currency: 'usd' })
    expect(returned).toBe(result)
  })

  it('translates InvalidCursorError into a clean error response rather than a 500', async () => {
    searchCardsMock.mockRejectedValueOnce(new InvalidCursorError('bad cursor'))

    const returned = await searchCatalogAction({ query: 'bolt', cursor: 'nimportequoi' })

    expect(returned).toEqual({ error: 'invalid_cursor', message: 'bad cursor' })
  })

  it('still rejects other searchCards() failures instead of masking them', async () => {
    searchCardsMock.mockRejectedValueOnce(new Error('db unreachable'))

    await expect(searchCatalogAction({ query: 'bolt' })).rejects.toThrow('db unreachable')
  })
})
