// Collection active d'un compte (multi-collection). Un compte peut être
// membre de plusieurs collections ; tous les écrans « de ma collection »
// (accueil, decks, Settings, barre latérale) lisent celle-ci. Une seule
// définition, en SQL composable, pour qu'aucun écran ne recalcule sa propre
// règle de repli.
//
// Règle : `users.active_collection_id` s'il est encore membre de cette
// collection ; sinon sa première adhésion — une collection qu'il possède
// d'abord, puis la plus ancienne. Jamais un chemin d'autorisation : l'accès
// à un container passe toujours par `collection_members`
// (lib/collections/authorize.ts).
import { and, eq, sql, type SQL } from 'drizzle-orm'

import { collectionMembers, collections, users, type MemberRole } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export function activeCollectionIdSql(userIdExpr: SQL): SQL {
  return sql`(
    select coalesce(
      (
        select u.active_collection_id
        from users u
        join collection_members m
          on m.collection_id = u.active_collection_id and m.user_id = u.id
        where u.id = ${userIdExpr}
      ),
      (
        select m.collection_id
        from collection_members m
        where m.user_id = ${userIdExpr}
        order by (m.role = 'owner') desc, m.added_at asc, m.collection_id asc
        limit 1
      )
    )
  )`
}

// `null` : le compte n'est membre d'aucune collection.
export async function getActiveCollectionId(userId: string): Promise<string | null> {
  const { rows } = await db.execute<{ id: string | null }>(
    sql`select ${activeCollectionIdSql(sql`${userId}::uuid`)} as id`,
  )
  return rows[0]?.id ?? null
}

// Condition à poser sur une requête qui part de `collection_members` pour
// lire « la collection de ce compte » : sa ligne d'adhésion, restreinte à sa
// collection active. Remplace l'ancien `where user_id = $1 limit 1`, qui
// supposait une seule adhésion par compte.
export function activeMembershipOf(userId: string): SQL {
  return and(
    eq(collectionMembers.userId, userId),
    sql`${collectionMembers.collectionId} = ${activeCollectionIdSql(sql`${userId}::uuid`)}`,
  )!
}

export interface MyCollection {
  id: string
  name: string
  role: MemberRole
  active: boolean
}

// Toutes les collections dont le compte est membre, la sienne d'abord puis
// par ancienneté d'adhésion — le même ordre que le repli de
// `activeCollectionIdSql`.
export async function listMyCollections(userId: string): Promise<MyCollection[]> {
  const activeId = await getActiveCollectionId(userId)
  const rows = await db
    .select({ id: collections.id, name: collections.name, role: collectionMembers.role })
    .from(collectionMembers)
    .innerJoin(collections, eq(collections.id, collectionMembers.collectionId))
    .where(eq(collectionMembers.userId, userId))
    .orderBy(sql`(${collectionMembers.role} = 'owner') desc`, collectionMembers.addedAt)
  return rows.map((row) => ({ ...row, active: row.id === activeId }))
}

// Bascule de collection affichée : n'écrit que si le compte en est membre —
// la préférence ne donne jamais accès à une collection, elle choisit
// seulement parmi celles que `collection_members` autorise déjà.
export async function setActiveCollection(userId: string, collectionId: string): Promise<boolean> {
  const [membership] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(and(eq(collectionMembers.userId, userId), eq(collectionMembers.collectionId, collectionId)))
    .limit(1)
  if (!membership) return false
  await db.update(users).set({ activeCollectionId: collectionId }).where(eq(users.id, userId))
  return true
}
