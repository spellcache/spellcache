// Lecture Administration › Users : un compte, son rôle, et la
// collection qu'il occupe le cas échéant — même patron que
// `../settings-data.ts`, une page serveur reste mince, la requête vit ici.
import { and, asc, eq, sql } from 'drizzle-orm'

import { collectionMembers, collections, users, type MemberRole, type UserRole } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { activeCollectionIdSql } from '@/lib/collections/active'

export interface AdminAccountRow {
  id: string
  // `null` pour un compte invité qui n'a pas encore terminé l'onboarding.
  username: string | null
  email: string
  role: UserRole
  createdAt: Date
  // `null` : le compte n'appartient encore à aucune collection (affiché
  // « Collection … "None yet" »).
  collection: { id: string; name: string; role: MemberRole } | null
}

export async function listAdminAccounts(): Promise<AdminAccountRow[]> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      collectionId: collections.id,
      collectionName: collections.name,
      collectionRole: collectionMembers.role,
    })
    .from(users)
    // Multi-collection : une ligne par compte, sa collection active.
    .leftJoin(
      collectionMembers,
      and(
        eq(collectionMembers.userId, users.id),
        sql`${collectionMembers.collectionId} = ${activeCollectionIdSql(sql`${users.id}`)}`,
      ),
    )
    .leftJoin(collections, eq(collections.id, collectionMembers.collectionId))
    .orderBy(asc(users.createdAt))

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    collection:
      row.collectionId && row.collectionName
        ? { id: row.collectionId, name: row.collectionName, role: row.collectionRole! }
        : null,
  }))
}
