// Playtest — état d'une partie d'essai en solo : bibliothèque mélangée, main de
// départ, mulligan « London » (on repioche sept cartes, puis on en remet
// autant au fond que de mulligans pris), puis les premiers tours (pioche,
// cartes posées sur le champ de bataille).
//
// Pur : aucun accès base ni `window`. Le hasard est injecté (`random`) pour
// que les tests rejouent un mélange déterministe ; l'écran passe
// `cryptoRandom`. Rien n'est persisté — ni sur le compte ni dans
// `localStorage` (docs/development.md) : recharger la page redonne une
// nouvelle main, ce qui est exactement ce qu'on attend d'un test de deck.

export const HAND_SIZE = 7

// Un exemplaire physique : un holding `qty: 4` devient quatre cartes
// distinctes, chacune avec son `id` (`<holdingId>:<n>`), sinon on ne
// saurait pas laquelle des quatre on remet au fond.
export interface PlaytestCard {
  id: string
  cardId: string
  name: string
  thumbUrl: string
}

export interface PlaytestDeck {
  // Mainboard seul : le côté n'entre jamais dans la bibliothèque, le ou les
  // commandants restent dans la zone de commandement.
  cards: PlaytestCard[]
  commanders: PlaytestCard[]
  // Règle Commander : le premier mulligan est gratuit (aucune carte remise
  // au fond pour lui).
  freeFirstMulligan: boolean
}

export type PlaytestPhase = 'mulligan' | 'bottom' | 'playing'

export interface PlaytestState {
  deck: PlaytestDeck
  // Index 0 = dessus de la bibliothèque.
  library: PlaytestCard[]
  hand: PlaytestCard[]
  battlefield: PlaytestCard[]
  mulligans: number
  phase: PlaytestPhase
  // Cartes choisies pour le fond pendant la phase `bottom`, dans l'ordre du
  // choix (la première choisie part la première au fond).
  toBottom: string[]
  // `0` tant que la main n'est pas gardée.
  turn: number
  // Le joueur qui commence ne pioche pas à son premier tour.
  onThePlay: boolean
}

export type PlaytestAction =
  | { type: 'mulligan' }
  | { type: 'keep' }
  | { type: 'toggleBottom'; id: string }
  | { type: 'confirmBottom' }
  | { type: 'setOnThePlay'; onThePlay: boolean }
  | { type: 'draw' }
  | { type: 'nextTurn' }
  | { type: 'play'; id: string }
  | { type: 'unplay'; id: string }

export type Random = () => number

// Fisher-Yates, sur une copie : l'entrée n'est jamais mutée.
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Hasard de l'écran : `crypto.getRandomValues` plutôt que `Math.random`, dont
// la qualité n'est pas garantie par la spécification.
export function cryptoRandom(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 2 ** 32
}

// Nombre de cartes à remettre au fond pour la main gardée.
export function cardsToBottom(state: Pick<PlaytestState, 'mulligans' | 'deck'>): number {
  const free = state.deck.freeFirstMulligan && state.mulligans > 0 ? 1 : 0
  return Math.min(HAND_SIZE, Math.max(0, state.mulligans - free))
}

function deal(
  deck: PlaytestDeck,
  random: Random,
): Pick<PlaytestState, 'library' | 'hand'> {
  const library = shuffle(deck.cards, random)
  return { hand: library.slice(0, HAND_SIZE), library: library.slice(HAND_SIZE) }
}

export function startPlaytest(
  deck: PlaytestDeck,
  random: Random,
  onThePlay = true,
): PlaytestState {
  return {
    deck,
    ...deal(deck, random),
    battlefield: [],
    mulligans: 0,
    phase: 'mulligan',
    toBottom: [],
    turn: 0,
    onThePlay,
  }
}

function drawOne(state: PlaytestState): PlaytestState {
  const [top, ...rest] = state.library
  if (!top) return state
  return { ...state, library: rest, hand: [...state.hand, top] }
}

function beginTurnOne(state: PlaytestState): PlaytestState {
  const started = { ...state, phase: 'playing' as const, toBottom: [], turn: 1 }
  return state.onThePlay ? started : drawOne(started)
}

export function playtestReducer(
  state: PlaytestState,
  action: PlaytestAction,
  random: Random,
): PlaytestState {
  switch (action.type) {
    case 'mulligan': {
      if (state.phase !== 'mulligan') return state
      // Au-delà, la main gardée serait vide après le fond : plus rien à
      // tester.
      if (cardsToBottom({ ...state, mulligans: state.mulligans + 1 }) >= HAND_SIZE)
        return state
      return { ...state, ...deal(state.deck, random), mulligans: state.mulligans + 1 }
    }
    case 'keep': {
      if (state.phase !== 'mulligan') return state
      return cardsToBottom(state) === 0
        ? beginTurnOne(state)
        : { ...state, phase: 'bottom', toBottom: [] }
    }
    case 'toggleBottom': {
      if (state.phase !== 'bottom') return state
      if (!state.hand.some((card) => card.id === action.id)) return state
      if (state.toBottom.includes(action.id)) {
        return { ...state, toBottom: state.toBottom.filter((id) => id !== action.id) }
      }
      if (state.toBottom.length >= cardsToBottom(state)) return state
      return { ...state, toBottom: [...state.toBottom, action.id] }
    }
    case 'confirmBottom': {
      if (state.phase !== 'bottom' || state.toBottom.length !== cardsToBottom(state))
        return state
      const bottom = state.toBottom.map((id) =>
        state.hand.find((card) => card.id === id)!,
      )
      const hand = state.hand.filter((card) => !state.toBottom.includes(card.id))
      return beginTurnOne({ ...state, hand, library: [...state.library, ...bottom] })
    }
    case 'setOnThePlay': {
      // Se décide avant de garder sa main, jamais en cours de partie.
      if (state.phase === 'playing') return state
      return { ...state, onThePlay: action.onThePlay }
    }
    case 'draw': {
      if (state.phase !== 'playing') return state
      return drawOne(state)
    }
    case 'nextTurn': {
      if (state.phase !== 'playing') return state
      return drawOne({ ...state, turn: state.turn + 1 })
    }
    case 'play': {
      if (state.phase !== 'playing') return state
      const card = state.hand.find((c) => c.id === action.id)
      if (!card) return state
      return {
        ...state,
        hand: state.hand.filter((c) => c.id !== action.id),
        battlefield: [...state.battlefield, card],
      }
    }
    case 'unplay': {
      if (state.phase !== 'playing') return state
      const card = state.battlefield.find((c) => c.id === action.id)
      if (!card) return state
      return {
        ...state,
        battlefield: state.battlefield.filter((c) => c.id !== action.id),
        hand: [...state.hand, card],
      }
    }
  }
}
