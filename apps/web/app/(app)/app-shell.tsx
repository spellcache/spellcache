'use client'

import { usePathname } from 'next/navigation'

import { Sidebar } from '@/components/desktop/sidebar'
import { CollectionAccessProvider } from '@/lib/collections/access-context'
import type { SidebarData } from '@/components/desktop/sidebar-data'
import { useMinWidth } from '@/components/desktop/use-min-width'
import {
  SelectionProvider,
  useSelection,
} from '@/components/selection/selection-provider'
import { matchTab, TabBar, type TabKey } from '@/components/ui/tab-bar'
import { BREAKPOINTS } from '@/lib/breakpoints'
import type { ToolFlags } from '@/lib/tools/tools'

// Délègue à `matchTab` (`components/ui/tab-bar.tsx`) plutôt que
// de comparer le premier segment du chemin : la table `TAB_MATCHES` y allume
// `Collection` aussi bien sur `/collection/*` que sur `/container/*` (un
// drill-in garde l'onglet de sa section), et son repli sur `'collection'`
// est explicite au lieu d'accepter silencieusement n'importe quel premier
// segment inconnu.
function activeTabFromPathname(pathname: string): TabKey {
  return matchTab(pathname)
}

// Entrée active de la barre latérale (`Sidebar({ tree, activeId })`) : un
// container et un dossier de decks sont désignés par leur id, les sections
// par leur clé — la même chaîne qu'un onglet mobile, pour que les deux
// coquilles se réfèrent au même endroit.
export function activeIdFromPathname(pathname: string): string {
  const [first, second, third] = pathname.split('/').filter(Boolean)
  if (first === 'container' && second) return second
  if (first === 'decks' && second === 'folders' && third) return third
  return first ?? 'collection'
}

// La barre d'onglets et la sélection groupée partagent le même
// emplacement bas d'écran : quand une sélection est active, la barre
// d'onglets doit être absente du DOM, pas
// seulement masquée — c'est pourquoi `SelectionProvider` est monté ici,
// au-dessus de `TabBar` autant que de `{children}`, plutôt que dans l'écran
// de container qui est son descendant. La barre d'action de remplacement
// (`components/selection/action-bar.tsx`) est rendue par l'écran de
// container lui-même, en position fixe au même emplacement — ce shell n'a
// besoin que du drapeau `active`, jamais des actions groupées elles-mêmes
// (compteur, Edit/Move/Add to deck/Delete), qui restent un détail de l'écran
// de container.
//
// Îlot client extrait de `app/(app)/layout.tsx` : le layout est redevenu un
// composant serveur pour lire `users.tool_life_tracker` et passe les drapeaux
// tels quels — la règle « au moins un outil actif » n'est évaluée que par
// `TabBar` (`lib/tools/tools.ts`), jamais ici.
//
// ── Deux coquilles, une seule application ────────────────────────────────
//
// Sous 768px, l'accueil mobile et la barre d'onglets basse ; au-delà, la
// barre latérale et la colonne principale. **La mise en
// page est choisie par CSS** — `desktop:flex` ici, `hidden desktop:block`
// sur la barre latérale, `desktop:hidden` en creux sur la barre d'onglets :
// la première peinture est donc correcte à toutes les largeurs, y compris
// avant l'exécution du moindre JavaScript (choisir la disposition avec un
// `useEffect` sur `window.innerWidth` provoque un saut au premier rendu).
//
// `useMinWidth` ne sert qu'à **élaguer** ensuite : à 375px, aucun élément de
// barre latérale ne doit être dans le DOM,
// et le CSS ne sait que masquer. D'où le tri-état (`null` avant
// hydratation, voir `components/desktop/use-min-width.ts`) et les deux
// conditions ci-dessous, écrites `!== false` / `!== true` :
//
//   - rendu serveur et rendu d'hydratation → les deux éléments sont dans le
//     HTML, et c'est le CSS qui décide lequel se voit ;
//   - après hydratation → celui que le CSS masquait déjà est démonté.
//     Visuellement, rien ne bouge ; le DOM, lui, n'a plus qu'une seule
//     navigation, jamais deux jeux de liens `Collection`/`Search`/`Decks`/
//     `Settings` en concurrence.
//
// Les deux branches interrogent le même `BREAKPOINTS.mobile` que la feuille
// compilée : elles ne peuvent pas diverger.
function AppShellContent({
  children,
  tools,
  sidebar,
}: {
  children: React.ReactNode
  tools: ToolFlags
  sidebar: SidebarData | null
}) {
  const pathname = usePathname()
  const active = activeTabFromPathname(pathname)
  const selection = useSelection()
  const isDesktop = useMinWidth(BREAKPOINTS.mobile)

  const renderSidebar = sidebar !== null && isDesktop !== false
  const renderTabBar = !selection.active && isDesktop !== true

  return (
    // La coquille fait exactement une hauteur de fenêtre et ne déborde
    // jamais : en colonne sur mobile (contenu puis barre d'onglets), en
    // ligne sur desktop (barre latérale puis contenu). Rien ici ne défile —
    // le seul défilement d'un écran est celui du corps de son `Screen`
    // (`components/ui/screen.tsx`), ce qui garde la barre de défilement
    // entre l'en-tête et la barre d'onglets au lieu de la laisser courir
    // toute la fenêtre.
    // Bornes : coquille
    // centrée à 1180px max (1600px quand le panneau d'aperçu est monté —
    // détecté par `:has([data-preview-pane])`), gouttière de 28px entre la
    // barre latérale et la colonne, colonne de lecture bornée à 820px. Pas
    // de filet entre les colonnes : la gouttière suffit.
    <div className="flex h-dvh flex-col overflow-hidden desktop:mx-auto desktop:w-full desktop:max-w-shell desktop:flex-row desktop:gap-shell-gap desktop:px-24 pane:has-[[data-preview-pane]]:max-w-shell-pane">
      {renderSidebar && (
        <div className="hidden flex-shrink-0 desktop:block">
          <Sidebar
            tree={sidebar.tree}
            activeId={activeIdFromPathname(pathname)}
            collapsed={sidebar.collapsed}
          />
        </div>
      )}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden desktop:max-w-content pane:has-[[data-preview-pane]]:max-w-none">
        {children}
      </main>
      {/* `desktop:hidden` porté par une enveloppe, pas par `TabBar`
          lui-même (composant partagé, `fixed inset-x-0 bottom-0`) :
          au-delà de 768px la barre d'onglets est masquée **dès la première
          peinture**, avant que l'élagage ci-dessus n'ait eu lieu. Sans
          cela, un écran large la verrait apparaître puis disparaître à
          l'hydratation — exactement le saut à éviter. */}
      {renderTabBar && (
        <div className="desktop:hidden">
          <TabBar active={active} tools={tools} />
        </div>
      )}
    </div>
  )
}

export function AppShell({
  children,
  tools,
  sidebar,
}: {
  children: React.ReactNode
  tools: ToolFlags
  sidebar: SidebarData | null
}) {
  return (
    <SelectionProvider>
      <CollectionAccessProvider canEdit={sidebar?.canEdit ?? true}>
        <AppShellContent tools={tools} sidebar={sidebar}>
          {children}
        </AppShellContent>
      </CollectionAccessProvider>
    </SelectionProvider>
  )
}
