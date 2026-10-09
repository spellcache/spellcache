// CRUD de container, arbre par collection. Toute lecture et toute écriture
// passent par `lib/collections/authorize.ts` — le seul chemin d'autorisation
// (docs/development.md), jamais un `container.userId` de confort.
//
// Toute suppression de données utilisateur porte un `undoToken` :
// `deleteContainer`/`restoreContainer` reprennent donc exactement le patron
// de `removeHoldings`/`restoreHoldings` (fenêtre de 6 secondes, jeton en
// mémoire). Les écrans et flux qui déclenchent cette suppression vivent
// ailleurs — seule la fonction est définie ici.
import { randomUUID } from 'node:crypto'

import { and, asc, eq } from 'drizzle-orm'

import {
  containers,
  holdings,
  type Container,
  type ContainerKind,
  type DeckState,
  type Holding,
  type Visibility,
} from '@spellcache/db/schema'
import { requireCollectionAccess, requireContainerAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'

import { recomputeContainerStats } from './stats'

export interface CreateContainerInput {
  kind: ContainerKind
  name: string
  coverCardId?: string | null
  coverGradient?: string | null
  sortOrder?: number
  // `deckState`/`format` : optionnelles — seule la création d'un
  // `kind: 'deck'` les renseigne ; tout autre `kind` les laisse `null`.
  deckState?: DeckState | null
  format?: string | null
}

export interface UpdateContainerPatch {
  name?: string
  // Notes libres d'un deck, éditées par son onglet `Infos`.
  description?: string
  coverCardId?: string | null
  coverGradient?: string | null
  coverIntensity?: string
  sortOrder?: number
  // Format libre d'un deck (feuille `Edit deck`) — même colonne texte que
  // `CreateContainerInput.format` ci-dessus, jamais contrainte aux sept
  // formats connus de `lib/decks/legality.ts` : un format hors de cette liste
  // retombe simplement sur `noFormat` pour la légalité (voir `isDeckFormat`,
  // lu par les appelants), sans empêcher de le taper et de l'afficher tel
  // quel.
  format?: string | null
}

export interface DeleteContainerResult {
  removed: boolean
  undoToken: string
}

export interface RestoreContainerResult {
  restored: boolean
}

export async function createContainer(
  userId: string,
  collectionId: string,
  input: CreateContainerInput,
): Promise<Container> {
  await requireCollectionAccess(userId, collectionId, 'write')

  const [created] = await db
    .insert(containers)
    .values({
      collectionId,
      kind: input.kind,
      name: input.name,
      coverCardId: input.coverCardId ?? null,
      coverGradient: input.coverGradient ?? null,
      sortOrder: input.sortOrder ?? 0,
      deckState: input.deckState ?? null,
      format: input.format ?? null,
    })
    .returning()
  if (!created) throw new Error('Failed to create container.')

  // Une ligne `container_stats` doit exister dès la création (le bandeau de
  // valeur lit une ligne, il ne l'agrège jamais) —
  // sans elle un container neuf n'a aucune ligne avant sa première mutation
  // de holding. `recomputeContainerStats` sur un container sans holding
  // insère une ligne à zéro (agrégat vide), pas une erreur.
  await recomputeContainerStats(created.id)

  return created
}

export async function getContainer(userId: string, containerId: string): Promise<Container> {
  await requireContainerAccess(userId, containerId, 'read')

  const [row] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  if (!row) throw new Error(`Container ${containerId} not found.`)
  return row
}

// « Arbre par collection » : pas de hiérarchie de containers au-delà du
// container racine (les binders/decks/lists n'ont pas de parent dans ce
// schéma, seulement une `collectionId` commune — `folderId`, posé à `null`
// ici, est le lien vers un dossier de decks). La liste triée par collection
// est donc l'arbre.
export async function listContainers(
  userId: string,
  collectionId: string,
  kind?: ContainerKind,
): Promise<Container[]> {
  await requireCollectionAccess(userId, collectionId, 'read')

  const rows = await db
    .select()
    .from(containers)
    .where(eq(containers.collectionId, collectionId))
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))

  return kind ? rows.filter((row) => row.kind === kind) : rows
}

export async function updateContainer(
  userId: string,
  containerId: string,
  patch: UpdateContainerPatch,
): Promise<Container> {
  await requireContainerAccess(userId, containerId, 'write')

  const [updated] = await db
    .update(containers)
    .set(patch)
    .where(eq(containers.id, containerId))
    .returning()
  if (!updated) throw new Error(`Container ${containerId} not found.`)
  return updated
}

// Jeton d'annulation en mémoire, même patron que
// `lib/containers/holdings.ts` : fenêtre de
// 6 secondes, singleton de process — pas de survie à un redémarrage ni de
// partage entre plusieurs instances. `docker-compose.yml` ne provisionne pas
// de Redis pour le profil `test`, ce qui rendrait la vérification par
// intégration impossible sans base éphémère supplémentaire.
const UNDO_TTL_MS = 6_000

interface ContainerUndoEntry {
  userId: string
  container: Container
  holdings: Holding[]
  expiresAt: number
}

declare global {
  var __spellcacheContainersUndo: Map<string, ContainerUndoEntry> | undefined
}

function undoStore(): Map<string, ContainerUndoEntry> {
  if (!globalThis.__spellcacheContainersUndo) {
    globalThis.__spellcacheContainersUndo = new Map()
  }
  return globalThis.__spellcacheContainersUndo
}

// Supprime un container et, par cascade FK, ses holdings (`onDelete:
// 'cascade'` sur `containers → holdings`) et sa ligne `container_stats`. Le
// container racine (`kind === 'collection'`) est protégé : le supprimer
// casserait l'invariant posé par `bootstrapCollection` (une collection a
// toujours un container racine).
export async function deleteContainer(
  userId: string,
  containerId: string,
): Promise<DeleteContainerResult> {
  await requireContainerAccess(userId, containerId, 'write')

  // `requireContainerAccess` a déjà résolu l'accès en joignant sur ce
  // `containerId` (lib/collections/authorize.ts) : la ligne existe
  // nécessairement à ce point.
  const [target] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  if (target!.kind === 'collection') {
    throw new Error(`Container ${containerId} is a collection root and cannot be deleted.`)
  }

  return db.transaction(async (tx) => {
    const orphanedHoldings = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, containerId))

    await tx.delete(containers).where(eq(containers.id, containerId))

    const undoToken = randomUUID()
    const expiresAt = Date.now() + UNDO_TTL_MS
    undoStore().set(undoToken, { userId, container: target!, holdings: orphanedHoldings, expiresAt })
    const timer = setTimeout(() => undoStore().delete(undoToken), UNDO_TTL_MS)
    timer.unref?.()

    return { removed: true, undoToken }
  })
}

// Rejoue un `undoToken` retourné par `deleteContainer` : recrée le container
// (même id, mêmes attributs) et ses holdings, puis recalcule
// `container_stats` — même contrat que `restoreHoldings`
// (lib/containers/holdings.ts).
export async function restoreContainer(
  userId: string,
  undoToken: string,
): Promise<RestoreContainerResult> {
  const entry = undoStore().get(undoToken)
  if (!entry || entry.expiresAt < Date.now()) {
    undoStore().delete(undoToken)
    return { restored: false }
  }
  if (entry.userId !== userId) {
    throw new Error(`Undo token ${undoToken} does not belong to user ${userId}.`)
  }

  // La collection existe toujours (elle n'est pas supprimée par
  // `deleteContainer`) : l'accès se vérifie à sa granularité, le container
  // restauré n'existe plus le temps de la requête.
  await requireCollectionAccess(userId, entry.container.collectionId, 'write')

  await db.transaction(async (tx) => {
    await tx.insert(containers).values(entry.container)
    if (entry.holdings.length > 0) {
      await tx.insert(holdings).values(entry.holdings)
    }
    await recomputeContainerStats(entry.container.id, tx)
  })

  undoStore().delete(undoToken)
  return { restored: true }
}

export class NotShareableError extends Error {}
export class NotOwnerError extends Error {}

// Les deux seuls `kind` partageables.
export const SHAREABLE_KINDS: ContainerKind[] = ['deck', 'binder']

// Bascule `containers.visibility`. Volontairement **hors**
// de `UpdateContainerPatch` : rendre un container public n'est pas une
// mutation de contenu comme les autres, et le laisser passer par le patch
// générique le rendrait accessible à tout appelant existant sans repasser
// par les deux gardes ci-dessous.
//
// 1. `owner` uniquement. `requireContainerAccess` accorde l'écriture à
//    `owner` comme à `editor` (lib/collections/authorize.ts, « read and
//    write access to everything in the collection ») — mais publier expose
//    les données de la collection à un public anonyme et indexable, ce qui
//    ne relève pas du contenu : c'est la même nature de décision que la
//    gestion des membres, déjà réservée à `owner`
//    (lib/collections/members.ts). Un `editor` qui publierait le deck d'un
//    autre membre élargirait unilatéralement l'audience de données qui ne
//    sont pas les siennes, et le retour arrière ne reprend pas ce qui a été
//    lu. L'affordance reste rendue côté interface pour un `editor`, mais
//    inerte.
// 2. `deck` et `binder` uniquement (pas de partage de la collection
//    entière). La garde vit ici, pas seulement dans l'interface :
//    `getPublicContainer` la rejoue en lecture (lib/sharing/
//    public-container.ts), les deux côtés doivent dire la même chose.
export async function setContainerVisibility(
  userId: string,
  containerId: string,
  visibility: Visibility,
): Promise<Container> {
  const access = await requireContainerAccess(userId, containerId, 'write')
  if (access.role !== 'owner') {
    throw new NotOwnerError(`User ${userId} is not the owner of container ${containerId}.`)
  }

  const [target] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  if (!target) throw new Error(`Container ${containerId} not found.`)
  if (!SHAREABLE_KINDS.includes(target.kind)) {
    throw new NotShareableError(`Container ${containerId} of kind '${target.kind}' cannot be shared.`)
  }

  const [updated] = await db
    .update(containers)
    .set({ visibility })
    .where(eq(containers.id, containerId))
    .returning()
  if (!updated) throw new Error(`Container ${containerId} not found.`)
  return updated
}

export interface DeleteBinderResult {
  movedHoldings: number
}

// Supprime un binder en déplaçant d'abord ses holdings vers le container
// racine, dans la même transaction (supprimer un binder avec
// `ON DELETE CASCADE` détruirait ses holdings : le déplacement précède la
// suppression). N'appelle pas `deleteContainer` ci-dessus (qui laisse la
// cascade FK détruire les holdings restants) : ici, plus aucun holding ne
// pointe vers `containerId` au moment du `delete`, la cascade n'a donc rien
// à faire. Même patron de fusion que `moveHoldings`
// (`lib/containers/holdings.ts`) sur la clé
// `(container_id, card_id, finish, condition, language)` :
// une carte déjà présente dans le container racine voit sa quantité
// additionnée plutôt que de produire une seconde ligne pour la même carte.
export async function deleteBinder(userId: string, containerId: string): Promise<DeleteBinderResult> {
  await requireContainerAccess(userId, containerId, 'write')

  const [target] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  if (!target) throw new Error(`Container ${containerId} not found.`)
  if (target.kind !== 'binder') {
    throw new Error(`Container ${containerId} is not a binder.`)
  }

  const [root] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.collectionId, target.collectionId), eq(containers.kind, 'collection')))
    .limit(1)
  if (!root) throw new Error(`Collection ${target.collectionId} has no root container.`)

  return db.transaction(async (tx) => {
    // Pas de `.for('update')` sur cet instantané : verrouiller toutes les
    // lignes du binder avant celles de la racine inverserait l'ordre
    // d'acquisition par rapport à `moveHoldings` (lib/containers/holdings.ts),
    // qui verrouille la ligne cible (ici la racine) avant de toucher la ligne
    // source (ici le binder) à chaque itération. Un `deleteBinder` concurrent
    // d'un `moveHoldings` binder → racine formerait alors un cycle ABBA que
    // Postgres tranche par 40P01, remonté à l'écran comme « Could not delete
    // this binder ». La boucle
    // ci-dessous reprend le même ordre racine → binder que `moveHoldings` :
    // elle verrouille la ligne de fusion candidate de la racine (`.for
    // ('update')` ci-dessous) avant de toucher la ligne du binder par son
    // `id`, jamais l'inverse.
    //
    // Ce choix laisse ouverte une fenêtre que ce verrou aurait fermée : un
    // `addHolding` qui insère une **nouvelle** clé dans ce binder après cet
    // instantané mais avant le `delete from containers` plus bas n'est vu par
    // aucun des deux verrous ci-dessus (Postgres n'a pas de verrou de
    // prédicat) et serait détruit par la cascade FK sans avoir été déplacé.
    // La fermer proprement demande soit une transaction `SERIALIZABLE` avec
    // retry côté appelant, soit un verrou consultatif posé aussi par
    // `addHolding`. Retenu : l'ordre de verrou cohérent avec
    // `moveHoldings`, pas la fermeture de la fenêtre.
    const rows = await tx.select().from(holdings).where(eq(holdings.containerId, containerId))

    for (const row of rows) {
      const [existing] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.containerId, root.id),
            eq(holdings.cardId, row.cardId),
            eq(holdings.finish, row.finish),
            eq(holdings.condition, row.condition),
            eq(holdings.language, row.language),
          ),
        )
        .for('update')
        .limit(1)

      if (existing) {
        await tx.update(holdings).set({ qty: existing.qty + row.qty }).where(eq(holdings.id, existing.id))
        await tx.delete(holdings).where(eq(holdings.id, row.id))
      } else {
        await tx.update(holdings).set({ containerId: root.id }).where(eq(holdings.id, row.id))
      }
    }

    // Plus aucun holding ne pointe vers `containerId` à ce point : la
    // cascade FK `containers → holdings` n'a rien à détruire.
    await tx.delete(containers).where(eq(containers.id, containerId))
    await recomputeContainerStats(root.id, tx)

    return { movedHoldings: rows.length }
  })
}
