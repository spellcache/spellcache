// Identité colorée d'un deck et dégradé associé (écran `Deck lists`). Pure —
// aucun accès base, même contrainte que `lib/decks/legality.ts`
// (`evaluateDeck` doit rester pure et testable).
import { type GradientKey } from '@/lib/binders/gradients'

// Ordre canonique WUBRG — les pastilles de mana s'affichent toujours dans cet
// ordre, jamais celui d'apparition dans les holdings.
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const

function normalizeColors(colors: string[]): string[] {
  const present = new Set(colors)
  return COLOR_ORDER.filter((color) => present.has(color))
}

// L'identité colorée d'un deck Commander est celle du commandant, jamais
// l'union des cartes (les inverser rendrait le contrôle d'identité
// inopérant — cette même règle s'applique à l'identité affichée, pas seulement
// au contrôle de légalité de `evaluateDeck`). Sans commandant, l'identité
// retombe sur l'union des cartes détenues — le seul signal disponible pour un
// deck qui n'a pas (encore) de commandant choisi. `?? []` sur le commandant et
// sur chaque identité de carte : un `CardSearchItem` du picker de commandant
// (`app/(app)/decks/decks-view.tsx`) issu d'une entrée Redis figée avant
// l'ajout de `colorIdentity` porte `colorIdentity: undefined` malgré son type
// déclaré — `for (const color of identity)` levait un `TypeError` sur
// `undefined` avant que `normalizeColors` ne soit même atteint.
// `lib/search/normalize.ts` bumpe désormais la version de clé de cache pour que
// ce cas ne se reproduise plus ; cette garde reste une seconde ligne de
// défense.
export function deckColorIdentity(input: {
  commanderColorIdentity: string[] | null | undefined
  cardColorIdentities: Array<string[] | undefined>
}): string[] {
  if (input.commanderColorIdentity) {
    return normalizeColors(input.commanderColorIdentity)
  }

  const union = new Set<string>()
  for (const identity of input.cardColorIdentities) {
    for (const color of identity ?? []) union.add(color)
  }
  return normalizeColors([...union])
}

// Dégradé de repli d'une ligne de deck sans commandant : dégradé d'identité
// colorée, valeur du design validé (« Mono-red burn », identité
// mono-rouge → dégradé `red`, `linear-gradient(100deg,
// rgba(208,90,68,0.34) 0%, rgba(122,63,47,0.16) 46%, #12151c 100%)` —
// exactement `binderRowBackground('red', 1)`, `lib/binders/gradients.ts`).
// Le design ne montre qu'un seul cas (mono-couleur) : la correspondance
// couleur → dégradé au-delà de ce cas (multicolore, incolore) suit la
// palette de couleur usuelle de Magic plutôt que d'inventer une septième
// teinte — `gold` reste la lecture standard d'un deck multicolore, comme sur
// n'importe quel symbole d'identité multicolore du jeu.
export function gradientKeyForIdentity(identity: string[]): GradientKey {
  if (identity.length === 0) return 'grey'
  if (identity.length > 1) return 'gold'

  switch (identity[0]) {
    case 'W':
      return 'gold'
    case 'U':
      return 'blue'
    case 'B':
      return 'purple'
    case 'R':
      return 'red'
    case 'G':
      return 'green'
    default:
      return 'grey'
  }
}
