// Sérialisation URL ⇄ `ViewState` : `query`, `filters`, `sort`, `groupBy` et
// `density` vivent dans les search params de l'écran de container — jamais
// dans `localStorage` (docs/development.md, seul `lifeGame` y échappe) — pour
// qu'un lien partagé rouvre exactement la même vue. Toute entrée externe
// passe par ce module (docs/development.md « toute entrée externe... validée
// par Zod à la frontière ») : `parseViewState` ne lève jamais, une valeur
// corrompue retombe silencieusement sur son défaut.
import { z } from 'zod'

import type { Condition, Finish } from '@spellcache/db/schema'
import { formatMoney, type Currency } from '@/lib/format/money'

export type SortKey = 'name' | 'price' | 'cmc' | 'rarity' | 'set' | 'added' | 'qty'
export type SortDir = 'high' | 'low'
export type GroupKey = 'set' | 'type' | 'colour' | 'rarity' | 'binder' | 'none'
export type Density = 'rows' | 'compact' | 'grid'
export type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
export type ColorMatch = 'including' | 'exactly' | 'atMost'

export interface HoldingFilters {
  colors: Color[]
  colorMatch: ColorMatch
  multicolourOnly: boolean
  monoOnly: boolean
  types: string[]
  rarities: string[]
  finishes: Finish[]
  conditions: Condition[]
  setCode: string | null
  binderId: string | null
  priceMinMinor: number | null
  priceMaxMinor: number | null
}

export interface ViewState {
  query: string
  filters: HoldingFilters
  sort: { key: SortKey; dir: SortDir }
  groupBy: GroupKey | null
  density: Density | null
}

export const EMPTY_FILTERS: HoldingFilters = {
  colors: [],
  colorMatch: 'including',
  multicolourOnly: false,
  monoOnly: false,
  types: [],
  rarities: [],
  finishes: [],
  conditions: [],
  setCode: null,
  binderId: null,
  priceMinMinor: null,
  priceMaxMinor: null,
}

// Tri par défaut de l'écran de container (historiquement « toujours triée
// par nom ») — le nom croissant se range du côté `low` du segmenté
// `High | Low`, pas d'un troisième état séparé.
const DEFAULT_SORT: ViewState['sort'] = { key: 'name', dir: 'low' }

const SORT_KEYS = ['name', 'price', 'cmc', 'rarity', 'set', 'added', 'qty'] as const
const SORT_DIRS = ['high', 'low'] as const
const GROUP_KEYS = ['set', 'type', 'colour', 'rarity', 'binder', 'none'] as const
const DENSITIES = ['rows', 'compact', 'grid'] as const
const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const
const COLOR_MATCHES = ['including', 'exactly', 'atMost'] as const
const FINISHES = ['nonfoil', 'foil', 'etched'] as const
const CONDITIONS = ['nm', 'lp', 'mp', 'hp', 'dmg'] as const

const uuidSchema = z.uuid()

// Toute entrée externe passe par un schéma Zod, jamais un allow-list `Set` +
// `value as T` (docs/development.md « toute entrée externe... validée par un schéma
// Zod à la frontière, jamais castée » — y compris pour les valeurs
// d'énumération : `colors`, `sort`, `group`, `finishes`, `conditions`…).
// `z.enum(allowed).safeParse(part)` retourne un littéral déjà typé
// `T[number]`, sans jamais recourir à `as`.
function parseEnumList<T extends readonly [string, ...string[]]>(raw: string | null, allowed: T): T[number][] {
  if (!raw) return []
  const schema = z.enum(allowed)
  const seen = new Set<T[number]>()
  const result: T[number][] = []
  for (const part of raw.split(',')) {
    const parsed = schema.safeParse(part.trim())
    if (parsed.success && !seen.has(parsed.data)) {
      seen.add(parsed.data)
      result.push(parsed.data)
    }
  }
  return result
}

// Même tolérance que `parseEnumList`, sans restreindre à une énumération
// fermée (`types`/`rarities` : valeurs catalogue, pas un ensemble fini codé
// ici) — bornée en longueur par le schéma plutôt que transmise telle quelle
// (avisory #4 : ces deux champs atteignaient `cards.type_line ilike`/
// `cards.rarity = any(...)` sans passer par aucun schéma).
const freeListTokenSchema = z.string().trim().min(1).max(64)

function parseFreeList(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of raw.split(',')) {
    const parsed = freeListTokenSchema.safeParse(part)
    if (parsed.success && !seen.has(parsed.data)) {
      seen.add(parsed.data)
      result.push(parsed.data)
    }
  }
  return result
}

function parseEnumValue<T extends readonly [string, ...string[]]>(
  raw: string | null,
  allowed: T,
  fallback: T[number],
): T[number] {
  return z.enum(allowed).catch(fallback).parse(raw ?? undefined)
}

// Même tolérance, sans repli forcé : absent ou invalide retombe sur `null`
// (le défaut de compte pour `density`, l'absence de groupement pour
// `groupBy` — tous deux `T | null`).
function parseNullableEnum<T extends readonly [string, ...string[]]>(
  raw: string | null,
  allowed: T,
): T[number] | null {
  return z.enum(allowed).nullable().catch(null).parse(raw)
}

const boolFlagSchema = z.literal('1')

function parseBool(raw: string | null): boolean {
  return boolFlagSchema.safeParse(raw).success
}

function parseUuidOrNull(raw: string | null): string | null {
  if (!raw) return null
  return uuidSchema.safeParse(raw).success ? raw : null
}

// Code de set (`cards.set_code`, ex. `ktk`) : borné en longueur par le
// schéma plutôt qu'un simple `.trim()` (avisory #4).
const setCodeSchema = z.string().trim().min(1).max(16)

function parseTrimmedOrNull(raw: string | null): string | null {
  if (raw === null) return null
  const parsed = setCodeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// Montants en entier de centimes (`priceMinMinor`/`priceMaxMinor`, même
// convention que `container_stats.value_*_minor` — docs/development.md, jamais un
// flottant) : `price_min=abc` ne lève pas, retombe sur `null`.
// `z.coerce.number()` remplace le `Number(raw)` +
// `Number.isFinite` manuels par la même conversion, passée par un schéma.
const moneyMinorSchema = z.coerce.number().finite().nonnegative()

function parseMoneyMinor(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const parsed = moneyMinorSchema.safeParse(raw)
  return parsed.success ? Math.round(parsed.data) : null
}

export function parseViewState(params: URLSearchParams): ViewState {
  const colors = parseEnumList(params.get('colors'), COLORS)
  const colorMatch = parseEnumValue(params.get('color_match'), COLOR_MATCHES, EMPTY_FILTERS.colorMatch)
  // `Mono only` et `Multicolour only` sont mutuellement exclusives : si
  // l'URL porte les deux (composée à la main, lien
  // corrompu), `multicolourOnly` gagne plutôt que de laisser les deux vraies
  // en aval.
  const multicolourOnly = parseBool(params.get('multicolour_only'))
  const monoOnly = !multicolourOnly && parseBool(params.get('mono_only'))

  const filters: HoldingFilters = {
    colors,
    colorMatch,
    multicolourOnly,
    monoOnly,
    types: parseFreeList(params.get('types')),
    rarities: parseFreeList(params.get('rarities')),
    finishes: parseEnumList(params.get('finishes'), FINISHES),
    conditions: parseEnumList(params.get('conditions'), CONDITIONS),
    setCode: parseTrimmedOrNull(params.get('set')),
    binderId: parseUuidOrNull(params.get('binder')),
    priceMinMinor: parseMoneyMinor(params.get('price_min')),
    priceMaxMinor: parseMoneyMinor(params.get('price_max')),
  }

  const sortKey = parseEnumValue(params.get('sort'), SORT_KEYS, DEFAULT_SORT.key)
  const sortDir = parseEnumValue(params.get('dir'), SORT_DIRS, DEFAULT_SORT.dir)

  // `groupBy` accepte aussi `'none'` en toute rigueur (`GroupKey` l'inclut),
  // mais un `group=none` explicite dans l'URL équivaut au défaut `null` —
  // omis par `toSearchParams` ci-dessous, jamais les deux formes à la fois
  // (stabilité de l'URL).
  const groupByRaw = parseNullableEnum(params.get('group'), GROUP_KEYS)
  const normalizedGroupBy = groupByRaw === 'none' ? null : groupByRaw

  const density = parseNullableEnum(params.get('density'), DENSITIES)

  return {
    query: (params.get('q') ?? '').trim().replace(/\s+/g, ' '),
    filters,
    sort: { key: sortKey, dir: sortDir },
    groupBy: normalizedGroupBy,
    density,
  }
}

export function toSearchParams(v: ViewState): URLSearchParams {
  const params = new URLSearchParams()

  if (v.query) params.set('q', v.query)

  const f = v.filters
  if (f.colors.length > 0) params.set('colors', f.colors.join(','))
  if (f.colorMatch !== EMPTY_FILTERS.colorMatch) params.set('color_match', f.colorMatch)
  if (f.multicolourOnly) params.set('multicolour_only', '1')
  if (f.monoOnly) params.set('mono_only', '1')
  if (f.types.length > 0) params.set('types', f.types.join(','))
  if (f.rarities.length > 0) params.set('rarities', f.rarities.join(','))
  if (f.finishes.length > 0) params.set('finishes', f.finishes.join(','))
  if (f.conditions.length > 0) params.set('conditions', f.conditions.join(','))
  if (f.setCode) params.set('set', f.setCode)
  if (f.binderId) params.set('binder', f.binderId)
  if (f.priceMinMinor !== null) params.set('price_min', String(f.priceMinMinor))
  if (f.priceMaxMinor !== null) params.set('price_max', String(f.priceMaxMinor))

  if (v.sort.key !== DEFAULT_SORT.key) params.set('sort', v.sort.key)
  if (v.sort.dir !== DEFAULT_SORT.dir) params.set('dir', v.sort.dir)

  if (v.groupBy && v.groupBy !== 'none') params.set('group', v.groupBy)

  if (v.density) params.set('density', v.density)

  return params
}

// Pastille du bouton `Filters` : une unité par valeur
// sélectionnée dans une liste (une couleur cochée compte 1, deux en
// comptent 2) et par bascule/plage active — pas une unité par section. Une
// section affichée mais laissée à son défaut (ex. `colorMatch: 'including'`
// sans couleur cochée) ne compte pas : ce réglage n'a aucun effet tant
// qu'aucune couleur n'est choisie.
// Un filtre actif, tel qu'il se lit dans la barre de commande : un libellé
// et l'état de filtres obtenu en le retirant. La barre n'a alors aucune règle
// de filtre à connaître — elle rend des puces et rappelle `next`.
//
// Pourquoi une puce par filtre plutôt qu'une pastille de comptage sur le
// bouton `Filters` : le comptage dit qu'il se passe quelque chose sans dire
// quoi, et il faut rouvrir la feuille pour défaire un seul critère. Ici, ce
// qui est actif est lisible et se retire d'un geste.
export interface ActiveFilter {
  key: string
  label: string
  next: HoldingFilters
}

const RARITY_CHIP_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
}

const CONDITION_CHIP_LABEL: Record<Condition, string> = {
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
  hp: 'HP',
  dmg: 'DMG',
}

// Libellés de la puce ACTIVE — distincts de ceux du chip
// sélectionnable dans la feuille `Filters` (« Foil only »/« Non-foil »,
// `filters-sheet.tsx`) : une fois retenue, la puce de la barre de commande
// épelle « … only » dans les deux cas pour rester lisible hors contexte.
const FINISH_CHIP_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil only',
  foil: 'Foil only',
  etched: 'Etched',
}

// Même ordre que les sections de la feuille de filtres, pour qu'un aller-retour
// entre la feuille et la barre ne réordonne rien.
//
// `currency` : seule la puce de prix en a besoin
// (`formatMoney`) — passée en paramètre plutôt que lue d'un contexte, cette
// fonction reste pure et testable sans session ni compte.
//
// `binders` (filtre `Binder` — voir le commentaire de tête de
// `listHoldings`, `holdings-data.ts`) : la liste des
// binders (+ la racine, étiquetée « No binder ») de la collection courante,
// telle que rendue par `listHoldingBindersAction` — optionnelle, `[]` par
// défaut pour ne rien changer aux appels existants qui n'en ont pas besoin
// (`tests/unit/view-state.test.ts`).
export function describeActiveFilters(
  f: HoldingFilters,
  currency: Currency,
  binders: Array<{ id: string; name: string }> = [],
): ActiveFilter[] {
  const chips: ActiveFilter[] = []

  // UNE puce couleurs, pas une
  // par couleur cochée — les lettres concaténées dans l'ordre WUBRGC,
  // préfixées `Exactly `/`At most ` quand le mode s'écarte du défaut
  // (`including`, sans préfixe : une carte qui *contient* ces couleurs, la
  // lecture la plus permissive n'a besoin d'aucune précision).
  if (f.colors.length > 0) {
    const prefix =
      f.colorMatch === 'exactly' ? 'Exactly ' : f.colorMatch === 'atMost' ? 'At most ' : ''
    const letters = COLORS.filter((c) => f.colors.includes(c)).join('')
    chips.push({
      key: 'colors',
      label: `${prefix}${letters}`,
      next: { ...f, colors: [] },
    })
  }
  if (f.multicolourOnly) {
    chips.push({
      key: 'multicolour',
      label: 'Multicolour only',
      next: { ...f, multicolourOnly: false },
    })
  }
  if (f.monoOnly) {
    chips.push({ key: 'mono', label: 'Mono only', next: { ...f, monoOnly: false } })
  }
  for (const type of f.types) {
    chips.push({
      key: `type:${type}`,
      label: type,
      next: { ...f, types: f.types.filter((v) => v !== type) },
    })
  }
  for (const rarity of f.rarities) {
    chips.push({
      key: `rarity:${rarity}`,
      label: RARITY_CHIP_LABEL[rarity] ?? rarity,
      next: { ...f, rarities: f.rarities.filter((v) => v !== rarity) },
    })
  }
  for (const finish of f.finishes) {
    chips.push({
      key: `finish:${finish}`,
      label: FINISH_CHIP_LABEL[finish],
      next: { ...f, finishes: f.finishes.filter((v) => v !== finish) },
    })
  }
  for (const condition of f.conditions) {
    chips.push({
      key: `condition:${condition}`,
      label: CONDITION_CHIP_LABEL[condition],
      next: { ...f, conditions: f.conditions.filter((v) => v !== condition) },
    })
  }
  if (f.setCode) {
    chips.push({
      key: 'set',
      label: f.setCode.toUpperCase(),
      next: { ...f, setCode: null },
    })
  }
  // Le nom du binder : `binders` porte déjà la racine étiquetée « No binder »
  // (`listHoldingBindersAction`), donc cette seule recherche couvre les deux
  // cas — un binder précis et le vrac — sans branche séparée.
  if (f.binderId) {
    const binder = binders.find((candidate) => candidate.id === f.binderId)
    chips.push({ key: 'binder', label: binder?.name ?? 'Binder', next: { ...f, binderId: null } })
  }
  // UNE puce prix `min – max` — `∞` pour la borne absente,
  // jamais deux puces séparées : retirer celle-ci efface les deux bornes à
  // la fois, exactement ce qu'une seule puce affirme.
  if (f.priceMinMinor !== null || f.priceMaxMinor !== null) {
    const min = f.priceMinMinor !== null ? formatMoney(f.priceMinMinor, currency) : '∞'
    const max = f.priceMaxMinor !== null ? formatMoney(f.priceMaxMinor, currency) : '∞'
    chips.push({
      key: 'price',
      label: `${min} – ${max}`,
      next: { ...f, priceMinMinor: null, priceMaxMinor: null },
    })
  }

  return chips
}

export function countActiveFilters(f: HoldingFilters): number {
  let count = 0
  count += f.colors.length
  count += f.types.length
  count += f.rarities.length
  count += f.finishes.length
  count += f.conditions.length
  if (f.multicolourOnly) count += 1
  if (f.monoOnly) count += 1
  if (f.setCode) count += 1
  if (f.binderId) count += 1
  if (f.priceMinMinor !== null) count += 1
  if (f.priceMaxMinor !== null) count += 1
  return count
}
