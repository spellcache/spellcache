// État d'une partie de test en solo : mélange, main de départ, mulligan de
// Londres, pioche, tours. Pur — le générateur aléatoire est un paramètre,
// jamais un `Math.random()` enfoui dans un composant, pour que l'équité du
// mélange se vérifie en test (même patron que `lib/tools/life-state.ts`).
//
// La partie en cours survit à un rechargement via `sessionStorage` : un
// onglet mobile déchargé en arrière-plan ne doit pas faire perdre un tour 6,
// mais une vieille partie ne doit pas non plus réapparaître des jours plus
// tard dans un nouvel onglet (docs/development.md).
import { z } from 'zod'

export const PLAYTEST_ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as const
export type PlaytestZone = (typeof PLAYTEST_ZONES)[number]

export const OPENING_HAND_SIZE = 7

// Une carte du deck telle que la partie l'affiche. `qty` exemplaires
// deviennent autant d'instances distinctes au démarrage.
export interface PlaytestCard {
  cardId: string
  name: string
  typeLine: string
  manaCost: string | null
  cmc: number
  thumbUrl: string
  imageUrl: string | null
}

export interface PlaytestDeck {
  id: string
  name: string
  // Mainboard seul : la réserve n'entre jamais en partie.
  main: Array<{ cardId: string; qty: number }>
  commanders: string[]
  cards: Record<string, PlaytestCard>
}

// `mulligan` : main proposée, pas encore gardée. `bottom` : main gardée
// après mulligan, il reste `bottomPending` cartes à mettre sous la
// bibliothèque. `playing` : la partie a commencé.
export type PlaytestPhase = 'mulligan' | 'bottom' | 'playing'

export interface PlaytestGame {
  deckId: string
  onThePlay: boolean
  phase: PlaytestPhase
  turn: number // 0 tant que la main n'est pas gardée
  mulligans: number
  bottomPending: number
  // Identifiant d'instance → carte du deck.
  instances: Record<string, string>
  // `library[0]` est le dessus de la bibliothèque.
  zones: Record<PlaytestZone, string[]>
  tapped: string[]
}

export type PlaytestAction =
  | { type: 'mulligan' }
  | { type: 'keep' }
  | { type: 'bottom'; id: string }
  | { type: 'draw' }
  | { type: 'nextTurn' }
  | { type: 'untapAll' }
  | { type: 'toggleTap'; id: string }
  | { type: 'move'; id: string; to: PlaytestZone; position?: 'top' | 'bottom' }
  | { type: 'shuffle' }

// Fisher-Yates. `Math.min` borne le cas où le générateur injecté renvoie
// exactement 1 (`Math.random()` ne le fait jamais, un générateur de test le
// peut).
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.min(index, Math.floor(rng() * (index + 1)))
    ;[result[index], result[swap]] = [result[swap]!, result[index]!]
  }
  return result
}

// Mulligan de Londres : une carte sous la bibliothèque par mulligan, le
// premier étant gratuit pour un deck avec commandant (règle 103.5c).
function cardsToBottom(game: PlaytestGame): number {
  const free = game.zones.command.length > 0 ? 1 : 0
  return Math.max(0, game.mulligans - free)
}

function emptyZones(): Record<PlaytestZone, string[]> {
  return { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] }
}

function zoneOf(game: PlaytestGame, id: string): PlaytestZone | null {
  return PLAYTEST_ZONES.find((zone) => game.zones[zone].includes(id)) ?? null
}

function drawCards(game: PlaytestGame, count: number): PlaytestGame {
  // Une bibliothèque vide ne fait pas perdre ici : la partie de test
  // s'arrête quand l'utilisateur le décide.
  const drawn = game.zones.library.slice(0, count)
  return {
    ...game,
    zones: {
      ...game.zones,
      library: game.zones.library.slice(drawn.length),
      hand: [...game.zones.hand, ...drawn],
    },
  }
}

function beginTurnOne(game: PlaytestGame): PlaytestGame {
  const started: PlaytestGame = { ...game, phase: 'playing', turn: 1, bottomPending: 0 }
  // Sans le jeu, le premier tour pioche ; avec, il ne pioche pas.
  return game.onThePlay ? started : drawCards(started, 1)
}

export function startPlaytest(
  deck: PlaytestDeck,
  onThePlay: boolean,
  rng: () => number = Math.random,
): PlaytestGame {
  const instances: Record<string, string> = {}
  const library: string[] = []
  const command: string[] = []
  let next = 0
  for (const cardId of deck.commanders) {
    const id = `c${next++}`
    instances[id] = cardId
    command.push(id)
  }
  for (const { cardId, qty } of deck.main) {
    for (let copy = 0; copy < qty; copy++) {
      const id = `c${next++}`
      instances[id] = cardId
      library.push(id)
    }
  }

  const game: PlaytestGame = {
    deckId: deck.id,
    onThePlay,
    phase: 'mulligan',
    turn: 0,
    mulligans: 0,
    bottomPending: 0,
    instances,
    zones: { ...emptyZones(), library: shuffle(library, rng), command },
    tapped: [],
  }
  return drawCards(game, OPENING_HAND_SIZE)
}

export function playtestReducer(
  game: PlaytestGame,
  action: PlaytestAction,
  rng: () => number = Math.random,
): PlaytestGame {
  switch (action.type) {
    case 'mulligan': {
      if (game.phase !== 'mulligan') return game
      const library = shuffle([...game.zones.library, ...game.zones.hand], rng)
      const reshuffled: PlaytestGame = {
        ...game,
        mulligans: game.mulligans + 1,
        zones: { ...game.zones, library, hand: [] },
      }
      return drawCards(reshuffled, OPENING_HAND_SIZE)
    }
    case 'keep': {
      if (game.phase !== 'mulligan') return game
      const pending = Math.min(cardsToBottom(game), game.zones.hand.length)
      return pending > 0 ? { ...game, phase: 'bottom', bottomPending: pending } : beginTurnOne(game)
    }
    case 'bottom': {
      if (game.phase !== 'bottom' || !game.zones.hand.includes(action.id)) return game
      const placed: PlaytestGame = {
        ...game,
        bottomPending: game.bottomPending - 1,
        zones: {
          ...game.zones,
          hand: game.zones.hand.filter((id) => id !== action.id),
          library: [...game.zones.library, action.id],
        },
      }
      return placed.bottomPending > 0 ? placed : beginTurnOne(placed)
    }
    case 'draw': {
      if (game.phase !== 'playing') return game
      return drawCards(game, 1)
    }
    case 'nextTurn': {
      if (game.phase !== 'playing') return game
      return drawCards({ ...game, turn: game.turn + 1, tapped: [] }, 1)
    }
    case 'untapAll': {
      return { ...game, tapped: [] }
    }
    case 'toggleTap': {
      if (!game.zones.battlefield.includes(action.id)) return game
      const tapped = game.tapped.includes(action.id)
        ? game.tapped.filter((id) => id !== action.id)
        : [...game.tapped, action.id]
      return { ...game, tapped }
    }
    case 'move': {
      if (game.phase !== 'playing') return game
      const from = zoneOf(game, action.id)
      if (!from) return game
      const zones = { ...game.zones, [from]: game.zones[from].filter((id) => id !== action.id) }
      // Par défaut, une carte rendue à la bibliothèque va dessus, les autres
      // zones empilent à la fin.
      const position = action.position ?? (action.to === 'library' ? 'top' : 'bottom')
      const target = zones[action.to]
      zones[action.to] = position === 'top' ? [action.id, ...target] : [...target, action.id]
      // Une carte qui quitte le champ de bataille se redresse.
      const tapped = action.to === 'battlefield' ? game.tapped : game.tapped.filter((id) => id !== action.id)
      return { ...game, zones, tapped }
    }
    case 'shuffle': {
      return { ...game, zones: { ...game.zones, library: shuffle(game.zones.library, rng) } }
    }
  }
}

export function isLandCard(card: PlaytestCard): boolean {
  return /\bland\b/i.test(card.typeLine)
}

export const PLAYTEST_STORAGE_KEY = 'spellcache.playtest'

// Le contenu de `sessionStorage` est une entrée externe comme une autre
// (docs/development.md) : une entrée périmée ou trafiquée rend une partie
// neuve, jamais un écran qui plante.
const zoneIds = z.array(z.string())

const playtestGameSchema = z
  .object({
    deckId: z.string(),
    onThePlay: z.boolean(),
    phase: z.enum(['mulligan', 'bottom', 'playing']),
    turn: z.number().int().nonnegative(),
    mulligans: z.number().int().nonnegative(),
    bottomPending: z.number().int().nonnegative(),
    instances: z.record(z.string(), z.string()),
    zones: z.object({
      library: zoneIds,
      hand: zoneIds,
      battlefield: zoneIds,
      graveyard: zoneIds,
      exile: zoneIds,
      command: zoneIds,
    }),
    tapped: zoneIds,
  })
  .refine(
    (game) => {
      // Chaque instance dans exactement une zone.
      const placed = PLAYTEST_ZONES.flatMap((zone) => game.zones[zone])
      const known = Object.keys(game.instances)
      return placed.length === known.length && new Set(placed).size === placed.length && placed.every((id) => id in game.instances)
    },
    { message: 'every instance must sit in exactly one zone' },
  )
  .refine((game) => game.tapped.every((id) => game.zones.battlefield.includes(id)), {
    message: 'only battlefield cards can be tapped',
  })

// Reprend la partie de ce deck seulement, et seulement si toutes ses cartes
// existent encore dans la liste : un deck modifié entre-temps repart à zéro.
export function loadPlaytestGame(deck: PlaytestDeck): PlaytestGame | null {
  if (typeof window === 'undefined') return null

  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(PLAYTEST_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = playtestGameSchema.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success || parsed.data.deckId !== deck.id) return null
    const stale = Object.values(parsed.data.instances).some((cardId) => !(cardId in deck.cards))
    return stale ? null : parsed.data
  } catch {
    return null
  }
}

export function savePlaytestGame(game: PlaytestGame | null): void {
  if (typeof window === 'undefined') return
  try {
    if (game) window.sessionStorage.setItem(PLAYTEST_STORAGE_KEY, JSON.stringify(game))
    else window.sessionStorage.removeItem(PLAYTEST_STORAGE_KEY)
  } catch {
    // Une écriture refusée ne doit pas interrompre la partie.
  }
}
