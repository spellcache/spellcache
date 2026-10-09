// Réglages du site (table `site_settings`, une ligne `id = 1`). Une ligne
// absente vaut les défauts — jamais d'erreur sur une base neuve.
import { eq, sql } from 'drizzle-orm'

import { siteSettings, users, type SignupMode } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

const SETTINGS_ROW_ID = 1

export async function getSignupMode(): Promise<SignupMode> {
  const [row] = await db
    .select({ signupMode: siteSettings.signupMode })
    .from(siteSettings)
    .where(eq(siteSettings.id, SETTINGS_ROW_ID))
    .limit(1)
  return row?.signupMode ?? 'invite'
}

export async function setSignupMode(mode: SignupMode): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ id: SETTINGS_ROW_ID, signupMode: mode })
    .onConflictDoUpdate({ target: siteSettings.id, set: { signupMode: mode } })
}

// Email réservé au premier administrateur (`ADMIN_EMAIL`). Défini, il ferme
// la fenêtre d'un déploiement neuf où n'importe qui atteignant le domaine
// avant son propriétaire deviendrait admin (lib/auth.ts).
export function getAdminEmail(): string | null {
  const value = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  return value ? value : null
}

// Un lien magique peut-il partir vers cet email ? Toujours pour un compte
// existant (y compris un invité en attente) ; pour un email inconnu,
// seulement si les inscriptions sont ouvertes — ou si la base est vide :
// le tout premier compte, qui devient admin (lib/auth.ts), doit pouvoir
// naître quel que soit le réglage, et seulement pour `ADMIN_EMAIL` s'il est
// défini.
export async function canRequestMagicLink(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const [row] = await db
    .select({
      exists: sql<boolean>`exists(select 1 from ${users} where lower(${users.email}) = ${normalized})`,
      anyUser: sql<boolean>`exists(select 1 from ${users})`,
    })
    .from(sql`(select 1) as one`)
  if (row?.exists) return true
  if (!row?.anyUser) {
    const adminEmail = getAdminEmail()
    return adminEmail === null || normalized === adminEmail
  }
  return (await getSignupMode()) === 'open'
}
