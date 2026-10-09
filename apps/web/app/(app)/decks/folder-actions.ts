'use server'

// Mutations des dossiers de decks : création de dossier, renommage,
// suppression, déplacement d'un deck, réordonnancement. Toute entrée
// externe est validée par un schéma Zod à
// la frontière, jamais castée (docs/development.md) ; toute autorisation passe par
// `collection_members`, jamais par un second chemin — un `folderId` ou un
// `deckId` d'URL ne doit jamais toucher le dossier ou le deck d'une autre
// collection.
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { collectionMembers, containers, deckFolders } from '@spellcache/db/schema'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { requireCollectionAccess, requireContainerAccess } from '@/lib/collections/authorize'
import { requireSession } from '@/lib/auth-guards'
import { db } from '@spellcache/db'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const folderNameSchema = z.string().trim().min(1).max(80)

const createFolderSchema = z.object({ name: folderNameSchema })
const renameFolderSchema = z.object({ folderId: z.uuid(), name: folderNameSchema })
const deleteFolderSchema = z.object({ folderId: z.uuid() })
// `folderId: null` = retour dans `Unsorted` — `nullable`,
// jamais optionnel : l'absence de clé et un déplacement explicite vers
// `Unsorted` ne doivent pas se confondre.
const moveDeckSchema = z.object({ deckId: z.uuid(), folderId: z.uuid().nullable() })
const reorderFoldersSchema = z.object({ folderIds: z.array(z.uuid()).min(1) })

// Collection du compte courant. `bootstrapCollection` est idempotent et
// reste le seul moyen d'obtenir le `collectionId`, absent de `SessionUser` —
// même patron que `createDeckAction`.
async function currentCollection(): Promise<{ userId: string; collectionId: string }> {
  const user = await requireSession()
  const { collectionId } = await bootstrapCollection(user.id, {
    username: user.username,
    displayName: null,
  })
  // Toutes les actions de ce fichier écrivent : un `viewer` est refusé.
  await requireCollectionAccess(user.id, collectionId, 'write')
  return { userId: user.id, collectionId }
}

// Un dossier n'est atteignable que depuis la collection dont le compte est
// membre : la jointure sur `collection_members` est la garde, pas un filtre
// de confort. Renvoie `null` plutôt que de lever — l'appelant en fait une
// erreur de résultat, comme le reste des Server Actions du projet.
async function ownedFolder(userId: string, folderId: string): Promise<{ collectionId: string } | null> {
  const [row] = await db
    .select({ collectionId: deckFolders.collectionId })
    .from(deckFolders)
    .innerJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, deckFolders.collectionId),
        eq(collectionMembers.userId, userId),
        // Lecture seule : un `viewer` ne touche à aucun dossier.
        ne(collectionMembers.role, 'viewer'),
      ),
    )
    .where(eq(deckFolders.id, folderId))
    .limit(1)

  return row ?? null
}

export async function createFolderAction(
  input: unknown,
): Promise<ActionResult<{ folderId: string }>> {
  const parsed = createFolderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const { collectionId } = await currentCollection()

  // Le dossier naît vide et en fin de liste (son étagère ne contient que la
  // tuile `New deck`) — `position` calculée en base dans la même
  // instruction, jamais lue puis réécrite en deux allers-retours (deux
  // créations concurrentes s'y partageraient la même valeur).
  const [created] = await db
    .insert(deckFolders)
    .values({
      collectionId,
      name: parsed.data.name,
      position: sql`(
        select coalesce(max(f.position), -1) + 1
        from ${deckFolders} f
        where f.collection_id = ${collectionId}
      )`,
    })
    .returning({ id: deckFolders.id })

  if (!created) return { ok: false, error: 'failed' }
  return { ok: true, folderId: created.id }
}

export async function renameFolderAction(input: unknown): Promise<ActionResult> {
  const parsed = renameFolderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const folder = await ownedFolder(user.id, parsed.data.folderId)
  if (!folder) return { ok: false, error: 'not found' }

  await db
    .update(deckFolders)
    .set({ name: parsed.data.name })
    .where(eq(deckFolders.id, parsed.data.folderId))

  return { ok: true }
}

// Supprimer un dossier laisse ses decks intacts, `folder_id` à `null`, donc
// dans `Unsorted` : c'est la contrainte
// `ON DELETE SET NULL` de `containers.folder_id` (packages/db/src/schema.ts) qui le
// garantit en base, pas une seconde écriture applicative qui pourrait
// diverger. Aucun deck n'est jamais supprimé ici — les données utilisateur
// sont irremplaçables (docs/development.md).
export async function deleteFolderAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteFolderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const folder = await ownedFolder(user.id, parsed.data.folderId)
  if (!folder) return { ok: false, error: 'not found' }

  await db.delete(deckFolders).where(eq(deckFolders.id, parsed.data.folderId))
  return { ok: true }
}

export async function moveDeckToFolderAction(input: unknown): Promise<ActionResult> {
  const parsed = moveDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  // Accès au deck par le chemin unique du projet (`lib/collections/authorize.ts`)
  // — il renvoie la collection du container, dont le dossier cible doit
  // relever aussi : sans cette seconde vérification, un `folderId` d'une
  // autre collection rangerait un deck hors de la sienne (un deck reste dans
  // un seul dossier, jamais deux).
  const access = await requireContainerAccess(user.id, parsed.data.deckId, 'write').catch(() => null)
  if (!access) return { ok: false, error: 'not found' }

  if (parsed.data.folderId !== null) {
    const folder = await ownedFolder(user.id, parsed.data.folderId)
    if (!folder || folder.collectionId !== access.collectionId) {
      return { ok: false, error: 'not found' }
    }
  }

  // `kind = 'deck'` dans le `where` : seul un deck porte un dossier — un
  // `containerId` de binder ou de liste, pourtant
  // accessible au même compte, ne doit pas se retrouver rangé dans une
  // étagère de l'onglet Decks.
  const updated = await db
    .update(containers)
    .set({ folderId: parsed.data.folderId })
    .where(and(eq(containers.id, parsed.data.deckId), eq(containers.kind, 'deck')))
    .returning({ id: containers.id })

  if (updated.length === 0) return { ok: false, error: 'not found' }
  return { ok: true }
}

// `position` est réécrite pour **tous** les dossiers de la collection (sinon
// deux dossiers finissent avec la même valeur), dans
// une seule transaction. L'ordre reçu doit donc couvrir exactement les
// dossiers de la collection : un ordre partiel, ou qui contient un dossier
// d'une autre collection, est rejeté plutôt que d'écrire un classement
// incohérent.
export async function reorderFoldersAction(input: unknown): Promise<ActionResult> {
  const parsed = reorderFoldersSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const { folderIds } = parsed.data
  if (new Set(folderIds).size !== folderIds.length) return { ok: false, error: 'invalid' }

  const { collectionId } = await currentCollection()

  const owned = await db
    .select({ id: deckFolders.id })
    .from(deckFolders)
    .where(eq(deckFolders.collectionId, collectionId))

  const ownedIds = new Set(owned.map((row) => row.id))
  if (ownedIds.size !== folderIds.length || folderIds.some((id) => !ownedIds.has(id))) {
    return { ok: false, error: 'invalid' }
  }

  await db.transaction(async (tx) => {
    for (const [position, id] of folderIds.entries()) {
      await tx
        .update(deckFolders)
        .set({ position })
        .where(and(eq(deckFolders.id, id), eq(deckFolders.collectionId, collectionId)))
    }
  })

  return { ok: true }
}

// Utilisé par la feuille `Move to folder…` du menu contextuel : la liste des
// dossiers de la collection, dans l'ordre de
// l'utilisateur, sans les decks — la vue étagères a déjà les siens, mais
// l'écran `See all` d'un dossier n'en a pas.
export async function listFoldersAction(): Promise<
  ActionResult<{ folders: Array<{ id: string; name: string }> }>
> {
  const { collectionId } = await currentCollection()
  const rows = await db
    .select({ id: deckFolders.id, name: deckFolders.name })
    .from(deckFolders)
    .where(eq(deckFolders.collectionId, collectionId))
    .orderBy(deckFolders.position)

  return { ok: true, folders: rows }
}
