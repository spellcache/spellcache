// Test unitaire : formatage selon la devise
// préférée, jamais la locale du navigateur.
import { describe, expect, it } from 'vitest'

import { formatCount, formatMoney } from '@/lib/format/money'

describe('lib/format/money', () => {
  it('formats USD with the $ symbol and en-US grouping', () => {
    expect(formatMoney(481260, 'usd')).toBe('$4,812.60')
  })

  it('formats EUR with the same leading symbol and en-US grouping as USD', () => {
    // Les deux devises partagent une seule locale, pour que le rendu serveur
    // et le rendu client ne puissent pas diverger (`lib/format/money.ts`).
    expect(formatMoney(481260, 'eur')).toBe('€4,812.60')
  })

  it('formats a whole-number amount as $0.00 for an empty collection', () => {
    expect(formatMoney(0, 'usd')).toBe('$0.00')
  })

  it('formats a count with en-US thousands grouping', () => {
    expect(formatCount(1284)).toBe('1,284')
  })
})
