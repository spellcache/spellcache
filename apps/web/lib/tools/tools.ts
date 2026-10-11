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

export interface ToolFlags {
  lifeTracker: boolean
  tradingMode: boolean
}

// Aucun outil actif — l'état d'une session absente ou d'un compte dont
// l'onboarding n'est pas terminé (le shell est monté avant `requireSession`
// sur `/onboarding/username`).
export const NO_TOOLS: ToolFlags = { lifeTracker: false, tradingMode: false }

// Les apps font partie de l'application, il n'y a ni store ni greffons :
// la règle ne se duplique nulle part ailleurs.
export function anyToolEnabled(tools: ToolFlags): boolean {
  return tools.lifeTracker || tools.tradingMode
}

// Colonnes de préférence (`users.tool_*`) des outils livrés.
export type ToolPreference = 'toolLifeTracker' | 'toolTradingMode'

// Projection des préférences de compte vers le contrat ci-dessus — une seule
// traduction colonne → drapeau, partagée par le layout et les pages de
// `/tools`.
export function toolFlagsOf(preferences: Record<ToolPreference, boolean>): ToolFlags {
  return { lifeTracker: preferences.toolLifeTracker, tradingMode: preferences.toolTradingMode }
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
  // Absents pour les outils `planned` : aucun écran ni drapeau n'existe
  // encore.
  path?: string
  flag?: keyof ToolFlags
  preference?: ToolPreference
  state: ToolCatalogState
  description: string
}

export const TOOLS: ToolCatalogEntry[] = [
  {
    key: 'life_tracker',
    name: 'Life tracker',
    Icon: HeartPulse,
    path: '/tools/life',
    flag: 'lifeTracker',
    preference: 'toolLifeTracker',
    state: 'shipped',
    description: 'Simple life tracker for up to six players',
  },
  // Test de deck en solo : mains de départ, mulligans, premiers tours
  // (demande produit).
  {
    key: 'playtest',
    name: 'Playtest',
    Icon: FlaskConical,
    state: 'planned',
    description: 'Test your decks: draw opening hands, mulligan and play the first turns',
  },
  {
    key: 'trading_mode',
    name: 'Trading mode',
    Icon: ArrowLeftRight,
    path: '/tools/trade',
    flag: 'tradingMode',
    preference: 'toolTradingMode',
    state: 'shipped',
    description:
      'Simplify your card trading with a quick price comparison and automatic update of your collection when trading cards',
  },
  {
    key: 'card_scanner',
    name: 'Card scanner',
    Icon: ScanLine,
    state: 'planned',
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

export function isToolEnabled(key: ToolCatalogEntry['key'], tools: ToolFlags): boolean {
  const flag = TOOLS.find((tool) => tool.key === key)?.flag
  return flag ? tools[flag] : false
}
