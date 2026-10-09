'use server'

// Écriture des préférences de compte. Un patch partiel validé par
// `preferencesSchema` (docs/development.md : toute entrée externe passe par Zod
// à la frontière) avant de toucher `users` — une valeur hors énumération ne
// doit jamais atteindre la base.
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { users } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { db } from '@spellcache/db'
import { getPreferences, preferencesSchema, type Preferences } from '@/lib/preferences'

export type UpdatePreferenceResult =
  | { ok: true; preferences: Preferences }
  | { ok: false; error: string }

// `/collection` et `/container/[id]` sont des routes dynamiques (elles lisent
// la session via `requireSession()`/`auth()`) : chaque navigation les rend
// déjà à neuf côté serveur, sans cache de route à invalider pour que la
// préférence écrite ici s'y reflète. `/collection` seule est tout de même
// revalidée explicitement (même geste que `binder-actions.ts`) — l'écran
// d'accueil garde une route fixe vers laquelle un retour peut réutiliser un
// rendu déjà en mémoire côté client (bouton retour du navigateur),
// contrairement à `/container/[id]`, toujours atteint depuis un lien frais.
export async function updatePreferenceAction(input: unknown): Promise<UpdatePreferenceResult> {
  const session = await requireSession()

  const parsed = preferencesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  if (Object.keys(parsed.data).length > 0) {
    await db.update(users).set(parsed.data).where(eq(users.id, session.id))
  }

  revalidatePath('/collection')

  const preferences = await getPreferences(session.id)
  return { ok: true, preferences }
}
