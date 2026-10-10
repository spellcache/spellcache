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
  playtest: boolean
}

// Aucun outil actif — l'état d'une session absente ou d'un compte dont
// l'onboarding n'est pas terminé (le shell est monté avant `requireSession`
// sur `/onboarding/username`).
export const NO_TOOLS: ToolFlags = { lifeTracker: false, playtest: false }

// Les apps font partie de l'application, il n'y a ni store ni greffons :
// chaque outil livré ajoute son drapeau à ce `||`, sans que la règle ne se
// duplique ailleurs.
export function anyToolEnabled(tools: ToolFlags): boolean {
  return tools.lifeTracker || tools.playtest
}

// Projection des préférences de compte (`users.tool_life_tracker`,
// `users.tool_playtest`) vers le contrat ci-dessus — une seule traduction
// colonne → drapeau, partagée par le layout et les pages de `/tools`.
export function toolFlagsOf(preferences: {
  toolLifeTracker: boolean
  toolPlaytest: boolean
}): ToolFlags {
  return { lifeTracker: preferences.toolLifeTracker, playtest: preferences.toolPlaytest }
}

// Catalogue unique des outils : l'onglet `Tools` et le groupe `Tools` de
// Settings lisent tous deux cette même liste — une nouvelle app ne s'ajoute
// donc qu'à un seul endroit. `life_tracker` et `playtest` portent
// `state: 'shipped'` ; les trois autres sont des lignes `Planned` grisées sans
// écran (docs/development.md).
export type ToolCatalogState = 'shipped' | 'planned'
export type ToolPreferenceField = 'toolLifeTracker' | 'toolPlaytest'

export interface ToolCatalogEntry {
  key: 'life_tracker' | 'playtest' | 'trading_mode' | 'card_scanner' | 'ai_assistant'
  name: string
  Icon: LucideIcon
  // Absent pour les trois outils `planned` : aucun écran n'existe encore.
  path?: string
  state: ToolCatalogState
  // Colonne de préférence (`users.tool_*`) qui active l'outil : présente pour
  // les seuls outils livrés, c'est elle que l'interrupteur de Settings écrit.
  preference?: ToolPreferenceField
  description: string
}

export const TOOLS: ToolCatalogEntry[] = [
  {
    key: 'life_tracker',
    name: 'Life tracker',
    Icon: HeartPulse,
    path: '/tools/life',
    state: 'shipped',
    preference: 'toolLifeTracker',
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
    preference: 'toolPlaytest',
    description: 'Test your decks: draw opening hands, mulligan and play the first turns',
  },
  {
    key: 'trading_mode',
    name: 'Trading mode',
    Icon: ArrowLeftRight,
    state: 'planned',
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

// Clé de catalogue → drapeau de compte. Les outils `planned` n'ont pas de
// drapeau et restent éteints.
export function isToolEnabled(key: ToolCatalogEntry['key'], tools: ToolFlags): boolean {
  if (key === 'life_tracker') return tools.lifeTracker
  if (key === 'playtest') return tools.playtest
  return false
}
