// Shell authentifié — composant serveur : il lit les drapeaux d'outils du
// compte (`users.tool_life_tracker`) pour que la barre d'onglets rende quatre
// ou cinq onglets. `auth()` plutôt que `requireSession()` : ce layout
// enveloppe aussi `/onboarding/username`, qui n'a par définition pas encore de
// username et ne doit pas être redirigé par sa propre coquille — la garde
// reste dans chaque page.
//
// Il lit aussi l'arbre de la barre latérale desktop (choix shell mobile / shell
// desktop selon la largeur). Lu ici, au même endroit et dans le même
// aller-retour serveur que les drapeaux d'outils, plutôt que par un `useEffect`
// côté client : la barre latérale est déjà peuplée à la première peinture.
// `getSidebarData` rend `null` tant que le compte n'a ni username ni collection
// (`/onboarding/username`) — le shell se replie alors sur la seule colonne
// principale.
import { AppShell } from '@/app/(app)/app-shell'
import { getSidebarData, type SidebarData } from '@/components/desktop/sidebar-data'
import { auth } from '@/lib/auth'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { NO_TOOLS, type ToolFlags } from '@/lib/tools/tools'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const userId = session?.user?.id

  let tools: ToolFlags = NO_TOOLS
  let sidebar: SidebarData | null = null
  if (userId) {
    ;[tools, sidebar] = await Promise.all([getToolFlags(userId), getSidebarData(userId)])
  }

  return (
    <AppShell tools={tools} sidebar={sidebar}>
      {children}
    </AppShell>
  )
}
