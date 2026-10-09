// Mutations de holdings : toutes idempotentes sur la clé `(container_id,
// card_id, finish, condition, language)`, toutes autorisées par
// `requireContainerAccess` (lib/collections/authorize.ts) — le seul chemin
// d'autorisation (docs/development.md) — et toutes suivies d'un recalcul de
// `container_stats` dans la même transaction.
import { randomUUID } from 'node:crypto'

import { and, eq, inArray, ne } from 'drizzle-orm'

import { containers, holdings, type Condition, type DeckZone, type Finish, type Holding } from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'

import { recomputeContainerStats } from './stats'

// Verrouillage d'un deck `built` : refus d'écriture sur un deck built.
// Déplacé ici depuis `lib/containers/bulk.ts` (qui le réexporte désormais) :
// `bulk.ts` ne gardait que ses propres actions groupées, laissant les
// mutations unitaires de ce fichier (`addToDeckAction`/`setZoneAction`)
// libres d'écrire sur un deck déjà sleevé — le verrou doit tenir aussi bien
// sur la voie groupée que sur la voie unitaire. `lib/decks/assemble.ts` est
// l'exception délibérée : il écrit directement sur `holdings` via sa propre
// transaction, sans passer par ces fonctions gardées — c'est lui qui EST la
// transition qui construit ou défait ce verrou, pas un appelant qu'il faut
// bloquer.
type Executor = Pick<typeof db, 'select'>

export class DeckLockedError extends Error {}

export async function assertNotDeckLocked(executor: Executor, containerId: string): Promise<void> {
  const [row] = await executor
    .select({ deckState: containers.deckState })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1)
  if (row?.deckState === 'built') {
    throw new DeckLockedError(`Container ${containerId} is a built deck; mutations are refused.`)
  }
}

export interface HoldingKey {
  containerId: string
  cardId: string
  finish: Finish
  condition: Condition
  language: string
  // Les ajouts de deck passent par `addHolding` : la clé d'unicité inclut la
  // zone, sinon un ajout au side écraserait le main. Optionnelle, défaut
  // `'main'` — même valeur que le défaut de colonne (`packages/db/src/schema.ts`) : tout
  // appelant non-deck (collection racine, binder, liste) omet ce champ et
  // obtient le même comportement que sans zone.
  zone?: DeckZone
}

const DEFAULT_ZONE: DeckZone = 'main'

export interface AddHoldingResult {
  holdingId: string
  qty: number
}

export interface SetHoldingQuantityResult {
  removed: boolean
  qty: number
}

export interface MoveHoldingsResult {
  moved: number
}

export interface RemoveHoldingsResult {
  removed: number
  undoToken: string
}

export interface RestoreHoldingsResult {
  restored: number
}

// Champs éditables par `updateHolding`. `qty` a son propre mutateur
// (`setHoldingQuantity`) ; `finish` fait partie de la clé d'unicité
// `(container_id, card_id, finish, condition, language)` au même titre que
// `condition` et `language` — l'omettre laisserait une ligne créée avec le
// mauvais `finish` non corrigeable autrement qu'en supprimant puis recréant
// la ligne. `recomputeContainerStats` recalcule l'agrégat entier du
// container (jamais incrémental), donc changer `finish`
// n'a pas besoin d'un traitement de valorisation séparé.
export interface UpdateHoldingPatch {
  finish?: Finish
  condition?: Condition
  language?: string
  isCommander?: boolean
  // Utilisée par `setZoneAction` (`app/(app)/decks/[id]/builder-actions.ts`)
  // — `zone` rejoint la clé d'unicité au même titre que `finish`/`condition`/
  // `language` ci-dessus, donc éditable par le même
  // mécanisme de fusion sur collision que le reste de la clé.
  zone?: DeckZone
  // Note libre par copie (feuille d'édition de carte) : `notes` ne participe
  // jamais à la clé d'unicité `matchKey` ci-dessus, ce n'est qu'une valeur
  // portée par la ligne — deux copies
  // identiques par ailleurs mais aux notes différentes fusionnent quand même,
  // exactement comme `qty`. `undefined` laisse la valeur existante intacte
  // (« pas touché »), `null` l'efface explicitement.
  notes?: string | null
}

export interface UpdateHoldingResult {
  holdingId: string
  merged: boolean
}

// Jeton d'annulation en mémoire : toute suppression de données utilisateur
// passe par un `undoToken`, jamais par un `DELETE` direct depuis un écran.
// Un singleton de process, comme `packages/db/src/client.ts` : la fenêtre est
// de 6 secondes, elle n'a pas besoin de survivre à un redémarrage ni d'être
// partagée entre plusieurs instances — et `docker-compose.yml` ne provisionne
// pas de Redis pour le profil `test`, ce qui rendrait l'annulation impossible
// à vérifier sans base éphémère supplémentaire.
const UNDO_TTL_MS = 6_000

interface UndoEntry {
  userId: string
  rows: Holding[]
  expiresAt: number
}

declare global {
  var __spellcacheHoldingsUndo: Map<string, UndoEntry> | undefined
}

function undoStore(): Map<string, UndoEntry> {
  if (!globalThis.__spellcacheHoldingsUndo) {
    globalThis.__spellcacheHoldingsUndo = new Map()
  }
  return globalThis.__spellcacheHoldingsUndo
}

function matchKey(key: HoldingKey) {
  return and(
    eq(holdings.containerId, key.containerId),
    eq(holdings.cardId, key.cardId),
    eq(holdings.finish, key.finish),
    eq(holdings.condition, key.condition),
    eq(holdings.language, key.language),
    eq(holdings.zone, key.zone ?? DEFAULT_ZONE),
  )
}

export interface AddHoldingOptions {
  // Écrit `is_commander` dans la même transaction que la création/fusion du
  // holding : écrire `zone` (ici) puis `is_commander` par un second appel à
  // `updateHolding`, hors de toute transaction commune, laisserait sur un
  // échec entre les deux `zone = 'commander'` avec `is_commander = false`,
  // un état que ni `getDeck` ni `deck-view` ne savent surfacer, et que
  // `hasCommanderHolding` (qui n'interroge que `zone`) rend indéfiniment
  // bloquant (`commander_full` sans commandant affiché). Utilisé par
  // `createDeckAction`/`addToDeckAction`. Optionnel, défaut `false` — même
  // valeur que le défaut de colonne (`packages/db/src/schema.ts`).
  isCommander?: boolean
}

export async function addHolding(
  userId: string,
  key: HoldingKey,
  qty: number,
  options: AddHoldingOptions = {},
): Promise<AddHoldingResult> {
  await requireContainerAccess(userId, key.containerId, 'write')
  await assertNotDeckLocked(db, key.containerId)
  const isCommander = options.isCommander ?? false

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(holdings).where(matchKey(key)).for('update').limit(1)

    if (existing) {
      const finalQty = existing.qty + qty
      await tx
        .update(holdings)
        .set({ qty: finalQty, isCommander: existing.isCommander || isCommander })
        .where(eq(holdings.id, existing.id))
      await recomputeContainerStats(key.containerId, tx)
      return { holdingId: existing.id, qty: finalQty }
    }

    const [created] = await tx
      .insert(holdings)
      .values({ ...key, zone: key.zone ?? DEFAULT_ZONE, qty, isCommander })
      .returning({ id: holdings.id })
    if (!created) throw new Error('Failed to create holding.')
    await recomputeContainerStats(key.containerId, tx)
    return { holdingId: created.id, qty }
  })
}

export async function setHoldingQuantity(
  userId: string,
  holdingId: string,
  qty: number,
): Promise<SetHoldingQuantityResult> {
  const [row] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1)
  if (!row) throw new Error(`Holding ${holdingId} not found.`)

  await requireContainerAccess(userId, row.containerId, 'write')
  await assertNotDeckLocked(db, row.containerId)

  // `qty` à 0 (ou moins) supprime la ligne.
  if (qty <= 0) {
    return db.transaction(async (tx) => {
      await tx.delete(holdings).where(eq(holdings.id, holdingId))
      await recomputeContainerStats(row.containerId, tx)
      return { removed: true, qty: 0 }
    })
  }

  return db.transaction(async (tx) => {
    await tx.update(holdings).set({ qty }).where(eq(holdings.id, holdingId))
    await recomputeContainerStats(row.containerId, tx)
    return { removed: false, qty }
  })
}

export async function updateHolding(
  userId: string,
  holdingId: string,
  patch: UpdateHoldingPatch,
): Promise<UpdateHoldingResult> {
  const [row] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1)
  if (!row) throw new Error(`Holding ${holdingId} not found.`)

  await requireContainerAccess(userId, row.containerId, 'write')
  await assertNotDeckLocked(db, row.containerId)

  const nextKey: HoldingKey = {
    containerId: row.containerId,
    cardId: row.cardId,
    finish: patch.finish ?? row.finish,
    condition: patch.condition ?? row.condition,
    language: patch.language ?? row.language,
    zone: patch.zone ?? row.zone,
  }
  const isCommander = patch.isCommander ?? row.isCommander

  return db.transaction(async (tx) => {
    // La nouvelle clé peut coïncider avec une autre ligne existante :
    // fusion des quantités plutôt que deux lignes pour la même clé
    // (idempotence sur la clé).
    const [collision] = await tx
      .select()
      .from(holdings)
      .where(and(matchKey(nextKey), ne(holdings.id, holdingId)))
      .for('update')
      .limit(1)

    if (collision) {
      await tx
        .update(holdings)
        .set({
          qty: collision.qty + row.qty,
          isCommander: collision.isCommander || isCommander,
          notes: patch.notes !== undefined ? patch.notes : collision.notes,
        })
        .where(eq(holdings.id, collision.id))
      await tx.delete(holdings).where(eq(holdings.id, holdingId))
      await recomputeContainerStats(row.containerId, tx)
      return { holdingId: collision.id, merged: true }
    }

    await tx
      .update(holdings)
      .set({
        finish: nextKey.finish,
        condition: nextKey.condition,
        language: nextKey.language,
        zone: nextKey.zone,
        isCommander,
        notes: patch.notes !== undefined ? patch.notes : row.notes,
      })
      .where(eq(holdings.id, holdingId))
    await recomputeContainerStats(row.containerId, tx)
    return { holdingId, merged: false }
  })
}

export async function moveHoldings(
  userId: string,
  holdingIds: string[],
  targetContainerId: string,
): Promise<MoveHoldingsResult> {
  await requireContainerAccess(userId, targetContainerId, 'write')
  await assertNotDeckLocked(db, targetContainerId)
  if (holdingIds.length === 0) return { moved: 0 }

  // La zone n'a de sens que sur un deck : la préserver
  // vers un binder ou la racine de collection empêcherait un holding `side`
  // déplacé hors d'un deck de fusionner avec la ligne `main` déjà présente
  // du même card/finish/condition/language — deux lignes pour une seule
  // carte, une régression silencieuse (`moveHoldings` ne duplique jamais).
  // Seul un deck cible reçoit la zone
  // d'origine ; tout autre `kind` retombe sur `DEFAULT_ZONE`, la même valeur
  // que le défaut de colonne qu'un appelant non-deck obtenait déjà.
  const [targetContainer] = await db
    .select({ kind: containers.kind })
    .from(containers)
    .where(eq(containers.id, targetContainerId))
    .limit(1)
  if (!targetContainer) throw new Error(`Container ${targetContainerId} not found.`)
  const targetZoneMatters = targetContainer.kind === 'deck'

  const rows = await db.select().from(holdings).where(inArray(holdings.id, holdingIds))
  const sourceContainerIds = [...new Set(rows.map((row) => row.containerId))]
  // Vérifiée avant toute écriture : un container source non autorisé fait
  // échouer le lot entier sans rien modifier.
  for (const containerId of sourceContainerIds) {
    await requireContainerAccess(userId, containerId, 'write')
    await assertNotDeckLocked(db, containerId)
  }

  return db.transaction(async (tx) => {
    let moved = 0

    for (const row of rows) {
      const targetKey: HoldingKey = {
        containerId: targetContainerId,
        cardId: row.cardId,
        finish: row.finish,
        condition: row.condition,
        language: row.language,
        // Préserve la zone du holding déplacé seulement vers un autre deck
        // (un holding `side` déplacé vers un autre deck doit
        // rechercher/fusionner avec un `side` existant, jamais un `main` par
        // défaut) — vers un binder ou la collection racine, la zone n'a aucun
        // sens et retombe sur `DEFAULT_ZONE`, pour fusionner avec la ligne
        // déjà présente.
        zone: targetZoneMatters ? row.zone : DEFAULT_ZONE,
      }
      const [existing] = await tx
        .select()
        .from(holdings)
        .where(matchKey(targetKey))
        .for('update')
        .limit(1)

      if (existing) {
        await tx
          .update(holdings)
          .set({ qty: existing.qty + row.qty })
          .where(eq(holdings.id, existing.id))
        await tx.delete(holdings).where(eq(holdings.id, row.id))
      } else {
        // Écrit `zone` avec `containerId` : la ligne
        // déplacée doit atterrir exactement sur la clé (`targetKey`, ci-
        // dessus) qui a servi à la chercher, sinon un holding `side`/
        // `commander` déplacé hors d'un deck reste étiqueté avec sa zone
        // d'origine alors que toute recherche ultérieure au même endroit
        // (via `matchKey`) le cherche sous `DEFAULT_ZONE` — deux lignes
        // pour la même carte dans le container cible, la duplication que
        // `moveHoldings` ne doit jamais produire (il relocalise, ne duplique
        // jamais).
        await tx
          .update(holdings)
          .set({ containerId: targetContainerId, zone: targetKey.zone })
          .where(eq(holdings.id, row.id))
      }
      moved += 1
    }

    const touchedContainerIds = new Set([...sourceContainerIds, targetContainerId])
    for (const containerId of touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    return { moved }
  })
}

export async function removeHoldings(
  userId: string,
  holdingIds: string[],
): Promise<RemoveHoldingsResult> {
  const rows = await db.select().from(holdings).where(inArray(holdings.id, holdingIds))
  const containerIds = [...new Set(rows.map((row) => row.containerId))]
  for (const containerId of containerIds) {
    await requireContainerAccess(userId, containerId, 'write')
    await assertNotDeckLocked(db, containerId)
  }

  return db.transaction(async (tx) => {
    const deleted =
      holdingIds.length === 0
        ? []
        : await tx.delete(holdings).where(inArray(holdings.id, holdingIds)).returning()

    for (const containerId of containerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    const undoToken = randomUUID()
    const expiresAt = Date.now() + UNDO_TTL_MS
    undoStore().set(undoToken, { userId, rows: deleted, expiresAt })
    const timer = setTimeout(() => undoStore().delete(undoToken), UNDO_TTL_MS)
    timer.unref?.()

    return { removed: deleted.length, undoToken }
  })
}

// Rejoue un `undoToken` retourné par `removeHoldings` : recrée exactement les
// lignes supprimées (mêmes id, qty, finish, condition, language) si le jeton
// n'a pas expiré (6 secondes) et n'a pas déjà été consommé.
export async function restoreHoldings(
  userId: string,
  undoToken: string,
): Promise<RestoreHoldingsResult> {
  const entry = undoStore().get(undoToken)
  if (!entry || entry.expiresAt < Date.now()) {
    undoStore().delete(undoToken)
    return { restored: 0 }
  }
  if (entry.userId !== userId) {
    throw new Error(`Undo token ${undoToken} does not belong to user ${userId}.`)
  }

  const containerIds = [...new Set(entry.rows.map((row) => row.containerId))]
  for (const containerId of containerIds) {
    await requireContainerAccess(userId, containerId, 'write')
    await assertNotDeckLocked(db, containerId)
  }

  return db.transaction(async (tx) => {
    if (entry.rows.length > 0) {
      await tx.insert(holdings).values(entry.rows)
    }
    for (const containerId of containerIds) {
      await recomputeContainerStats(containerId, tx)
    }
    undoStore().delete(undoToken)
    return { restored: entry.rows.length }
  })
}
