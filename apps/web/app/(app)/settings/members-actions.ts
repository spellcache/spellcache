'use server'

// Server Actions de gestion des membres.
// Toute entrée externe validée par Zod à la frontière (docs/development.md) avant de
// toucher `lib/collections/members.ts`.
import { z } from 'zod'

import { ContainerAccessError } from '@/lib/collections/authorize'
import {
  addMember,
  changeMemberRole,
  inviteMemberByEmail,
  leaveCollection,
  listMemberCandidates,
  removeMember,
  transferOwnership,
  type MemberCandidate,
  type MemberRow,
} from '@/lib/collections/members'
import { signIn } from '@/lib/auth'
import { requireSession } from '@/lib/auth-guards'
import { rateLimit } from '@/lib/redis'
import { getSignupMode } from '@/lib/site-settings'
import { usernameSchema } from '@/lib/username'

// Un seul `owner` par collection (décision produit) : un ajout ou un
// changement de rôle n'attribue que `editor` ou `viewer` ; la propriété ne
// se déplace que par `transferOwnershipAction`.
const memberRoleSchema = z.enum(['editor', 'viewer'])

const addMemberInputSchema = z.object({
  collectionId: z.uuid(),
  username: usernameSchema,
  role: memberRoleSchema.optional(),
})

const memberTargetInputSchema = z.object({
  collectionId: z.uuid(),
  targetUserId: z.uuid(),
})

const changeMemberRoleInputSchema = z.object({
  collectionId: z.uuid(),
  targetUserId: z.uuid(),
  role: memberRoleSchema,
})

const collectionIdInputSchema = z.object({
  collectionId: z.uuid(),
})

export type MemberActionError =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'already_member'
  | 'last_owner'
  | 'signup_closed'
  | 'rate_limited'

export async function addMemberAction(
  input: unknown,
): Promise<{ ok: true; member: MemberRow } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = addMemberInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const result = await addMember(
      session.id,
      parsed.data.collectionId,
      parsed.data.username,
      parsed.data.role,
    )
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, member: result.member }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

export async function removeMemberAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = memberTargetInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const result = await removeMember(session.id, parsed.data.collectionId, parsed.data.targetUserId)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

export async function changeMemberRoleAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = changeMemberRoleInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const result = await changeMemberRole(
      session.id,
      parsed.data.collectionId,
      parsed.data.targetUserId,
      parsed.data.role,
    )
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

// Transfert de propriété : promotion de la cible puis rétro-
// gradation de l'appelant dans une seule transaction — voir
// `lib/collections/members.ts`, `transferOwnership`.
export async function transferOwnershipAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = memberTargetInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const result = await transferOwnership(session.id, parsed.data.collectionId, parsed.data.targetUserId)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

// Départ volontaire : réservé à aucun rôle particulier — c'est
// l'appelant qui se retire lui-même (`requireSession` fournit déjà son id,
// jamais un `targetUserId` fourni par le client).
export async function leaveCollectionAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = collectionIdInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const result = await leaveCollection(session.id, parsed.data.collectionId)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

// Combobox « Add a member » : liste complète des comptes libres, filtrée côté
// client à la frappe — un seul aller-retour serveur, pas une requête par
// caractère tapé.
export async function memberCandidatesAction(
  input: unknown,
): Promise<{ ok: true; candidates: MemberCandidate[] } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = collectionIdInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    const candidates = await listMemberCandidates(session.id, parsed.data.collectionId)
    return { ok: true, candidates }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

const inviteMemberInputSchema = z.object({
  collectionId: z.uuid(),
  email: z.string().trim().toLowerCase().email(),
  role: memberRoleSchema.optional(),
})

// Inviter par email (Settings › Collection, owner seulement). Un compte créé
// pour l'occasion reçoit son lien magique — même `redirectTo` que
// l'invitation d'Administration › Users (app/(app)/settings/actions.ts).
export async function inviteMemberByEmailAction(
  input: unknown,
): Promise<{ ok: true; member: MemberRow; created: boolean } | { ok: false; error: MemberActionError }> {
  const session = await requireSession()

  const parsed = inviteMemberInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  // Chaque invitation peut envoyer un email : plafond par compte, pour que
  // l'action ne serve pas de relais de spam.
  if (!(await rateLimit(`ratelimit:invite:${session.id}`, 20, 3600))) {
    return { ok: false, error: 'rate_limited' }
  }

  try {
    const allowAccountCreation = session.role === 'admin' || (await getSignupMode()) === 'open'
    const result = await inviteMemberByEmail(
      session.id,
      parsed.data.collectionId,
      parsed.data.email,
      parsed.data.role,
      { allowAccountCreation },
    )
    if (!result.ok) return { ok: false, error: result.error }
    if (result.created) {
      await signIn('resend', {
        email: parsed.data.email,
        redirect: false,
        redirectTo: '/onboarding/username',
      })
    }
    return result
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}
