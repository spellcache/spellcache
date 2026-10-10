// Lecture serveur des drapeaux d'outils :
// une seule requête, partagée par le shell authentifié
// (`app/(app)/layout.tsx`) et par les gardes 404 des pages de `/tools`. La règle elle-même vit dans `lib/tools/tools.ts`, jamais
// recopiée ici.
import { eq } from 'drizzle-orm'

import { users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { NO_TOOLS, toolFlagsOf, type ToolFlags } from '@/lib/tools/tools'

export async function getToolFlags(userId: string): Promise<ToolFlags> {
  const [row] = await db
    .select({ toolLifeTracker: users.toolLifeTracker, toolPlaytest: users.toolPlaytest })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // Un compte introuvable n'active aucun outil plutôt que de faire planter
  // le shell de toutes les routes `(app)` — la garde de session
  // (`requireSession`) reste la seule à décider d'une redirection.
  return row ? toolFlagsOf(row) : NO_TOOLS
}
