// Calcul de légalité et de statut de deck. `evaluateDeck` est pure — aucun
// accès base, sinon les tests de règles deviennent des tests d'intégration.
// La légalité vient de deux sources combinées : `cards.legalities` (bannissements
// Scryfall, lu par l'appelant et passé en entrée) et les règles
// structurelles ci-dessous (taille, singleton, limite d'exemplaires,
// commandant) — s'appuyer sur la seule première laisserait passer un
// Commander de 40 cartes.
import type { DeckState, Legality } from '@spellcache/db/schema'

export type DeckFormat =
  | 'commander'
  | 'modern'
  | 'standard'
  | 'pioneer'
  | 'legacy'
  | 'vintage'
  | 'pauper'

export interface DeckRule {
  size: number
  // `size` est un plancher (`'min'`) pour les six formats construits à 60
  // cartes et une taille exacte (`'exact'`) pour Commander : un deck de tournoi
  // à 60 cartes en compte au moins 60, jamais
  // pile 60 — un 61e carte reste un deck parfaitement légal. L'issue `over`
  // ne se déclenche que pour `'exact'` ; un format `'min'` ne remonte jamais
  // `over`, seulement `short` tant que le total est sous le seuil.
  sizeMode: 'min' | 'exact'
  singleton: boolean
  maxCopies: number
  needsCommander: boolean
}

// Les six formats non-Commander partagent la même règle structurelle (60
// cartes minimum, 4 exemplaires maximum, pas de commandant) — `pauper` s'y
// limite aussi : sa restriction « communes uniquement » est déjà portée par
// `cards.legalities.pauper` (Scryfall, seconde source ci-dessus), pas une
// règle structurelle distincte (la table des règles couvre commander,
// modern, standard, pioneer, legacy, vintage, pauper).
const SIXTY_CARD_RULE: DeckRule = { size: 60, sizeMode: 'min', singleton: false, maxCopies: 4, needsCommander: false }

export const FORMAT_RULES: Record<DeckFormat, DeckRule> = {
  commander: { size: 100, sizeMode: 'exact', singleton: true, maxCopies: 1, needsCommander: true },
  modern: SIXTY_CARD_RULE,
  standard: SIXTY_CARD_RULE,
  pioneer: SIXTY_CARD_RULE,
  legacy: SIXTY_CARD_RULE,
  vintage: SIXTY_CARD_RULE,
  pauper: SIXTY_CARD_RULE,
}

export const FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: 'Commander',
  modern: 'Modern',
  standard: 'Standard',
  pioneer: 'Pioneer',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
}

export function isDeckFormat(value: string): value is DeckFormat {
  return Object.prototype.hasOwnProperty.call(FORMAT_RULES, value)
}

export type LegalityIssueKind =
  | 'short'
  | 'over'
  | 'duplicates'
  | 'banned'
  | 'not_legal'
  | 'colour_identity'
  | 'no_commander'

export interface LegalityIssue {
  kind: LegalityIssueKind
  count: number
  cardNames?: string[]
}

export interface DeckStatus {
  // `noRules` (demande produit, 2026-09-01) : un format est posé mais
  // l'app n'a de règles QUE pour Commander — les autres formats sont un
  // simple libellé, sans zone commandant, sans contrôle de légalité, sans
  // puce de statut. Ils ne comptent ni sous `Legal` ni sous
  // `Needs attention` : seulement sous `All`.
  kind: 'built' | 'legal' | 'needsWork' | 'noFormat' | 'noRules'
  label: string // "Legal for Commander" | "36 short · 2 duplicates" | "No format set"
  issues: LegalityIssue[]
}

export interface DeckEvaluationCard {
  cardId: string
  name: string
  qty: number
  legalities: Record<string, Legality>
  colorIdentity: string[]
  typeLine: string
}

export interface EvaluateDeckInput {
  format: DeckFormat | null
  deckState: DeckState
  cards: DeckEvaluationCard[]
  commander?: { colorIdentity: string[] } | null
}

// Terrain de base : échappe à la règle singleton et à la limite
// d'exemplaires dans tous les formats. Le
// catalogue porte ce sous-type dans `type_line` (« Basic Land — Plains »,
// jamais un simple « Land ») — vérifié par préfixe, pas par une liste de noms
// codée en dur (un nouveau nom de terrain de base ne doit jamais échapper à
// la règle).
function isBasicLand(typeLine: string): boolean {
  return typeLine.startsWith('Basic Land')
}

// Sous-ensemble d'identité colorée : chaque couleur de la carte doit
// appartenir à l'identité du commandant.
// `?? []` sur les deux entrées : un `CardSearchItem` lu depuis une
// entrée Redis figée avant l'ajout de `colorIdentity` porte
// `colorIdentity: undefined` malgré son type — `undefined.every(...)`
// lèverait un `TypeError` client à la création d'un deck Commander.
// `lib/search/normalize.ts` bumpe la version de clé de cache pour que ce cas
// ne se reproduise pas, cette garde reste une seconde ligne de défense,
// jamais la seule.
function colorIdentitySubset(cardIdentity: string[] | undefined, commanderIdentity: string[] | undefined): boolean {
  const commander = commanderIdentity ?? []
  return (cardIdentity ?? []).every((color) => commander.includes(color))
}

function labelForFormat(format: DeckFormat): string {
  return `Legal for ${FORMAT_LABELS[format]}`
}

// Libellé d'un problème isolé — un deck `deckState = 'built'` lit sa pénurie
// en « cards missing » plutôt qu'en « short » : « short » décrit une liste
// encore incomplète (étape de plan), « missing » des cartes qui devraient
// déjà être physiquement là. Les autres types de problème gardent le même
// libellé quel que soit `deckState` — aucun autre ne justifie de distinction.
function issueLabel(issue: LegalityIssue, built: boolean): string {
  switch (issue.kind) {
    case 'short':
      return built ? `${issue.count} cards missing` : `${issue.count} short`
    case 'over':
      return `${issue.count} over`
    case 'duplicates':
      return `${issue.count} duplicates`
    case 'banned':
      return `${issue.count} banned`
    case 'not_legal':
      return `${issue.count} not legal`
    case 'colour_identity':
      return `${issue.count} off-colour`
    case 'no_commander':
      return 'No commander'
  }
}

// Compose le libellé d'un statut `needsWork` :
// une partie par type de problème réellement rencontré, dans l'ordre où ils
// sont détectés ci-dessous, jointes par ` · ` — jamais une partie à 0 (« 36
// short · 2 duplicates », pas « 36 short · 0 duplicates »).
function buildIssuesLabel(issues: LegalityIssue[], built: boolean): string {
  return issues.map((issue) => issueLabel(issue, built)).join(' · ')
}

interface CardTotal {
  name: string
  qty: number
  typeLine: string
  colorIdentity: string[]
  legalities: Record<string, Legality>
}

// Regroupe les holdings par carte : une même
// carte peut être détenue en plusieurs lignes (finish/condition/langue
// distincts) sans que cela change son identité pour la règle
// singleton/copies — deux exemplaires foil + non-foil de la même carte
// restent deux exemplaires de la même carte, pas deux cartes différentes.
function groupByCard(cards: DeckEvaluationCard[]): { totals: Map<string, CardTotal>; totalQty: number } {
  const totals = new Map<string, CardTotal>()
  let totalQty = 0
  for (const card of cards) {
    totalQty += card.qty
    const existing = totals.get(card.cardId)
    if (existing) {
      existing.qty += card.qty
    } else {
      totals.set(card.cardId, {
        name: card.name,
        qty: card.qty,
        typeLine: card.typeLine,
        colorIdentity: card.colorIdentity,
        legalities: card.legalities,
      })
    }
  }
  return { totals, totalQty }
}

export function evaluateDeck(input: EvaluateDeckInput): DeckStatus {
  if (!input.format) {
    return { kind: 'noFormat', label: 'No format set', issues: [] }
  }

  // Seul Commander porte des règles aujourd'hui (demande produit) : tout
  // autre format est un libellé sans contrôle — rien à vérifier, rien à
  // signaler. La table `FORMAT_RULES` garde les règles des formats à 60
  // cartes pour le jour où ils seront réactivés.
  if (input.format !== 'commander') {
    return { kind: 'noRules', label: FORMAT_LABELS[input.format], issues: [] }
  }

  const format = input.format
  const rule = FORMAT_RULES[format]
  const issues: LegalityIssue[] = []
  const { totals, totalQty } = groupByCard(input.cards)

  // Taille : short si
  // en dessous du seuil, jamais les deux à la fois pour un même deck. `over`
  // ne se déclenche qu'en taille exacte (Commander) — un format à plancher
  // (les six formats à 60 cartes) reste `short` ou légal, jamais `over` : un
  // 61e carte au-delà du minimum est un deck de tournoi parfaitement jouable.
  if (totalQty < rule.size) {
    issues.push({ kind: 'short', count: rule.size - totalQty })
  } else if (rule.sizeMode === 'exact' && totalQty > rule.size) {
    issues.push({ kind: 'over', count: totalQty - rule.size })
  }

  // Exemplaires/singleton : les terrains de base échappent à la règle dans
  // tous les formats (les compter ferait signaler tout deck).
  const duplicateNames: string[] = []
  for (const card of totals.values()) {
    if (isBasicLand(card.typeLine)) continue
    const maxCopies = rule.singleton ? 1 : rule.maxCopies
    if (card.qty > maxCopies) duplicateNames.push(card.name)
  }
  if (duplicateNames.length > 0) {
    issues.push({ kind: 'duplicates', count: duplicateNames.length, cardNames: duplicateNames })
  }

  // Bannissements / illégalité Scryfall (la seconde
  // source, combinée à la première ci-dessus — jamais l'une sans l'autre).
  // `restricted` (Vintage) n'est pas traité comme un problème structurel
  // distinct ici : aucun cas d'usage ne le couvre, et le
  // traiter comme une limite de copie à 1 par carte dépasserait la portée
  // documentée de cette feature.
  const bannedNames: string[] = []
  const notLegalNames: string[] = []
  for (const card of totals.values()) {
    const legality = card.legalities[format]
    if (legality === 'banned') bannedNames.push(card.name)
    else if (legality === 'not_legal') notLegalNames.push(card.name)
  }
  if (bannedNames.length > 0) issues.push({ kind: 'banned', count: bannedNames.length, cardNames: bannedNames })
  if (notLegalNames.length > 0) {
    issues.push({ kind: 'not_legal', count: notLegalNames.length, cardNames: notLegalNames })
  }

  // Commandant et identité colorée : l'identité colorée d'un deck Commander
  // est celle du commandant, pas l'union des cartes — les inverser rendrait
  // ce contrôle inopérant.
  if (rule.needsCommander) {
    if (!input.commander) {
      issues.push({ kind: 'no_commander', count: 1 })
    } else {
      const commanderIdentity = input.commander.colorIdentity
      const offColour: string[] = []
      for (const card of totals.values()) {
        if (!colorIdentitySubset(card.colorIdentity, commanderIdentity)) offColour.push(card.name)
      }
      if (offColour.length > 0) {
        issues.push({ kind: 'colour_identity', count: offColour.length, cardNames: offColour })
      }
    }
  }

  const built = input.deckState === 'built'

  if (issues.length === 0) {
    // `built` est un `kind` distinct de `legal` (sa puce prend la variante
    // correspondante) mais partage le même libellé — le design validé montre
    // un deck `built` et légal affichant encore « Legal for Modern »
    // (« Mono-red burn », `deck_state = 'built'`).
    return { kind: built ? 'built' : 'legal', label: labelForFormat(format), issues: [] }
  }

  return { kind: 'needsWork', label: buildIssuesLabel(issues, built), issues }
}
