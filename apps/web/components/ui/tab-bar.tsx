import { Library, Search, Settings, Wrench } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { anyToolEnabled, type ToolFlags } from '@/lib/tools/tools'

export type TabKey = 'collection' | 'search' | 'decks' | 'tools' | 'settings'

const STROKE_WIDTH = 1.75

// Lucide n'a pas d'icône « deux cartes empilées » : forme reprise à
// l'identique de la barre d'onglets du design validé. Exportée : la ligne de
// navigation `Decks` de l'accueil et le bouton `To deck` de la barre d'action
// groupée (`components/selection/action-bar.tsx`, en 19px plutôt que 21px)
// réutilisent le même glyphe plutôt que d'en dupliquer le tracé.
export function DecksIcon({ size = 21 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={2.6} y={8.4} width={11} height={13} rx={2} />
      <path d="M5.6 8.4V7.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
      <path d="M8.6 5.4V4.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
    </svg>
  )
}

const TABS: Array<{ key: TabKey; href: string; label: string; icon: ReactNode }> = [
  {
    key: 'collection',
    href: '/collection',
    label: 'Collection',
    icon: <Library width={21} height={21} strokeWidth={STROKE_WIDTH} />,
  },
  {
    key: 'search',
    href: '/search',
    label: 'Search',
    icon: <Search width={21} height={21} strokeWidth={STROKE_WIDTH} />,
  },
  { key: 'decks', href: '/decks', label: 'Decks', icon: <DecksIcon /> },
  {
    key: 'tools',
    href: '/tools',
    label: 'Tools',
    icon: <Wrench width={21} height={21} strokeWidth={STROKE_WIDTH} />,
  },
  {
    key: 'settings',
    href: '/settings',
    label: 'Settings',
    icon: <Settings width={21} height={21} strokeWidth={STROKE_WIDTH} />,
  },
]

// Préfixes de chemin qui allument chaque onglet : un drill-in garde
// l'onglet de sa section plutôt
// que d'en allumer un autre — `/container/<id>` (un binder, la collection
// racine) reste `Collection`, jamais un onglet à part. Table unique, lue par
// `matchTab` ci-dessous, elle-même la seule source de
// `app/(app)/app-shell.tsx#activeTabFromPathname` — pas une seconde copie du
// prédicat.
const TAB_MATCHES: Record<TabKey, string[]> = {
  collection: ['/collection', '/container'],
  search: ['/search'],
  decks: ['/decks'],
  tools: ['/tools'],
  settings: ['/settings'],
}

// Un préfixe ne matche qu'à une frontière de segment : `/collection`
// lui-même, ou suivi de `/` — jamais `/collectionX`. Le repli sur
// `'collection'` reste explicite et unique (contre le repli silencieux au
// premier segment que ce module remplace), documenté ici plutôt que sur
// chaque appelant.
export function matchTab(pathname: string): TabKey {
  const found = (Object.keys(TAB_MATCHES) as TabKey[]).find((key) =>
    TAB_MATCHES[key].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  )
  return found ?? 'collection'
}

// La barre rend `Tools` si et seulement si au moins un outil est actif. Elle
// reçoit les drapeaux bruts, pas un booléen déjà décidé : le prédicat
// lui-même vit dans `lib/tools/tools.ts` et n'est réévalué par aucun appelant
// (sinon un écran afficherait cinq onglets et un autre quatre).
export function TabBar({ active, tools }: { active: TabKey; tools: ToolFlags }) {
  const toolsEnabled = anyToolEnabled(tools)
  const visibleTabs = TABS.filter((tab) => tab.key !== 'tools' || toolsEnabled)

  return (
    // Dans le flux au bas de la coquille, plus par-dessus elle : le
    // défilement du contenu s'arrête donc net là où la barre commence, au
    // lieu de courir dessous et d'exiger une réserve. Le bas paie la zone
    // sûre de l'appareil (`--spacing-tab-bar-bottom`).
    // Fond `surface-3` + filet haut `surface-2` (`rgb(24,27,34)` +
    // `border-top rgb(20,24,33)`) : une barre transparente se fondrait dans
    // le noir du bas de page.
    <nav className="z-40 flex w-full flex-shrink-0 items-center justify-center gap-0 border-t border-surface-2 bg-surface-3 px-4 pt-10 pb-tab-bar-bottom">
      {visibleTabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-4 p-4 text-tab-label font-semibold ${
              isActive ? 'text-accent-text' : 'text-text-2'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
