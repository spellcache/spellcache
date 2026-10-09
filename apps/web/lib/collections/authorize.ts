// Couche d'autorisation unique : toute lecture et toute
// écriture sur un container ou un holding passe par `resolveAccess` /
// `requireContainerAccess`. Un chemin parallèle (ex. un `container.userId`
// de confort) créerait deux vérités — `collection_members` est la seule
// source, toute requête jointe passe par `collection_id`.
import { and, eq } from 'drizzle-orm'

import { collectionMembers, containers, type MemberRole } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export interface Access {
  collectionId: string
  role: MemberRole
}

export class ContainerAccessError extends Error {}

// Résout l'accès d'un compte à un container en joignant sur `collection_id`.
export async function resolveAccess(userId: string, containerId: string): Promise<Access | null> {
  const [row] = await db
    .select({ collectionId: containers.collectionId, role: collectionMembers.role })
    .from(containers)
    .innerJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, containers.collectionId),
        eq(collectionMembers.userId, userId),
      ),
    )
    .where(eq(containers.id, containerId))
    .limit(1)

  return row ?? null
}

// `need` : lecture ou écriture. `owner` et `editor` ont un accès complet en
// lecture et en écriture à tout le contenu de la collection ; `viewer` lit
// tout et n'écrit rien — c'est ici, et seulement ici, que la lecture seule
// est garantie : chaque mutation déclare `'write'`. La gestion des membres
// reste réservée à l'`owner` (lib/collections/members.ts).
export function canWrite(role: MemberRole): boolean {
  return role !== 'viewer'
}

function assertNeed(access: Access, need: 'read' | 'write', userId: string, target: string): void {
  if (need === 'write' && !canWrite(access.role)) {
    throw new ContainerAccessError(`User ${userId} has read-only access to ${target}.`)
  }
}

export async function requireContainerAccess(
  userId: string,
  containerId: string,
  need: 'read' | 'write' = 'read',
): Promise<Access> {
  const access = await resolveAccess(userId, containerId)
  if (!access) {
    throw new ContainerAccessError(`User ${userId} has no access to container ${containerId}.`)
  }
  assertNeed(access, need, userId, `container ${containerId}`)
  return access
}

// Même résolution, à la granularité de la collection plutôt que du
// container : nécessaire pour créer le tout premier container d'une
// collection (aucun `containerId` n'existe encore). Toujours au travers de
// `collection_members`, la même source unique — pas un second chemin.
export async function resolveCollectionAccess(
  userId: string,
  collectionId: string,
): Promise<Access | null> {
  const [row] = await db
    .select({ collectionId: collectionMembers.collectionId, role: collectionMembers.role })
    .from(collectionMembers)
    .where(
      and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, userId)),
    )
    .limit(1)

  return row ?? null
}

export async function requireCollectionAccess(
  userId: string,
  collectionId: string,
  need: 'read' | 'write' = 'read',
): Promise<Access> {
  const access = await resolveCollectionAccess(userId, collectionId)
  if (!access) {
    throw new ContainerAccessError(`User ${userId} has no access to collection ${collectionId}.`)
  }
  assertNeed(access, need, userId, `collection ${collectionId}`)
  return access
}
