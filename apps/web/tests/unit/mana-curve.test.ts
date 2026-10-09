// Test unitaire : `computeManaCurve` a toujours exactement 8 entrées (`0` à
// `7+`), et la somme de ses `count` égale le nombre de cartes non-terrain du
// mainboard passé en entrée. Pure — aucun accès base, même contrainte que
// `evaluateDeck` (`lib/decks/legality.ts`).
import { describe, expect, it } from 'vitest'

import { computeManaCurve, isLand, type ManaCurveCard } from '@/app/(app)/decks/[id]/deck-data'

function card(overrides: Partial<ManaCurveCard> & { cmc: number | string; qty: number }): ManaCurveCard {
  return { typeLine: 'Creature — Human', ...overrides }
}

describe('computeManaCurve', () => {
  it('has exactly 8 entries, from cmc 0 to the 7+ bucket', () => {
    const curve = computeManaCurve([])
    expect(curve).toHaveLength(8)
    expect(curve.map((bucket) => bucket.cmc)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('sums to the exact non-land mainboard count, excluding every land', () => {
    const mainboard: ManaCurveCard[] = [
      card({ cmc: 1, qty: 4 }),
      card({ cmc: 2, qty: 2 }),
      card({ cmc: 3, qty: 1 }),
      card({ typeLine: 'Basic Land — Plains', cmc: 0, qty: 24 }),
      card({ typeLine: 'Land — Gate', cmc: 0, qty: 2 }),
    ]
    const curve = computeManaCurve(mainboard)
    const total = curve.reduce((sum, bucket) => sum + bucket.count, 0)

    // 4 + 2 + 1 = 7 cartes non-terrain — les 26 terrains n'entrent jamais
    // dans la somme, qu'ils soient de base ou non (`isLand` : la courbe
    // exclut *tout* terrain, plus large que la règle de légalité qui n'exempte
    // que les terrains de base).
    expect(total).toBe(7)
    expect(curve[1]).toEqual({ cmc: 1, count: 4 })
    expect(curve[2]).toEqual({ cmc: 2, count: 2 })
    expect(curve[3]).toEqual({ cmc: 3, count: 1 })
  })

  it('regroups every cmc of 7 or above into the last bucket ("7+")', () => {
    const mainboard: ManaCurveCard[] = [
      card({ cmc: 7, qty: 1 }),
      card({ cmc: 8, qty: 2 }),
      card({ cmc: 15, qty: 1 }),
    ]
    const curve = computeManaCurve(mainboard)
    expect(curve[7]).toEqual({ cmc: 7, count: 4 })
    // Aucun autre palier ne reçoit ces cartes.
    for (let i = 0; i < 7; i += 1) expect(curve[i]!.count).toBe(0)
  })

  it('reads a string cmc (as Postgres numeric returns it) as a number', () => {
    const curve = computeManaCurve([card({ cmc: '3', qty: 2 })])
    expect(curve[3]).toEqual({ cmc: 3, count: 2 })
  })

  it('weights each bucket by qty, not by the number of distinct cards', () => {
    const curve = computeManaCurve([card({ cmc: 2, qty: 4 })])
    expect(curve[2]).toEqual({ cmc: 2, count: 4 })
  })
})

describe('isLand', () => {
  it('matches any type line containing "Land", basic or not', () => {
    expect(isLand('Basic Land — Plains')).toBe(true)
    expect(isLand('Land — Gate')).toBe(true)
    expect(isLand('Land — Desert')).toBe(true)
    expect(isLand('Creature — Human Wizard')).toBe(false)
    expect(isLand('Artifact Land')).toBe(true)
  })
})
