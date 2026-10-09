'use server'

// Server Actions des actions groupées :
// valident l'entrée externe par Zod à la frontière (docs/development.md) avant
// d'atteindre `lib/containers/bulk.ts`, la seule voie d'écriture groupée sur
// `holdings`. Même schéma de filtres/tri que `actions.ts` — dupliqué
// plutôt que partagé : ce fichier ne doit pas dépendre d'exports privés
// d'`actions.ts`, et les deux évoluent au même rythme que `HoldingFilters`.
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { containers, containerStats, type ContainerKind } from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { requireSession } from '@/lib/auth-guards'
import { bulkDelete, bulkEdit, bulkUndo, DeckLockedError, type BulkEdit, type BulkTarget } from '@/lib/containers/bulk'
import { db } from '@spellcache/db'
import type { HoldingFilters, ViewState } from '@/lib/view-state/parse'

const finishSchema = z.enum(['nonfoil', 'foil', 'etched'])
const conditionSchema = z.enum(['nm', 'lp', 'mp', 'hp', 'dmg'])

const holdingFiltersSchema: z.ZodType<HoldingFilters> = z.object({
  colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G', 'C'])),
  colorMatch: z.enum(['including', 'exactly', 'atMost']),
  multicolourOnly: z.boolean(),
  monoOnly: z.boolean(),
  types: z.array(z.string()),
  rarities: z.array(z.string()),
  finishes: z.array(finishSchema),
  conditions: z.array(conditionSchema),
  setCode: z.string().nullable(),
  binderId: z.uuid().nullable(),
  priceMinMinor: z.number().int().nullable(),
  priceMaxMinor: z.number().int().nullable(),
})

const viewStateSchema: z.ZodType<ViewState> = z.object({
  query: z.string(),
  filters: holdingFiltersSchema,
  sort: z.object({
    key: z.enum(['name', 'price', 'cmc', 'rarity', 'set', 'added', 'qty']),
    dir: z.enum(['high', 'low']),
  }),
  groupBy: z.enum(['set', 'type', 'colour', 'rarity', 'binder', 'none']).nullable(),
  density: z.enum(['rows', 'compact', 'grid']).nullable(),
})

// Une cible groupée est soit une sélection explicite, soit la vue filtrée
// entière — jamais les deux, jamais aucune.
const bulkTargetSchema = z
  .object({
    containerId: z.uuid(),
    holdingIds: z.array(z.uuid()).optional(),
    matching: viewStateSchema.optional(),
  })
  .refine((v) => (v.holdingIds !== undefined) !== (v.matching !== undefined), {
    message: 'Provide exactly one of holdingIds or matching.',
  })

function toBulkTarget(parsed: z.infer<typeof bulkTargetSchema>): BulkTarget {
  return {
    containerId: parsed.containerId,
    holdingIds: parsed.holdingIds,
    matching: parsed.matching,
  }
}

const bulkEditSchema = z.object({
  target: bulkTargetSchema,
  edit: z.object({
    qty: z.number().int().positive().optional(),
    condition: conditionSchema.optional(),
    finish: finishSchema.optional(),
    targetContainerId: z.uuid().optional(),
    // Ligne « Language » de `BulkEditSheet` (`bulk.ts`, `BulkEdit`).
    language: z.string().trim().min(1).max(8).optional(),
  }),
})

export type BulkActionResult =
  | { ok: true; affected: number; undoToken: string }
  | { ok: false; error: 'invalid' | 'deck_locked' | 'failed' }

export async function bulkEditAction(input: unknown): Promise<BulkActionResult> {
  const parsed = bulkEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const result = await bulkEdit(user.id, toBulkTarget(parsed.data.target), parsed.data.edit as BulkEdit)
    return { ok: true, affected: result.affected, undoToken: result.undoToken }
  } catch (error) {
    if (error instanceof DeckLockedError) return { ok: false, error: 'deck_locked' }
    return { ok: false, error: 'failed' }
  }
}

const bulkDeleteSchema = z.object({ target: bulkTargetSchema })

export async function bulkDeleteAction(input: unknown): Promise<BulkActionResult> {
  const parsed = bulkDeleteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const result = await bulkDelete(user.id, toBulkTarget(parsed.data.target))
    return { ok: true, affected: result.affected, undoToken: result.undoToken }
  } catch (error) {
    if (error instanceof DeckLockedError) return { ok: false, error: 'deck_locked' }
    return { ok: false, error: 'failed' }
  }
}

const bulkUndoSchema = z.object({ undoToken: z.string().min(1) })

export async function bulkUndoAction(
  input: unknown,
): Promise<{ ok: true; restored: number } | { ok: false; error: 'expired' }> {
  const parsed = bulkUndoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'expired' }

  const user = await requireSession()
  const result = await bulkUndo(user.id, parsed.data.undoToken)
  // Un token valide qui n'a touché aucune ligne (`affected: 0`) reste
  // annulable-avec-succès pendant sa fenêtre de 6s : seul un token
  // introuvable/périmé est une vraie erreur `expired` (`result.restored === 0`
  // confondrait les deux cas).
  if (result.expired) return { ok: false, error: 'expired' }
  return { ok: true, restored: result.restored }
}

// Destinations pour `Move`/`Add to deck` (feuille `Edit` groupée) : binders
// et decks de la même collection, hors le container courant lui-même — pas
// de filtrage sur `deck_state` ici (une tentative sur un deck monté est
// refusée côté serveur avec
// un message, plutôt que masquée silencieusement de la liste).
export interface BulkMoveTarget {
  id: string
  name: string
  kind: ContainerKind
  // Compte de cartes (hint `N cards` par binder de `PickerSheet`) — lu
  // depuis `container_stats`
  // (docs/development.md : « valeurs précalculées », jamais un agrégat de `holdings` au
  // rendu).
  cardCount: number
}

export async function listBulkMoveTargetsAction(containerId: unknown): Promise<BulkMoveTarget[]> {
  const id = z.uuid().parse(containerId)
  const user = await requireSession()
  const access = await requireContainerAccess(user.id, id, 'read')

  const rows = await db
    .select({
      id: containers.id,
      name: containers.name,
      kind: containers.kind,
      cardCount: containerStats.cardCount,
    })
    .from(containers)
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .where(eq(containers.collectionId, access.collectionId))
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))

  return rows.filter((row) => row.id !== id && (row.kind === 'binder' || row.kind === 'deck'))
}
