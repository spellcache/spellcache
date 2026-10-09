// Suppression de comptes (Administration › Users, unitaire ou groupée).
//
// Une collection n'appartient à personne en propre : la supprimer avec son
// compte, ou la laisser vivre, dépend de qui d'autre y est.
//   - Compte seul membre d'une collection : la collection part avec lui
//     (cartes, binders, decks) — sinon elle resterait sans aucun membre,
//     donc inaccessible pour toujours.
//   - Compte owner d'une collection qui a d'autres membres : suppression
//     refusée — l'owner doit d'abord transférer la propriété (Settings ›
//     Collection), sinon des membres perdraient leur collection, ou elle
//     resterait sans owner pour la gérer.
//   - Compte simple membre (contributor, guest) : son adhésion part en
//     cascade, la collection reste.
import { and, eq, inArray, sql } from 'drizzle-orm'

import { collectionMembers, collections, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export interface BlockedAccount {
  userId: string
  // username, ou email pour un compte encore en attente.
  label: string
  // Collections partagées qu'il possède encore.
  collections: string[]
}

export async function deleteAccounts(
  userIds: string[],
): Promise<{ deleted: number; blocked: BlockedAccount[] }> {
  if (userIds.length === 0) return { deleted: 0, blocked: [] }

  return db.transaction(async (tx) => {
    // Collections possédées par un compte visé et qui comptent au moins un
    // autre membre : elles bloquent la suppression de leur owner.
    const shared = await tx
      .select({
        userId: collectionMembers.userId,
        username: users.username,
        email: users.email,
        collectionName: collections.name,
      })
      .from(collectionMembers)
      .innerJoin(users, eq(users.id, collectionMembers.userId))
      .innerJoin(collections, eq(collections.id, collectionMembers.collectionId))
      .where(
        and(
          inArray(collectionMembers.userId, userIds),
          eq(collectionMembers.role, 'owner'),
          sql`exists (
            select 1 from ${collectionMembers} other
            where other.collection_id = ${collectionMembers.collectionId}
              and other.user_id <> ${collectionMembers.userId}
          )`,
        ),
      )

    const blockedById = new Map<string, BlockedAccount>()
    for (const row of shared) {
      const entry = blockedById.get(row.userId) ?? {
        userId: row.userId,
        label: row.username ?? row.email,
        collections: [],
      }
      entry.collections.push(row.collectionName)
      blockedById.set(row.userId, entry)
    }
    const deletable = userIds.filter((id) => !blockedById.has(id))
    if (deletable.length === 0) return { deleted: 0, blocked: [...blockedById.values()] }

    // Collections dont un compte supprimé est le seul membre : supprimées
    // avec lui (cascade sur containers, holdings, dossiers).
    const solo = await tx
      .select({ collectionId: collectionMembers.collectionId })
      .from(collectionMembers)
      .where(
        and(
          inArray(collectionMembers.userId, deletable),
          sql`not exists (
            select 1 from ${collectionMembers} other
            where other.collection_id = ${collectionMembers.collectionId}
              and other.user_id <> ${collectionMembers.userId}
          )`,
        ),
      )
    if (solo.length > 0) {
      await tx.delete(collections).where(
        inArray(
          collections.id,
          solo.map((row) => row.collectionId),
        ),
      )
    }

    const removed = await tx
      .delete(users)
      .where(inArray(users.id, deletable))
      .returning({ id: users.id })

    return { deleted: removed.length, blocked: [...blockedById.values()] }
  })
}

// Les collections laissées sans aucun membre par des suppressions d'avant
// cette règle : inaccessibles, à nettoyer une fois.
export async function deleteOrphanCollections(): Promise<number> {
  const removed = await db
    .delete(collections)
    .where(
      sql`not exists (select 1 from ${collectionMembers} m where m.collection_id = ${collections.id})`,
    )
    .returning({ id: collections.id })
  return removed.length
}
