// Lecture serveur des drapeaux d'outils :
// une seule requête, partagée par le shell authentifié
// (`app/(app)/layout.tsx`) et par les gardes 404 des pages de `/tools`.
// La règle elle-même vit dans `lib/tools/tools.ts`, jamais
// recopiée ici.
import { eq } from 'drizzle-orm'

import { users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { NO_TOOLS, toolFlagsOf, type ToolFlags, type ToolPreferenceField } from '@/lib/tools/tools'

// Colonnes lues pour les drapeaux, aussi reprises par la barre latérale
// desktop (`components/desktop/sidebar-data.ts`) : `satisfies` refuse la
// compilation tant qu'un outil livré n'a pas sa colonne ici.
export const toolFlagColumns = {
  toolLifeTracker: users.toolLifeTracker,
  toolPlaytest: users.toolPlaytest,
  toolTradingMode: users.toolTradingMode,
  toolCardScanner: users.toolCardScanner,
} satisfies Record<ToolPreferenceField, unknown>

export async function getToolFlags(userId: string): Promise<ToolFlags> {
  const [row] = await db
    .select(toolFlagColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // Un compte introuvable n'active aucun outil plutôt que de faire planter
  // le shell de toutes les routes `(app)` — la garde de session
  // (`requireSession`) reste la seule à décider d'une redirection.
  return row ? toolFlagsOf(row) : NO_TOOLS
}
