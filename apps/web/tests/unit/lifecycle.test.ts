// Test unitaire : `canTransition` autorise exactement les couples de
// `ALLOWED_TRANSITIONS`, `assertTransition`/`assertReachableBuilt` lèvent
// `InvalidTransitionError` pour toute autre paire — pur, aucun accès base
// (même contrainte que `lib/decks/legality.ts`).
import { describe, expect, it } from 'vitest'

import type { DeckState } from '@spellcache/db/schema'
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  assertReachableBuilt,
  assertTransition,
  canTransition,
} from '@/lib/decks/lifecycle'

const ALL_STATES: DeckState[] = ['plan', 'assemble', 'built', 'dismantled']

describe('lib/decks/lifecycle — canTransition', () => {
  it('matches ALLOWED_TRANSITIONS exactly for every pair of states', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = ALLOWED_TRANSITIONS[from].includes(to)
        expect(canTransition(from, to)).toBe(expected)
      }
    }
  })

  it('allows plan → assemble, assemble → built|plan, built → assemble|dismantled, dismantled → plan', () => {
    expect(canTransition('plan', 'assemble')).toBe(true)
    expect(canTransition('assemble', 'built')).toBe(true)
    expect(canTransition('assemble', 'plan')).toBe(true)
    expect(canTransition('built', 'assemble')).toBe(true)
    expect(canTransition('built', 'dismantled')).toBe(true)
    expect(canTransition('dismantled', 'plan')).toBe(true)
  })

  it('refuses every other pair, including plan → built directly', () => {
    expect(canTransition('plan', 'built')).toBe(false)
    expect(canTransition('plan', 'dismantled')).toBe(false)
    expect(canTransition('built', 'plan')).toBe(false)
    expect(canTransition('dismantled', 'built')).toBe(false)
    expect(canTransition('dismantled', 'assemble')).toBe(false)
  })
})

describe('lib/decks/lifecycle — assertTransition', () => {
  it('does not throw for an allowed transition', () => {
    expect(() => assertTransition('plan', 'assemble')).not.toThrow()
  })

  it('throws InvalidTransitionError for a refused transition', () => {
    expect(() => assertTransition('plan', 'built')).toThrow(InvalidTransitionError)
    expect(() => assertTransition('dismantled', 'built')).toThrow(InvalidTransitionError)
  })
})

describe('lib/decks/lifecycle — assertReachableBuilt', () => {
  it('accepts assemble (single hop) and plan (two composed hops)', () => {
    expect(() => assertReachableBuilt('assemble')).not.toThrow()
    expect(() => assertReachableBuilt('plan')).not.toThrow()
  })

  it('refuses built (already built) and dismantled (no edge reaches built)', () => {
    expect(() => assertReachableBuilt('built')).toThrow(InvalidTransitionError)
    expect(() => assertReachableBuilt('dismantled')).toThrow(InvalidTransitionError)
  })
})
