// Mélange, mulligan de Londres, tours et reprise de session de la partie de
// test.
import { afterEach, describe, expect, it } from 'vitest'

import {
  OPENING_HAND_SIZE,
  PLAYTEST_STORAGE_KEY,
  PLAYTEST_ZONES,
  loadPlaytestGame,
  playtestReducer,
  savePlaytestGame,
  shuffle,
  startPlaytest,
  type PlaytestAction,
  type PlaytestCard,
  type PlaytestDeck,
  type PlaytestGame,
} from '@/lib/tools/playtest-state'

// Générateur déterministe (mulberry32), comme `tests/unit/life-state.test.ts`.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function card(cardId: string, typeLine = 'Creature — Bear'): PlaytestCard {
  return {
    cardId,
    name: cardId,
    typeLine,
    manaCost: null,
    cmc: 2,
    thumbUrl: `/api/card-image/${cardId}/small`,
    imageUrl: null,
  }
}

function deck(options: { commander?: boolean } = {}): PlaytestDeck {
  const cards: Record<string, PlaytestCard> = {
    forest: card('forest', 'Basic Land — Forest'),
    bear: card('bear'),
    elf: card('elf'),
  }
  if (options.commander) cards.boss = card('boss', 'Legendary Creature — Elf')
  return {
    id: 'deck-1',
    name: 'Green',
    main: [
      { cardId: 'forest', qty: 24 },
      { cardId: 'bear', qty: 20 },
      { cardId: 'elf', qty: 16 },
    ],
    commanders: options.commander ? ['boss'] : [],
    cards,
  }
}

function apply(game: PlaytestGame, ...actions: PlaytestAction[]): PlaytestGame {
  return actions.reduce((current, action) => playtestReducer(current, action, mulberry32(7)), game)
}

function totalCards(game: PlaytestGame): number {
  return PLAYTEST_ZONES.reduce((sum, zone) => sum + game.zones[zone].length, 0)
}

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    const items = Array.from({ length: 60 }, (_, index) => index)
    expect(shuffle(items, mulberry32(1)).sort((a, b) => a - b)).toEqual(items)
  })

  it('puts each item on top about equally often', () => {
    const rng = mulberry32(42)
    const counts = [0, 0, 0, 0, 0]
    const runs = 20_000
    for (let run = 0; run < runs; run++) counts[shuffle([0, 1, 2, 3, 4], rng)[0]!]!++
    for (const count of counts) expect(Math.abs(count / runs - 0.2)).toBeLessThan(0.02)
  })

  it('stays in range when the generator returns exactly 1', () => {
    expect(shuffle([1, 2, 3], () => 1).sort()).toEqual([1, 2, 3])
  })
})

describe('startPlaytest', () => {
  it('draws seven from a shuffled library and leaves the sideboard out', () => {
    const game = startPlaytest(deck(), true, mulberry32(3))
    expect(game.phase).toBe('mulligan')
    expect(game.zones.hand).toHaveLength(OPENING_HAND_SIZE)
    expect(game.zones.library).toHaveLength(60 - OPENING_HAND_SIZE)
    expect(totalCards(game)).toBe(60)
  })

  it('starts commanders in the command zone, outside the opening hand', () => {
    const game = startPlaytest(deck({ commander: true }), true, mulberry32(3))
    expect(game.zones.command.map((id) => game.instances[id])).toEqual(['boss'])
    expect(game.zones.hand).toHaveLength(OPENING_HAND_SIZE)
    expect(totalCards(game)).toBe(61)
  })
})

describe('London mulligan', () => {
  it('draws a fresh seven, then puts one card on the bottom per mulligan', () => {
    let game = apply(startPlaytest(deck(), true, mulberry32(5)), { type: 'mulligan' }, { type: 'mulligan' })
    expect(game.mulligans).toBe(2)
    expect(game.zones.hand).toHaveLength(OPENING_HAND_SIZE)

    game = apply(game, { type: 'keep' })
    expect(game.phase).toBe('bottom')
    expect(game.bottomPending).toBe(2)

    const [first, second] = game.zones.hand
    game = apply(game, { type: 'bottom', id: first! })
    expect(game.phase).toBe('bottom')
    game = apply(game, { type: 'bottom', id: second! })
    expect(game.phase).toBe('playing')
    expect(game.zones.hand).toHaveLength(5)
    expect(game.zones.library.slice(-2)).toEqual([first, second])
    expect(totalCards(game)).toBe(60)
  })

  it('makes the first mulligan free with a commander', () => {
    const game = apply(startPlaytest(deck({ commander: true }), true, mulberry32(5)), { type: 'mulligan' }, { type: 'keep' })
    expect(game.phase).toBe('playing')
    expect(game.zones.hand).toHaveLength(OPENING_HAND_SIZE)
  })

  it('ignores a bottom choice outside the hand', () => {
    const game = apply(startPlaytest(deck(), true, mulberry32(5)), { type: 'mulligan' }, { type: 'keep' })
    expect(apply(game, { type: 'bottom', id: game.zones.library[0]! })).toBe(game)
  })
})

describe('turns', () => {
  it('skips the first draw on the play, draws it on the draw', () => {
    const onPlay = apply(startPlaytest(deck(), true, mulberry32(9)), { type: 'keep' })
    expect(onPlay.turn).toBe(1)
    expect(onPlay.zones.hand).toHaveLength(7)

    const onDraw = apply(startPlaytest(deck(), false, mulberry32(9)), { type: 'keep' })
    expect(onDraw.zones.hand).toHaveLength(8)
  })

  it('untaps everything and draws on the next turn', () => {
    let game = apply(startPlaytest(deck(), true, mulberry32(9)), { type: 'keep' })
    const played = game.zones.hand[0]!
    game = apply(game, { type: 'move', id: played, to: 'battlefield' }, { type: 'toggleTap', id: played })
    expect(game.tapped).toEqual([played])

    game = apply(game, { type: 'nextTurn' })
    expect(game.turn).toBe(2)
    expect(game.tapped).toEqual([])
    expect(game.zones.hand).toHaveLength(7)
  })

  it('does not draw from an empty library', () => {
    let game = apply(startPlaytest(deck(), true, mulberry32(9)), { type: 'keep' })
    game = { ...game, zones: { ...game.zones, graveyard: game.zones.library, library: [] } }
    expect(apply(game, { type: 'draw' }).zones.hand).toHaveLength(7)
  })
})

describe('moving cards', () => {
  it('untaps a card leaving the battlefield and keeps the card count', () => {
    let game = apply(startPlaytest(deck(), true, mulberry32(11)), { type: 'keep' })
    const id = game.zones.hand[0]!
    game = apply(game, { type: 'move', id, to: 'battlefield' }, { type: 'toggleTap', id }, { type: 'move', id, to: 'graveyard' })
    expect(game.tapped).toEqual([])
    expect(game.zones.graveyard).toEqual([id])
    expect(totalCards(game)).toBe(60)
  })

  it('returns a card on top of the library by default, or on the bottom', () => {
    let game = apply(startPlaytest(deck(), true, mulberry32(11)), { type: 'keep' })
    const [top, bottom] = game.zones.hand
    game = apply(game, { type: 'move', id: top!, to: 'library' }, { type: 'move', id: bottom!, to: 'library', position: 'bottom' })
    expect(game.zones.library[0]).toBe(top)
    expect(game.zones.library.at(-1)).toBe(bottom)
  })

  it('cannot tap a card outside the battlefield', () => {
    const game = apply(startPlaytest(deck(), true, mulberry32(11)), { type: 'keep' })
    expect(apply(game, { type: 'toggleTap', id: game.zones.hand[0]! })).toBe(game)
  })
})

describe('session persistence', () => {
  const store = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }

  function withWindow(): void {
    ;(globalThis as { window?: unknown }).window = { sessionStorage }
  }

  afterEach(() => {
    store.clear()
    delete (globalThis as { window?: unknown }).window
  })

  it('restores the game of the same deck', () => {
    withWindow()
    const game = apply(startPlaytest(deck(), true, mulberry32(13)), { type: 'keep' }, { type: 'nextTurn' })
    savePlaytestGame(game)
    expect(loadPlaytestGame(deck())).toEqual(game)
  })

  it('ignores a game saved for another deck or with cards no longer in it', () => {
    withWindow()
    savePlaytestGame(startPlaytest(deck(), true, mulberry32(13)))
    expect(loadPlaytestGame({ ...deck(), id: 'deck-2' })).toBeNull()

    const withoutElf = Object.fromEntries(Object.entries(deck().cards).filter(([cardId]) => cardId !== 'elf'))
    expect(loadPlaytestGame({ ...deck(), cards: withoutElf })).toBeNull()
  })

  it('ignores a corrupted entry', () => {
    withWindow()
    store.set(PLAYTEST_STORAGE_KEY, '{"deckId":"deck-1"')
    expect(loadPlaytestGame(deck())).toBeNull()

    const game = startPlaytest(deck(), true, mulberry32(13))
    store.set(PLAYTEST_STORAGE_KEY, JSON.stringify({ ...game, zones: { ...game.zones, hand: [...game.zones.hand, game.zones.library[0]] } }))
    expect(loadPlaytestGame(deck())).toBeNull()
  })

  it('clears the entry when the game ends', () => {
    withWindow()
    savePlaytestGame(startPlaytest(deck(), true, mulberry32(13)))
    savePlaytestGame(null)
    expect(store.has(PLAYTEST_STORAGE_KEY)).toBe(false)
  })
})
