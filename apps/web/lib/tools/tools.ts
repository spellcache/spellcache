// Règle d'affichage de l'onglet `Tools` (cette règle vit en un seul
// endroit, sinon un écran affichera cinq onglets et un autre quatre). Ce
// module est la seule
// définition de « au moins un outil est actif » — `TabBar` l'appelle pour
// décider du cinquième onglet, `app/(app)/tools/*` pour décider du 404
// (un onglet caché ne suffit pas, la route doit être injoignable). Aucun
// appelant ne recalcule le prédicat.
//
// Pur (aucun `import { db }`) : `components/ui/tab-bar.tsx` est rendu depuis
// le shell client de `app/(app)/layout.tsx`, la lecture en base vit dans
// `lib/tools/tool-flags.ts`.
import { ArrowLeftRight, FlaskConical, HeartPulse, ScanLine, Sparkles, type LucideIcon } from 'lucide-react'

// Préférence de compte (colonne `users.tool_*`) de chaque outil livré — la
// seule table clé → colonne : drapeaux, bascules de Settings et lectures en
// base en dérivent, livrer un outil revient à y ajouter une ligne.
export const TOOL_PREFERENCE = {
  life_tracker: 'toolLifeTracker',
  playtest: 'toolPlaytest',
  trading_mode: 'toolTradingMode',
  card_scanner: 'toolCardScanner',
} as const

export type ShippedToolKey = keyof typeof TOOL_PREFERENCE
export type ToolPreferenceField = (typeof TOOL_PREFERENCE)[ShippedToolKey]

export type ToolFlags = Record<ShippedToolKey, boolean>

const SHIPPED_TOOL_KEYS = Object.keys(TOOL_PREFERENCE) as ShippedToolKey[]

// Aucun outil actif — l'état d'une session absente ou d'un compte dont
// l'onboarding n'est pas terminé (le shell est monté avant `requireSession`
// sur `/onboarding/username`).
export const NO_TOOLS: ToolFlags = {
  life_tracker: false,
  playtest: false,
  trading_mode: false,
  card_scanner: false,
}

// Les apps font partie de l'application, il n'y a ni store ni greffons.
export function anyToolEnabled(tools: ToolFlags): boolean {
  return SHIPPED_TOOL_KEYS.some((key) => tools[key])
}

// Projection des préférences de compte vers le contrat ci-dessus — une
// seule traduction colonne → drapeau, partagée par le layout, la barre
// latérale et les pages de `/tools`.
export function toolFlagsOf(preferences: Record<ToolPreferenceField, boolean>): ToolFlags {
  return Object.fromEntries(
    SHIPPED_TOOL_KEYS.map((key) => [key, preferences[TOOL_PREFERENCE[key]]]),
  ) as ToolFlags
}

// Colonne de préférence d'une entrée du catalogue, `null` pour un outil
// `planned` qui n'en a pas encore.
export function toolPreferenceOf(key: ToolCatalogEntry['key']): ToolPreferenceField | null {
  return key in TOOL_PREFERENCE ? TOOL_PREFERENCE[key as ShippedToolKey] : null
}

// Catalogue unique des outils : l'onglet `Tools` et le groupe `Tools` de
// Settings lisent tous deux cette même liste — une nouvelle app ne s'ajoute
// donc qu'à un seul endroit. Les outils `planned` sont des lignes grisées
// sans écran (docs/development.md).
export type ToolCatalogState = 'shipped' | 'planned'

export interface ToolCatalogEntry {
  key: 'life_tracker' | 'playtest' | 'trading_mode' | 'card_scanner' | 'ai_assistant'
  name: string
  Icon: LucideIcon
  // Absent pour les outils `planned` : aucun écran n'existe encore.
  path?: string
  state: ToolCatalogState
  description: string
}

export const TOOLS: ToolCatalogEntry[] = [
  {
    key: 'life_tracker',
    name: 'Life tracker',
    Icon: HeartPulse,
    path: '/tools/life',
    state: 'shipped',
    description: 'Simple life tracker for up to six players',
  },
  // Test de deck en solo : mains de départ, mulligans, premiers tours
  // (demande produit).
  {
    key: 'playtest',
    name: 'Playtest',
    Icon: FlaskConical,
    path: '/tools/playtest',
    state: 'shipped',
    description: 'Test your decks: draw opening hands, mulligan and play the first turns',
  },
  {
    key: 'trading_mode',
    name: 'Trading mode',
    Icon: ArrowLeftRight,
    path: '/tools/trade',
    state: 'shipped',
    description:
      'Simplify your card trading with a quick price comparison and automatic update of your collection when trading cards',
  },
  {
    key: 'card_scanner',
    name: 'Card scanner',
    Icon: ScanLine,
    path: '/tools/scanner',
    state: 'shipped',
    description: 'A simple yet useful card scanner to scan and add cards to your collection',
  },
  {
    key: 'ai_assistant',
    name: 'AI assistant',
    Icon: Sparkles,
    state: 'planned',
    description: 'Deck suggestions, rulings or anything you could dream AI could do',
  },
]

// Un outil `planned` n'a pas de drapeau : il n'est jamais actif.
export function isToolEnabled(key: ToolCatalogEntry['key'], tools: ToolFlags): boolean {
  return key in tools ? tools[key as ShippedToolKey] : false
}
