// Renommage de la collection (depuis la ligne de nom de collection dans
// Settings), réservé à l'`owner` — même piège que
// `lib/collections/members.ts` : sans cette restriction, un `editor` pourrait
// renommer la collection alors que l'interface ne lui montre même pas la
// ligne comme un bouton (le badge `Owner` est un rôle, pas un bouton).
// Toujours au travers de `collection_members`, la seule
// source d'autorisation (docs/development.md).
import { eq } from 'drizzle-orm'

import { collections } from '@spellcache/db/schema'
import { ContainerAccessError, resolveCollectionAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'

export async function renameCollection(
  userId: string,
  collectionId: string,
  name: string,
): Promise<void> {
  const access = await resolveCollectionAccess(userId, collectionId)
  if (!access || access.role !== 'owner') {
    throw new ContainerAccessError(`User ${userId} cannot rename collection ${collectionId}.`)
  }

  await db.update(collections).set({ name }).where(eq(collections.id, collectionId))
}
