// État du compteur de vie : le réducteur, le tirage du premier joueur et la
// seule entrée `localStorage` que le projet s'autorise.
//
// `lifeGame` est l'unique exception à « les préférences appartiennent au
// compte » (docs/development.md) : ce fichier est donc le seul de `app/`,
// `components/` et `lib/` à nommer `localStorage`, et la configuration d'un
// autre outil n'a rien à y faire.
//
// Le générateur aléatoire est un **paramètre** de `lifeReducer`, pas un
// appel à `Math.random()` enfoui dans un composant : c'est ce qui rend
// l'équité du tirage — 10 000 tirages, écart inférieur à 2 % — vérifiable.
import { z } from 'zod'

export interface LifeSetup {
  players: 2 | 3 | 4 | 5 | 6
  startingLife: number
  rollForFirst: boolean
  keepAwake: boolean
}

export interface LifeGame {
  setup: LifeSetup
  life: number[] // une entrée par joueur
  firstPlayer: number | null // index du siège tiré
  startedAt: number
}

export type LifeAction =
  | { type: 'adjust'; seat: number; delta: number }
  | { type: 'reset' }
  | { type: 'roll' }
  | { type: 'end' }

export interface LifeState {
  setup: LifeSetup
  game: LifeGame | null
}

// Nombres de joueurs proposés par l'écran de setup (cinq pastilles, 2 à 6)
// — une seule source pour les pastilles, le
// schéma Zod et le type.
export const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const

// Vies de départ proposées, dans l'ordre du design validé (`20`, `40`, `30`).
export const STARTING_LIFE_PRESETS = [20, 40, 30] as const

// Configuration présélectionnée du design validé (4 joueurs, 40 points, les
// deux interrupteurs actifs) — l'écran de setup ne part de là qu'à la
// première visite, `loadLifeState()` reprend ensuite la dernière.
export const DEFAULT_LIFE_SETUP: LifeSetup = {
  players: 4,
  startingLife: 40,
  rollForFirst: true,
  keepAwake: true,
}

// Teintes de siège = palette des pips, dans l'ordre [U,R,G,W,B,C] : « Player
// colours come from the pip palette, so no new colours enter the system »
// (note de design du compteur de vie), au pixel des jetons `--color-pip-*-bg`
// déjà posés pour `ManaPips`/`ManaCost` plutôt qu'une seconde palette
// `--color-seat-*` qui porterait les mêmes six teintes sous d'autres noms. Des
// noms de tokens (`app/globals.css`), jamais des valeurs littérales : ce
// fichier n'est pas l'un des deux autorisés à en porter (docs/development.md).
export const SEAT_TINTS = [
  'var(--color-pip-u-bg)',
  'var(--color-pip-r-bg)',
  'var(--color-pip-g-bg)',
  'var(--color-pip-w-bg)',
  'var(--color-pip-b-bg)',
  'var(--color-pip-c-bg)',
] as const

export function seatTint(seat: number): string {
  return SEAT_TINTS[seat % SEAT_TINTS.length]!
}

// Libellés de siège de la surbrillance bloquante — indexés par siège, pas par position dans la
// grille : le repli générique couvre un septième joueur hypothétique que
// `PLAYER_COUNTS` n'offre pas aujourd'hui, sans borner ce tableau à six.
const SEAT_NAMES = [
  'Bottom-left seat',
  'Bottom-right seat',
  'Top-left seat',
  'Top-right seat',
  'Left seat',
  'Right seat',
] as const

export function seatName(seat: number): string {
  return SEAT_NAMES[seat] ?? `Seat ${seat + 1}`
}

// Orientation de la grille (la grille suit le nombre de joueurs, les pavés du
// haut sont retournés) : `players <= 2 ? 1 :
// ceil(n/2)` sièges retournés, soit 2 pavés retournés sur 3 à trois joueurs.
// La rangée du haut (retournée, vers les joueurs d'en face) porte ce compte
// de sièges, la rangée basse le reste — 2/2 à quatre joueurs, 2/1 (et non
// 1/2) à trois.
export function seatRows(players: number): { top: number[]; bottom: number[] } {
  const topCount = players <= 2 ? 1 : Math.ceil(players / 2)
  const seats = Array.from({ length: players }, (_, index) => index)
  return { top: seats.slice(0, topCount), bottom: seats.slice(topCount) }
}

// Un siège dans `[0, players)`. `Math.min` borne le cas où le générateur
// injecté renvoie exactement 1 (`Math.random()` ne le fait jamais, un
// générateur de test le peut).
function rollSeat(players: number, rng: () => number): number {
  return Math.min(players - 1, Math.floor(rng() * players))
}

export function lifeReducer(state: LifeGame, action: LifeAction, rng: () => number = Math.random): LifeGame {
  switch (action.type) {
    case 'adjust': {
      // Un index hors de la grille ne doit pas allonger `life` : la partie
      // survit à un rechargement, donc à un état
      // relu dont le nombre de joueurs a changé entre-temps.
      if (action.seat < 0 || action.seat >= state.life.length) return state
      const life = state.life.map((value, seat) => (seat === action.seat ? value + action.delta : value))
      return { ...state, life }
    }
    case 'reset': {
      // `Reset` ne tire jamais le premier joueur : seul `Start game` (via `startLifeGame`) et le
      // bouton `Roll` dédié (action `roll` ci-dessous) déclenchent un
      // tirage. Rejouer une partie sans relancer le tirage efface donc le
      // siège d'un tirage antérieur plutôt que d'en refaire un.
      return {
        ...state,
        life: Array.from({ length: state.setup.players }, () => state.setup.startingLife),
        firstPlayer: null,
      }
    }
    case 'roll': {
      // Le dé central tire toujours, quel que soit `rollForFirst`.
      return { ...state, firstPlayer: rollSeat(state.setup.players, rng) }
    }
    case 'end': {
      // `LifeGame` ne porte aucun champ « terminée » et le contrat renvoie
      // un `LifeGame`, jamais `null` : quitter une partie, c'est l'écran qui
      // cesse de la tenir (`saveLifeState({ setup, game: null })`), pas le
      // réducteur qui muterait un instantané. L'action reste dans l'union
      // pour que le bouton de sortie passe par le même canal que les
      // autres ; l'instantané, lui, est rendu inchangé.
      return state
    }
  }
}

// Nouvelle partie depuis une configuration (`Start game` seul suffit à
// relancer une partie identique). Le tirage
// passe par `lifeReducer` plutôt que par un second `Math.floor(rng() * n)`
// recopié ici.
export function startLifeGame(
  setup: LifeSetup,
  rng: () => number = Math.random,
  now: number = Date.now(),
): LifeGame {
  const fresh: LifeGame = {
    setup,
    life: Array.from({ length: setup.players }, () => setup.startingLife),
    firstPlayer: null,
    startedAt: now,
  }
  return setup.rollForFirst ? lifeReducer(fresh, { type: 'roll' }, rng) : fresh
}

// Champ `Other` de l'écran de setup (accepte un entier positif) — validé,
// jamais casté (docs/development.md).
export function parseStartingLife(raw: string): number | null {
  const parsed = z.coerce.number().int().positive().safeParse(raw.trim())
  return parsed.success ? parsed.data : null
}

export const LIFE_STORAGE_KEY = 'spellcache.lifeGame'

// Le contenu de `localStorage` est une entrée externe comme une autre
// (docs/development.md) : une entrée périmée, tronquée ou trafiquée doit rendre
// l'écran de setup neuf, jamais faire planter la partie.
const lifeSetupSchema = z.object({
  players: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  startingLife: z.number().int().positive(),
  rollForFirst: z.boolean(),
  keepAwake: z.boolean(),
})

const lifeGameSchema = z
  .object({
    setup: lifeSetupSchema,
    life: z.array(z.number().int()),
    firstPlayer: z.number().int().nonnegative().nullable(),
    startedAt: z.number().int(),
  })
  .refine((game) => game.life.length === game.setup.players, {
    message: 'life must hold one entry per player',
  })
  .refine((game) => game.firstPlayer === null || game.firstPlayer < game.setup.players, {
    message: 'firstPlayer must be a seat of this game',
  })

const lifeStateSchema = z.object({
  setup: lifeSetupSchema,
  game: lifeGameSchema.nullable(),
})

export function loadLifeState(): LifeState | null {
  if (typeof window === 'undefined') return null

  let raw: string | null
  try {
    raw = window.localStorage.getItem(LIFE_STORAGE_KEY)
  } catch {
    // Stockage indisponible (mode privé strict, quota, iframe cloisonnée) —
    // la partie doit démarrer quand même, seule la reprise se perd.
    return null
  }
  if (!raw) return null

  try {
    const parsed = lifeStateSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveLifeState(state: LifeState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Idem : une écriture refusée ne doit pas interrompre la partie.
  }
}
