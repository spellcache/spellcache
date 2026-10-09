// Lecture de l'écran Settings : préférences, collection
// et ses membres, compte de comptes (Administration, admin seulement) —
// même patron que `collection-data.ts`/`holdings-data.ts`, une page
// serveur reste mince, la requête vit ici.
import { eq, sql } from 'drizzle-orm'

import { collectionMembers, collections, users, type MemberRole, type UserRole } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { activeMembershipOf, listMyCollections, type MyCollection } from '@/lib/collections/active'
import { listMembers, type MemberRow } from '@/lib/collections/members'
import { getPreferences, type Preferences } from '@/lib/preferences'

export interface SettingsData {
  username: string
  siteRole: UserRole
  preferences: Preferences
  collection: { id: string; name: string; role: MemberRole }
  // Toutes les collections du compte (multi-collection), l'active cochée.
  collections: MyCollection[]
  members: MemberRow[]
  // `null` pour un compte `member` : le groupe Administration ne se rend
  // même pas (garde d'affichage, la garde
  // serveur vit dans les Server Actions elles-mêmes).
  accountCount: number | null
}

export async function getSettingsData(userId: string): Promise<SettingsData> {
  const [root] = await db
    .select({
      username: users.username,
      siteRole: users.role,
      collectionId: collectionMembers.collectionId,
      collectionName: collections.name,
      collectionRole: collectionMembers.role,
    })
    .from(collectionMembers)
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .innerJoin(collections, eq(collections.id, collectionMembers.collectionId))
    .where(activeMembershipOf(userId))
    .limit(1)

  // `requireSession()` (lib/auth-guards.ts) appelle `bootstrapCollection`
  // avant tout accès à cet écran : un compte
  // qui atteint cette page est nécessairement déjà membre d'une collection.
  if (!root) throw new Error(`User ${userId} has no collection.`)

  const [preferences, members, accountCount, myCollections] = await Promise.all([
    getPreferences(userId),
    listMembers(userId, root.collectionId),
    root.siteRole === 'admin' ? countAccounts() : Promise.resolve(null),
    listMyCollections(userId),
  ])

  return {
    username: root.username ?? '',
    siteRole: root.siteRole,
    preferences,
    collection: { id: root.collectionId, name: root.collectionName, role: root.collectionRole },
    collections: myCollections,
    members,
    accountCount,
  }
}

async function countAccounts(): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(users)
  return row?.total ?? 0
}
