'use server'

// Mutations de compte. Toute entrée
// externe est validée par Zod à la frontière avant de toucher la base
// (docs/development.md) — un username non validé
// ouvrirait une injection dans le futur routage public `/u/<username>`.
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { users } from '@spellcache/db/schema'
import { auth, signIn, signOut } from '@/lib/auth'
import { ForbiddenError, requireAdmin } from '@/lib/auth-guards'
import { deleteAccounts, type BlockedAccount } from '@/lib/accounts/delete-accounts'
import { db } from '@spellcache/db'
// Unicité tenue par l'index de `users.username`, pas par une
// pré-vérification en lecture (course entre deux onboardings simultanés sur
// le même nom).
import { isUniqueViolation } from '@spellcache/db/errors'
import { setSignupMode } from '@/lib/site-settings'
// `usernameSchema` vit dans lib/username.ts, pas ici : un fichier
// `'use server'` ne peut exporter qu'une fonction async
// (contrainte de build Next.js) — voir le commentaire de lib/username.ts.
import { usernameSchema } from '@/lib/username'

const inviteEmailSchema = z.string().email()

// Invitation, avec la bascule Admin / Regular user : l'objet remplace la chaîne nue d'origine, `isAdmin` optionnel pour ne pas
// casser un appelant qui n'a pas encore d'avis sur le rôle.
const inviteInputSchema = z.object({
  email: inviteEmailSchema,
  isAdmin: z.boolean().optional(),
})

const userIdInputSchema = z.object({ userId: z.uuid() })

const setUserRoleInputSchema = z.object({
  userId: z.uuid(),
  isAdmin: z.boolean(),
})

export async function setUsernameAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'taken' | 'invalid' }> {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const parsed = usernameSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    await db
      .update(users)
      .set({ username: parsed.data })
      .where(eq(users.id, session.user.id))
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'taken' }
    throw error
  }

  return { ok: true }
}

export async function inviteUserAction(
  input: unknown,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: 'exists' | 'forbidden' | 'invalid' }
> {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: 'forbidden' }
    throw error
  }

  const parsed = inviteInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { email, isAdmin = false } = parsed.data

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (existing) return { ok: false, error: 'exists' }

  // Compte en attente : la ligne existe avant même que
  // l'invité ne suive le lien — l'onboarding (choix du username) se fait à
  // sa première connexion, comme n'importe quel autre compte.
  // Inviter dans une collection se fait depuis Settings › Collection
  // (`inviteMemberByEmailAction`) ; ici, le compte seul.
  const [created] = await db
    .insert(users)
    .values({ email, role: isAdmin ? 'admin' : 'member' })
    .returning({ id: users.id })
  if (!created) throw new Error('Failed to create invited account.')

  // `redirectTo` explicite (voir app/(public)/login/actions.ts) : sans lui,
  // le `callbackUrl` du lien envoyé à l'invité prendrait le `Referer` de
  // cette Server Action — `/settings/users`, une route admin — et
  // renverrait l'invité, simple `member`, sur un 403 plutôt que sur
  // l'onboarding de son compte fraîchement créé.
  await signIn('resend', { email, redirect: false, redirectTo: '/onboarding/username' })

  return { ok: true, userId: created.id }
}

export type SetUserRoleError = 'forbidden' | 'invalid' | 'self'

// Bascule Admin/Regular user d'un compte : refuse toujours
// l'auto-modification — un admin ne peut pas se rétrograder lui-même, ce
// qui laisserait potentiellement l'app sans administrateur (même piège que
// `lib/collections/members.ts`, invariant du dernier `owner`).
export async function setUserRoleAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: SetUserRoleError }> {
  const admin = await (async () => {
    try {
      return await requireAdmin()
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })()
  if (!admin) return { ok: false, error: 'forbidden' }

  const parsed = setUserRoleInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  if (parsed.data.userId === admin.id) return { ok: false, error: 'self' }

  await db
    .update(users)
    .set({ role: parsed.data.isAdmin ? 'admin' : 'member' })
    .where(eq(users.id, parsed.data.userId))

  return { ok: true }
}

export type DeleteUserError = 'forbidden' | 'invalid' | 'self' | 'owns_shared'

// Suppression définitive d'un compte : les cartes ajoutées à
// une collection partagée restent, `holdings`/`containers` ne portent
// aucune référence à `users` (docs/development.md — propriété exclusivement par
// `collection_members`) — seules les lignes propres au compte
// (`collection_members`, `accounts`, `sessions`, le journal
// `import_lists`) disparaissent en cascade avec lui (`packages/db/src/schema.ts`).
export async function deleteUserAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: DeleteUserError }> {
  const admin = await (async () => {
    try {
      return await requireAdmin()
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })()
  if (!admin) return { ok: false, error: 'forbidden' }

  const parsed = userIdInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  if (parsed.data.userId === admin.id) return { ok: false, error: 'self' }

  // Collections seul-membre supprimées avec le compte, refus s'il possède
  // une collection partagée (lib/accounts/delete-accounts.ts).
  const result = await deleteAccounts([parsed.data.userId])
  if (result.blocked.length > 0) return { ok: false, error: 'owns_shared' }

  return { ok: true }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirect: false })
  redirect('/login')
}

const signupModeInputSchema = z.object({ mode: z.enum(['invite', 'open']) })

// Réglage des inscriptions (Administration › Users) : `invite` (défaut) ou
// `open`. Réservé aux admins du site.
export async function setSignupModeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'invalid' }> {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: 'forbidden' }
    throw error
  }
  const parsed = signupModeInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  await setSignupMode(parsed.data.mode)
  return { ok: true }
}

const bulkAccountsInputSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(1000),
  op: z.enum(['make_admin', 'make_member', 'resend_invite', 'delete']),
})

export type BulkAccountsOp = z.infer<typeof bulkAccountsInputSchema>['op']

// Actions groupées d'Administration › Users (sélection multiple). Le compte
// de l'admin lui-même est toujours exclu des changements de rôle et de la
// suppression — même règle que `setUserRoleAction`/`deleteUserAction`, qui
// refusent l'auto-modification. Le renvoi d'invitation ne vise que les
// comptes en attente (sans username) : un compte actif se connecte seul.
export async function bulkAccountsAction(
  input: unknown,
): Promise<
  | { ok: true; affected: number; blocked: BlockedAccount[] }
  | { ok: false; error: 'forbidden' | 'invalid' }
> {
  const admin = await (async () => {
    try {
      return await requireAdmin()
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })()
  if (!admin) return { ok: false, error: 'forbidden' }

  const parsed = bulkAccountsInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const targetIds = parsed.data.userIds.filter((id) => id !== admin.id)
  if (targetIds.length === 0) return { ok: true, affected: 0, blocked: [] }

  switch (parsed.data.op) {
    case 'make_admin':
    case 'make_member': {
      const role = parsed.data.op === 'make_admin' ? 'admin' : 'member'
      const rows = await db
        .update(users)
        .set({ role })
        .where(inArray(users.id, targetIds))
        .returning({ id: users.id })
      return { ok: true, affected: rows.length, blocked: [] }
    }
    case 'delete': {
      const result = await deleteAccounts(targetIds)
      return { ok: true, affected: result.deleted, blocked: result.blocked }
    }
    case 'resend_invite': {
      const pending = await db
        .select({ email: users.email })
        .from(users)
        .where(and(inArray(users.id, targetIds), isNull(users.username)))
      for (const { email } of pending) {
        await signIn('resend', { email, redirect: false, redirectTo: '/onboarding/username' })
      }
      return { ok: true, affected: pending.length, blocked: [] }
    }
  }
}
