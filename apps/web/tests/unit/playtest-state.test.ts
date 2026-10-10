// Mélange, mulligan London et premiers tours du Playtest.
import { describe, expect, it } from 'vitest'

import {
  HAND_SIZE,
  cardsToBottom,
  playtestReducer,
  shuffle,
  startPlaytest,
  type PlaytestAction,
  type PlaytestCard,
  type PlaytestDeck,
  type PlaytestState,
} from '@/lib/tools/playtest-state'
import {
  anyToolEnabled,
  isToolEnabled,
  NO_TOOLS,
  TOOLS,
  toolFlagsOf,
} from '@/lib/tools/tools'

// Générateur déterministe (mulberry32) : le même germe rejoue le même mélange.
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function card(n: number): PlaytestCard {
  return { id: `h${n}:0`, cardId: `c${n}`, name: `Card ${n}`, thumbUrl: `/t/${n}` }
}

function deckOf(size: number, freeFirstMulligan = false): PlaytestDeck {
  return {
    cards: Array.from({ length: size }, (_, n) => card(n)),
    commanders: [],
    freeFirstMulligan,
  }
}

function run(state: PlaytestState, actions: PlaytestAction[], seed = 2): PlaytestState {
  const random = seeded(seed)
  return actions.reduce(
    (current, action) => playtestReducer(current, action, random),
    state,
  )
}

// Toutes les cartes du deck, où qu'elles soient : aucune ne se perd ni ne se
// duplique d'une zone à l'autre.
function allIds(state: PlaytestState): string[] {
  return [...state.library, ...state.hand, ...state.battlefield].map((c) => c.id).sort()
}

describe('shuffle', () => {
  it('keeps every item, does not mutate its input and is reproducible', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = shuffle(input, seeded(7))
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...a].sort()).toEqual(input)
    expect(shuffle(input, seeded(7))).toEqual(a)
  })
})

describe('startPlaytest', () => {
  it('deals seven cards from a shuffled library', () => {
    const deck = deckOf(60)
    const state = startPlaytest(deck, seeded(1))
    expect(state.hand).toHaveLength(HAND_SIZE)
    expect(state.library).toHaveLength(53)
    expect(state.phase).toBe('mulligan')
    expect(state.turn).toBe(0)
    expect(allIds(state)).toEqual(deck.cards.map((c) => c.id).sort())
  })

  it('deals the whole deck when it holds fewer than seven cards', () => {
    const state = startPlaytest(deckOf(4), seeded(1))
    expect(state.hand).toHaveLength(4)
    expect(state.library).toHaveLength(0)
  })
})

describe('London mulligan', () => {
  it('keeps a seven-card hand without a mulligan and starts turn one on the play', () => {
    const state = run(startPlaytest(deckOf(60), seeded(1)), [{ type: 'keep' }])
    expect(state.phase).toBe('playing')
    expect(state.turn).toBe(1)
    expect(state.hand).toHaveLength(7)
  })

  it('draws a card on turn one when on the draw', () => {
    const state = run(startPlaytest(deckOf(60), seeded(1), false), [{ type: 'keep' }])
    expect(state.hand).toHaveLength(8)
    expect(state.library).toHaveLength(52)
  })

  it('redraws seven, then puts one card per mulligan on the bottom', () => {
    let state = run(startPlaytest(deckOf(60), seeded(1)), [
      { type: 'mulligan' },
      { type: 'mulligan' },
      { type: 'keep' },
    ])
    expect(state.mulligans).toBe(2)
    expect(state.phase).toBe('bottom')
    expect(state.hand).toHaveLength(7)
    expect(cardsToBottom(state)).toBe(2)

    const [first, second, third] = state.hand
    // Pas avant d'avoir choisi le bon nombre de cartes.
    state = run(state, [
      { type: 'toggleBottom', id: first.id },
      { type: 'confirmBottom' },
    ])
    expect(state.phase).toBe('bottom')

    // Un troisième choix est refusé, un second tap désélectionne.
    state = run(state, [
      { type: 'toggleBottom', id: second.id },
      { type: 'toggleBottom', id: third.id },
    ])
    expect(state.toBottom).toEqual([first.id, second.id])

    state = run(state, [{ type: 'confirmBottom' }])
    expect(state.phase).toBe('playing')
    expect(state.hand).toHaveLength(5)
    expect(state.library.slice(-2).map((c) => c.id)).toEqual([first.id, second.id])
    expect(allIds(state)).toHaveLength(60)
  })

  it('makes the first mulligan free for Commander', () => {
    const state = run(startPlaytest(deckOf(99, true), seeded(1)), [
      { type: 'mulligan' },
      { type: 'keep' },
    ])
    expect(state.phase).toBe('playing')
    expect(state.hand).toHaveLength(7)
  })

  it('refuses a mulligan that would leave an empty hand', () => {
    const actions: PlaytestAction[] = Array.from({ length: 10 }, () => ({
      type: 'mulligan',
    }))
    const state = run(startPlaytest(deckOf(60), seeded(1)), actions)
    expect(state.mulligans).toBe(HAND_SIZE - 1)
  })
})

describe('first turns', () => {
  it('draws on each new turn and moves cards between hand and battlefield', () => {
    let state = run(startPlaytest(deckOf(60), seeded(1)), [
      { type: 'keep' },
      { type: 'nextTurn' },
    ])
    expect(state.turn).toBe(2)
    expect(state.hand).toHaveLength(8)

    const played = state.hand[0]
    state = run(state, [{ type: 'play', id: played.id }])
    expect(state.battlefield.map((c) => c.id)).toEqual([played.id])
    expect(state.hand).toHaveLength(7)

    state = run(state, [{ type: 'unplay', id: played.id }, { type: 'draw' }])
    expect(state.battlefield).toHaveLength(0)
    expect(state.hand).toHaveLength(9)
    expect(allIds(state)).toHaveLength(60)
  })

  it('ignores a draw from an empty library', () => {
    const state = run(startPlaytest(deckOf(7), seeded(1)), [
      { type: 'keep' },
      { type: 'draw' },
    ])
    expect(state.hand).toHaveLength(7)
  })

  it('locks play order once the hand is kept', () => {
    const state = run(startPlaytest(deckOf(60), seeded(1)), [
      { type: 'keep' },
      { type: 'setOnThePlay', onThePlay: false },
    ])
    expect(state.onThePlay).toBe(true)
  })
})

describe('tool catalogue', () => {
  it('ships Playtest behind its own account flag', () => {
    const entry = TOOLS.find((tool) => tool.key === 'playtest')
    expect(entry).toMatchObject({
      state: 'shipped',
      path: '/tools/playtest',
      preference: 'toolPlaytest',
    })

    const flags = toolFlagsOf({ toolLifeTracker: false, toolPlaytest: true })
    expect(anyToolEnabled(flags)).toBe(true)
    expect(isToolEnabled('playtest', flags)).toBe(true)
    expect(isToolEnabled('life_tracker', flags)).toBe(false)
    expect(anyToolEnabled(NO_TOOLS)).toBe(false)
  })

  it('gives every shipped tool a path and a preference, and no planned tool either', () => {
    for (const tool of TOOLS) {
      const shipped = tool.state === 'shipped'
      expect(Boolean(tool.path)).toBe(shipped)
      expect(Boolean(tool.preference)).toBe(shipped)
    }
  })
})
