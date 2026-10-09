// Réducteur, tirage, réinitialisation et persistance locale du compteur de
// vie.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LIFE_SETUP,
  LIFE_STORAGE_KEY,
  lifeReducer,
  loadLifeState,
  parseStartingLife,
  saveLifeState,
  seatRows,
  startLifeGame,
  type LifeGame,
  type LifeSetup,
} from '@/lib/tools/life-state'

// Générateur déterministe (mulberry32) — le critère #8 demande « un
// générateur déterministe », donc pas `Math.random()` : deux exécutions du
// test tirent exactement la même séquence.
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

function setupOf(overrides: Partial<LifeSetup> = {}): LifeSetup {
  return { ...DEFAULT_LIFE_SETUP, ...overrides }
}

function gameOf(overrides: Partial<LifeGame> = {}): LifeGame {
  const setup = overrides.setup ?? setupOf()
  return {
    setup,
    life: Array.from({ length: setup.players }, () => setup.startingLife),
    firstPlayer: null,
    startedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('lifeReducer — adjust', () => {
  it('changes only the target seat, in both directions', () => {
    const game = gameOf({ setup: setupOf({ players: 4, startingLife: 40 }) })

    const gained = lifeReducer(game, { type: 'adjust', seat: 2, delta: 1 })
    expect(gained.life).toEqual([40, 40, 41, 40])

    const lost = lifeReducer(gained, { type: 'adjust', seat: 0, delta: -1 })
    expect(lost.life).toEqual([39, 40, 41, 40])

    // L'instantané d'origine n'est pas muté (les deux écrans lisent le même
    // objet pendant la surbrillance de 5 s).
    expect(game.life).toEqual([40, 40, 40, 40])
  })

  it('ignores a seat outside the grid rather than growing the life array', () => {
    const game = gameOf({ setup: setupOf({ players: 2 }) })
    expect(lifeReducer(game, { type: 'adjust', seat: 5, delta: 1 })).toBe(game)
    expect(lifeReducer(game, { type: 'adjust', seat: -1, delta: 1 })).toBe(game)
  })
})

describe('lifeReducer — reset and roll', () => {
  it('reset restores the starting life of every seat', () => {
    const game = gameOf({ setup: setupOf({ players: 3, startingLife: 20 }), life: [12, 4, 31] })
    expect(lifeReducer(game, { type: 'reset' }).life).toEqual([20, 20, 20])
  })

  it('reset never rolls, whether rollForFirst is on or off', () => {
    const rolling = gameOf({ setup: setupOf({ players: 4, rollForFirst: true }), firstPlayer: 1 })
    expect(lifeReducer(rolling, { type: 'reset' }, () => 0.9).firstPlayer).toBeNull()

    const silent = gameOf({ setup: setupOf({ players: 4, rollForFirst: false }), firstPlayer: 2 })
    expect(lifeReducer(silent, { type: 'reset' }, () => 0.9).firstPlayer).toBeNull()
  })

  it('the die rolls even when rollForFirst is off', () => {
    const silent = gameOf({ setup: setupOf({ players: 4, rollForFirst: false }) })
    expect(lifeReducer(silent, { type: 'roll' }, () => 0.9).firstPlayer).toBe(3)
  })

  it('never returns a seat outside the grid, even for a generator returning exactly 1', () => {
    const game = gameOf({ setup: setupOf({ players: 5 }) })
    expect(lifeReducer(game, { type: 'roll' }, () => 1).firstPlayer).toBe(4)
    expect(lifeReducer(game, { type: 'roll' }, () => 0).firstPlayer).toBe(0)
  })
})

describe('lifeReducer — roll uniformity', () => {
  const DRAWS = 10_000

  it.each([2, 3, 4, 5, 6] as const)(
    'picks a seat in [0, %i) uniformly over 10 000 deterministic draws',
    (players) => {
      const rng = mulberry32(0x5eed + players)
      const game = gameOf({ setup: setupOf({ players }) })
      const counts = new Array<number>(players).fill(0)

      for (let draw = 0; draw < DRAWS; draw += 1) {
        const seat = lifeReducer(game, { type: 'roll' }, rng).firstPlayer
        expect(seat).not.toBeNull()
        expect(seat).toBeGreaterThanOrEqual(0)
        expect(seat).toBeLessThan(players)
        counts[seat as number] += 1
      }

      // Écart inférieur à 2 % : la part observée de chaque siège ne s'écarte
      // pas de plus de 2 points de la part attendue `1 / players`.
      const expectedShare = 1 / players
      for (const count of counts) {
        expect(Math.abs(count / DRAWS - expectedShare)).toBeLessThan(0.02)
      }
    },
  )
})

describe('lifeReducer — end', () => {
  it('returns the snapshot untouched (quitting is the screen dropping the game)', () => {
    const game = gameOf({ life: [12, 40, 3, 21], firstPlayer: 1 })
    expect(lifeReducer(game, { type: 'end' })).toBe(game)
  })
})

describe('startLifeGame', () => {
  it('fills every seat with the starting life and stamps the start', () => {
    const game = startLifeGame(setupOf({ players: 5, startingLife: 30 }), () => 0.1, 42)
    expect(game.life).toEqual([30, 30, 30, 30, 30])
    expect(game.startedAt).toBe(42)
  })

  it('rolls on start only when rollForFirst is on', () => {
    expect(startLifeGame(setupOf({ rollForFirst: true }), () => 0.5, 0).firstPlayer).toBe(2)
    expect(startLifeGame(setupOf({ rollForFirst: false }), () => 0.5, 0).firstPlayer).toBeNull()
  })

  it('replays an identical game from the same setup', () => {
    const setup = setupOf({ players: 3, startingLife: 20, rollForFirst: false })
    const first = startLifeGame(setup, () => 0, 1)
    const second = startLifeGame(setup, () => 0, 2)
    expect(second.setup).toEqual(first.setup)
    expect(second.life).toEqual(first.life)
  })
})

describe('seatRows', () => {
  it('splits four seats into a 2x2 grid', () => {
    expect(seatRows(4)).toEqual({ top: [0, 1], bottom: [2, 3] })
  })

  // `flipped = players <= 2 ? 1 : ceil(n/2)` : à trois joueurs, deux pavés
  // retournés sur trois.
  it.each([
    [2, { top: [0], bottom: [1] }],
    [3, { top: [0, 1], bottom: [2] }],
    [5, { top: [0, 1, 2], bottom: [3, 4] }],
    [6, { top: [0, 1, 2], bottom: [3, 4, 5] }],
  ])('follows the player count for %i seats', (players, expected) => {
    expect(seatRows(players as number)).toEqual(expected)
  })
})

describe('parseStartingLife', () => {
  it('accepts a positive integer', () => {
    expect(parseStartingLife('25')).toBe(25)
    expect(parseStartingLife(' 60 ')).toBe(60)
  })

  it('rejects anything else', () => {
    for (const raw of ['', '0', '-5', '20.5', 'twenty', 'NaN', 'Infinity']) {
      expect(parseStartingLife(raw)).toBeNull()
    }
  })
})

// `environment: 'node'` (vitest.config.ts) : pas de `window`. Le module ne
// touche `localStorage` que derrière `typeof window === 'undefined'`, ce
// stub suffit donc à exercer les deux chemins.
interface StubbedWindow {
  localStorage: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
  }
}

function stubWindow(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as { window?: StubbedWindow }).window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
    },
  }
  return store
}

afterEach(() => {
  delete (globalThis as { window?: StubbedWindow }).window
})

describe('loadLifeState / saveLifeState', () => {
  it('round-trips the setup and the running game through the single local entry', () => {
    const store = stubWindow()
    const state = { setup: setupOf({ players: 2 }), game: gameOf({ setup: setupOf({ players: 2 }) }) }

    saveLifeState(state)
    expect([...store.keys()]).toEqual([LIFE_STORAGE_KEY])
    expect(loadLifeState()).toEqual(state)
  })

  it('returns null without a window (server render)', () => {
    expect(loadLifeState()).toBeNull()
  })

  it.each([
    ['not json at all', 'not json at all'],
    ['a game whose life array does not match the player count', JSON.stringify({
      setup: { players: 4, startingLife: 40, rollForFirst: true, keepAwake: true },
      game: {
        setup: { players: 4, startingLife: 40, rollForFirst: true, keepAwake: true },
        life: [40, 40],
        firstPlayer: null,
        startedAt: 1,
      },
    })],
    ['a first player outside the grid', JSON.stringify({
      setup: { players: 2, startingLife: 20, rollForFirst: true, keepAwake: false },
      game: {
        setup: { players: 2, startingLife: 20, rollForFirst: true, keepAwake: false },
        life: [20, 20],
        firstPlayer: 4,
        startedAt: 1,
      },
    })],
    ['a player count out of range', JSON.stringify({
      setup: { players: 9, startingLife: 20, rollForFirst: true, keepAwake: false },
      game: null,
    })],
  ])('rejects %s rather than crashing the screen', (_label, raw) => {
    const store = stubWindow()
    store.set(LIFE_STORAGE_KEY, raw)
    expect(loadLifeState()).toBeNull()
  })
})

// `grep -rn "localStorage" app components lib` ne doit montrer que
// `lib/tools/life-state.ts` — la seule exception que
// docs/development.md accorde. Implémenté en pur Node, comme
// `tests/unit/no-password-storage.test.ts`.
//
// Le grep littéral remonte aussi les commentaires qui
// **énoncent** l'interdiction (« jamais `localStorage` (docs/development.md) ») : ce
// sont eux qui la documentent, les effacer affaiblirait la règle au lieu de
// la tenir. Le test porte donc sur le code, commentaires retirés — il échoue
// dès qu'un second module *utilise* `localStorage`, ce que le critère vise.
function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    return statSync(fullPath).isDirectory() ? collectFiles(fullPath) : [fullPath]
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('localStorage stays a single exception', () => {
  it('is used nowhere else in app/, components/ or lib/', () => {
    const offenders = ['app', 'components', 'lib']
      .flatMap((root) => collectFiles(join(process.cwd(), root)))
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => stripComments(readFileSync(file, 'utf-8')).includes('localStorage'))
      .map((file) => file.replace(process.cwd(), '').replace(/\\/g, '/').replace(/^\//, ''))

    expect(offenders).toEqual(['lib/tools/life-state.ts'])
  })

  it('would still catch a second module using it (the stripper only drops comments)', () => {
    expect(stripComments('// jamais localStorage (docs/development.md)\nconst a = 1')).not.toContain(
      'localStorage',
    )
    expect(stripComments('window.localStorage.setItem("k", "v")')).toContain('localStorage')
  })
})
