// Création automatique de la collection à la première connexion. Appelée
// depuis `requireSession()`
// (lib/auth-guards.ts) : chaque route pleine garantit donc qu'un compte
// membre d'aucune collection en reçoit une avant de continuer.
//
// Multi-collection : un compte peut être membre de plusieurs collections.
// `bootstrapCollection` renvoie sa collection ACTIVE (lib/collections/active.ts)
// — c'est elle que les appelants désignent par « ma collection » — et n'en
// crée une que s'il n'est membre de rien (premier login, ou après avoir
// quitté sa dernière collection). Un compte invité directement dans une
// collection n'en reçoit donc pas de seconde à sa première connexion.
import { and, eq, sql } from 'drizzle-orm'

import { collectionMembers, collections, containers } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { getActiveCollectionId } from '@/lib/collections/active'
import { recomputeContainerStats } from '@/lib/containers/stats'

export interface BootstrapResult {
  collectionId: string
  containerId: string
  created: boolean
}

export interface AccountIdentity {
  username: string
  displayName: string | null
}

// `displayName` peut rester vide (nullable en base) : on retombe sur
// `username`, toujours défini à ce point —
// `requireSession()` a déjà garanti l'onboarding fait — plutôt que de nommer
// la collection « null collection ».
export function collectionName(identity: AccountIdentity): string {
  return `${identity.displayName ?? identity.username} collection`
}

type Executor = Pick<typeof db, 'select'>

async function rootContainerOf(executor: Executor, collectionId: string): Promise<string> {
  const [root] = await executor
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')))
    .limit(1)
  // Le container racine est créé dans la même transaction que la collection
  // (`createCollection`) : il ne peut manquer hors corruption de données.
  if (!root) throw new Error(`Collection ${collectionId} has no root container.`)
  return root.id
}

async function readExisting(userId: string): Promise<BootstrapResult | null> {
  const collectionId = await getActiveCollectionId(userId)
  if (!collectionId) return null
  return { collectionId, containerId: await rootContainerOf(db, collectionId), created: false }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Collection neuve dont `userId` est `owner` : la collection, l'adhésion, le
// container racine et sa ligne `container_stats` dans la transaction fournie
// — jamais une collection sans racine. Partagée par le premier login et par
// « New collection » (Settings).
export async function createCollection(
  tx: Tx,
  userId: string,
  name: string,
): Promise<{ collectionId: string; containerId: string }> {
  const [collection] = await tx
    .insert(collections)
    .values({ name })
    .returning({ id: collections.id })
  if (!collection) throw new Error('Failed to create collection.')

  await tx.insert(collectionMembers).values({ collectionId: collection.id, userId, role: 'owner' })

  const [root] = await tx
    .insert(containers)
    .values({ collectionId: collection.id, kind: 'collection', name })
    .returning({ id: containers.id })
  if (!root) throw new Error('Failed to create root container.')

  // Une ligne `container_stats` dès la création (le bandeau
  // de valeur lit une ligne, il ne l'agrège jamais).
  await recomputeContainerStats(root.id, tx)

  return { collectionId: collection.id, containerId: root.id }
}

export async function bootstrapCollection(
  userId: string,
  identity: AccountIdentity,
): Promise<BootstrapResult> {
  const existing = await readExisting(userId)
  if (existing) return existing

  return db.transaction(async (tx) => {
    // Course de la première connexion (préchargement du routeur, double
    // onglet) : deux requêtes simultanées du même compte ne doivent pas
    // créer deux collections. L'index unique « un compte, une collection »
    // qui la tranchait n'existe plus (multi-collection) : un verrou
    // consultatif par compte sérialise les créations, et la seconde relit
    // l'adhésion que la première vient de valider.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bootstrap:${userId}`}))`)

    const [membership] = await tx
      .select({ collectionId: collectionMembers.collectionId })
      .from(collectionMembers)
      .where(eq(collectionMembers.userId, userId))
      .limit(1)
    if (membership) {
      const collectionId = (await getActiveCollectionId(userId)) ?? membership.collectionId
      return { collectionId, containerId: await rootContainerOf(tx, collectionId), created: false }
    }

    const created = await createCollection(tx, userId, collectionName(identity))
    return { ...created, created: true }
  })
}
