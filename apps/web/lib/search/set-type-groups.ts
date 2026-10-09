// Regroupement des `set_type` Scryfall en cinq familles lisibles (demande
// produit, 2026-09-01) — le filtre « Set · Type » des onglets Cards et Sets.
// Une carte/un set appartient à exactement UNE famille, par ordre de
// préséance : Tokens > Art Series > Promos > Release > Others — un token
// d'un set promo est un token, pas une promo.
//
// Partagé client/serveur : les puces des deux feuilles de filtres, le
// classement client de l'onglet Sets et la condition SQL de la recherche
// lisent tous cette table — jamais une seconde copie de la taxonomie.

export type SetTypeGroup = 'release' | 'promos' | 'art_series' | 'tokens' | 'others'

export const SET_TYPE_GROUPS: Array<{ value: SetTypeGroup; label: string }> = [
  { value: 'release', label: 'Release' },
  { value: 'promos', label: 'Promos' },
  { value: 'art_series', label: 'Art Series' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'others', label: 'Others' },
]

// Sélection par défaut (demande produit) : les vraies sorties et les
// tokens ; promos, Art Series et le reste sont masqués tant qu'on ne les
// demande pas. Une sélection VIDE, elle, ne filtre rien — même sémantique
// que les puces de type de carte.
export const DEFAULT_SET_TYPE_GROUPS: SetTypeGroup[] = ['release', 'tokens']

// Les `set_type` Scryfall qui comptent comme une vraie sortie. Tout type
// inconnu (ou NULL, avant backfill) tombe dans `others` — jamais une carte
// perdue silencieusement dans une famille filtrée par défaut.
export const RELEASE_SET_TYPES = [
  'expansion',
  'core',
  'masters',
  'commander',
  'box',
  'duel_deck',
  'funny',
  'masterpiece',
  'draft_innovation',
  'alchemy',
  'starter',
  'from_the_vault',
  'eternal',
  'planechase',
  'archenemy',
  'spellbook',
  'premium_deck',
  'arsenal',
] as const

// Couches de carte qui font d'une impression un token, où que vive son set.
export const TOKEN_CARD_LAYOUTS = ['token', 'double_faced_token', 'emblem'] as const

export function isArtSeriesSetName(name: string): boolean {
  return / Art Series$/.test(name)
}

// Famille d'un SET (onglet Sets, classement côté client).
export function setGroupOf(set: { setType: string | null; name: string }): SetTypeGroup {
  if (set.setType === 'token') return 'tokens'
  if (isArtSeriesSetName(set.name)) return 'art_series'
  if (set.setType === 'promo') return 'promos'
  if (set.setType !== null && (RELEASE_SET_TYPES as readonly string[]).includes(set.setType)) {
    return 'release'
  }
  return 'others'
}

export function isDefaultSetTypeSelection(selection: SetTypeGroup[]): boolean {
  if (selection.length !== DEFAULT_SET_TYPE_GROUPS.length) return false
  return DEFAULT_SET_TYPE_GROUPS.every((group) => selection.includes(group))
}
