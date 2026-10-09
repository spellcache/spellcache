// Gardes serveur. Le check de session lit la base via `auth()` (adapter
// Drizzle) — jamais appelable depuis `middleware.ts` (runtime Edge), seulement depuis un
// composant serveur (page, layout, Server Action).
import { redirect } from 'next/navigation'

import type { UserRole } from '@spellcache/db/schema'
import { auth } from '@/lib/auth'
import { bootstrapCollection } from '@/lib/collections/bootstrap'

export interface SessionUser {
  id: string
  email: string
  username: string
  role: UserRole
}

export class ForbiddenError extends Error {}

// Route protégée « pleine » (les cinq onglets, Administration › Users) :
// exige une session ET un username défini, sinon redirige — jamais appelée
// depuis l'écran d'onboarding lui-même, qui n'a par définition pas encore de
// username.
export async function requireSession(): Promise<SessionUser> {
  const session = await auth()
  const user = session?.user

  if (!user?.id) redirect('/login')
  if (!user.username) redirect('/onboarding/username')

  // Création automatique de la collection à la première connexion :
  // idempotent, un compte déjà membre n'en reçoit pas une seconde.
  await bootstrapCollection(user.id, { username: user.username, displayName: user.displayName })

  return { id: user.id, email: user.email, username: user.username, role: user.role }
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession()
  if (user.role !== 'admin') throw new ForbiddenError('Admin role required.')
  return user
}
