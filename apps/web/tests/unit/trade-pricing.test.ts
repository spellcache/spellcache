// `lib/trades/pricing.ts` : prix par finition, prix saisi prioritaire sur le
// marché, ajustement par côté, cartes sans prix, et saisie d'un montant.
import { describe, expect, it } from 'vitest'

import {
  clampRate,
  marketPriceMinor,
  parsePriceMinor,
  sideValueMinor,
  tradeBalance,
  unitPriceMinor,
} from '@/lib/trades/pricing'

const prices = { usd: '1.50', usd_foil: '4.00', eur: '1.20', eur_foil: null }

describe('marketPriceMinor', () => {
  it('reads the column of the finish and currency', () => {
    expect(marketPriceMinor(prices, 'nonfoil', 'usd')).toBe(150)
    expect(marketPriceMinor(prices, 'nonfoil', 'eur')).toBe(120)
    expect(marketPriceMinor(prices, 'foil', 'usd')).toBe(400)
    expect(marketPriceMinor(prices, 'etched', 'usd')).toBe(400)
  })

  it('returns null without a price', () => {
    expect(marketPriceMinor(prices, 'foil', 'eur')).toBeNull()
    expect(marketPriceMinor(null, 'nonfoil', 'eur')).toBeNull()
  })
})

describe('trade values', () => {
  it('prefers a typed price over the market', () => {
    expect(
      unitPriceMinor({ qty: 1, marketPriceMinor: 300, priceOverrideMinor: 250 }),
    ).toBe(250)
    expect(
      unitPriceMinor({ qty: 1, marketPriceMinor: 300, priceOverrideMinor: null }),
    ).toBe(300)
    expect(unitPriceMinor({ qty: 1, marketPriceMinor: 300, priceOverrideMinor: 0 })).toBe(
      0,
    )
  })

  it('applies the side rate and counts missing prices as 0', () => {
    const lines = [
      { qty: 3, marketPriceMinor: 100, priceOverrideMinor: null },
      { qty: 1, marketPriceMinor: null, priceOverrideMinor: null },
    ]
    expect(sideValueMinor(lines, 90)).toEqual({ valueMinor: 270, missing: 1 })
  })

  it('computes the balance from the viewer side', () => {
    const balance = tradeBalance(
      {
        lines: [{ qty: 2, marketPriceMinor: 500, priceOverrideMinor: null }],
        ratePct: 100,
      },
      {
        lines: [{ qty: 1, marketPriceMinor: 1200, priceOverrideMinor: null }],
        ratePct: 80,
      },
    )
    expect(balance).toEqual({
      giveMinor: 1000,
      getMinor: 960,
      deltaMinor: -40,
      missing: 0,
    })
  })

  it('clamps a rate to its bounds', () => {
    expect(clampRate(10)).toBe(50)
    expect(clampRate(400)).toBe(150)
    expect(clampRate(92.6)).toBe(93)
  })
})

describe('parsePriceMinor', () => {
  it('accepts a dot or a comma', () => {
    expect(parsePriceMinor('12')).toBe(1200)
    expect(parsePriceMinor('12.5')).toBe(1250)
    expect(parsePriceMinor(' 12,05 ')).toBe(1205)
  })

  it('rejects anything else', () => {
    expect(parsePriceMinor('')).toBeNull()
    expect(parsePriceMinor('-1')).toBeNull()
    expect(parsePriceMinor('1.234')).toBeNull()
    expect(parsePriceMinor('abc')).toBeNull()
  })
})
