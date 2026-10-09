'use server'

// Server Actions du cycle de vie d'un deck. Toute entrée externe est validée
// par Zod à la frontière (docs/development.md) avant d'atteindre
// `lib/decks/assemble.ts`/`lib/decks/lifecycle.ts`, seules voies d'écriture
// sur les transitions.
//
// `assembleDeckAction` ne fait jamais confiance à un `AssemblePlan` envoyé
// par le client (un deck monté à moitié en base est le pire état possible) :
// plutôt que de faire transiter la sortie JSON de `planAssemblyAction` en
// entrée de `assembleDeckAction`, ce fichier ne reçoit du client que les deux
// interrupteurs et la liste des manquantes cochées, et **recalcule**
// `planAssembly` côté serveur avant d'assembler — la seule vérité qui compte
// est celle lue en base au moment de l'écriture, jamais celle qu'un onglet
// resté ouvert pourrait avoir mémorisée.
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { listContainers } from '@/lib/containers/containers'
import {
  acquireMissing,
  assembleDeck,
  dismantleDeck,
  listAcquireTargets,
  planAssembly,
  restartDeck,
  unbuildDeck,
  type AcquireTarget,
  type AssemblePlan,
} from '@/lib/decks/assemble'

const planOptionsSchema = z.object({
  deckId: z.uuid(),
  fromLooseCollection: z.boolean(),
  fromOtherBuiltDecks: z.boolean(),
})

export async function planAssemblyAction(
  input: unknown,
): Promise<AssemblePlan | { error: string }> {
  const parsed = planOptionsSchema.safeParse(input)
  if (!parsed.success) return { error: 'invalid' }

  const user = await requireSession()
  try {
    return await planAssembly(user.id, parsed.data.deckId, {
      fromLooseCollection: parsed.data.fromLooseCollection,
      fromOtherBuiltDecks: parsed.data.fromOtherBuiltDecks,
    })
  } catch {
    return { error: 'failed' }
  }
}

const assembleSchema = planOptionsSchema.extend({
  acquiredHoldingIds: z.array(z.uuid()).default([]),
})

export async function assembleDeckAction(
  input: unknown,
): Promise<
  | { ok: true; deckState: 'built'; reserved: number; stillMissing: number }
  | { ok: false; error: string }
> {
  const parsed = assembleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    const plan = await planAssembly(user.id, parsed.data.deckId, {
      fromLooseCollection: parsed.data.fromLooseCollection,
      fromOtherBuiltDecks: parsed.data.fromOtherBuiltDecks,
    })
    const result = await assembleDeck(user.id, parsed.data.deckId, {
      plan,
      acquiredHoldingIds: parsed.data.acquiredHoldingIds,
    })
    return { ok: true, ...result }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const deckIdSchema = z.object({ deckId: z.uuid() })

export interface DismantleTarget {
  id: string
  name: string
  kind: 'collection' | 'binder'
}

// Destinations valides d'un démontage (`Return to`) : le container racine
// (« Loose collection », kind `'collection'`) et chaque binder de la même
// collection — jamais un autre deck (la réservation ne duplique rien : un deck
// démonté rend ses cartes, il ne les prête pas à un autre deck).
export async function listDismantleTargetsAction(
  input: unknown,
): Promise<DismantleTarget[] | { error: string }> {
  const parsed = deckIdSchema.safeParse(input)
  if (!parsed.success) return { error: 'invalid' }

  const user = await requireSession()
  try {
    const access = await requireContainerAccess(user.id, parsed.data.deckId, 'read')
    const rows = await listContainers(user.id, access.collectionId)
    return rows
      .filter((row) => row.kind === 'collection' || row.kind === 'binder')
      .map((row) => ({
        id: row.id,
        name: row.kind === 'collection' ? 'Loose collection' : row.name,
        kind: row.kind as 'collection' | 'binder',
      }))
  } catch {
    return { error: 'failed' }
  }
}

// `mode` : `'keep'` retourne les cartes au binder choisi, `'discard'` les
// retire de la collection — les deux options dessinées par
// `DismantleSheet`.
const dismantleSchema = z.object({
  deckId: z.uuid(),
  targetBinderId: z.uuid(),
  mode: z.enum(['keep', 'discard']).default('keep'),
})

export async function dismantleDeckAction(
  input: unknown,
): Promise<{ ok: true; returned: number } | { ok: false; error: string }> {
  const parsed = dismantleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    const result = await dismantleDeck(
      user.id,
      parsed.data.deckId,
      parsed.data.targetBinderId,
      parsed.data.mode,
    )
    return { ok: true, ...result }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// `built → assemble` (remettre un deck en chantier) — simple transition
// d'état, confirmée par une feuille mais sans résolution de holdings
// (`lib/decks/assemble.ts`, `unbuildDeck`).
export async function unbuildDeckAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deckIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await unbuildDeck(user.id, parsed.data.deckId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// `dismantled → plan` (repartir du même contenu) — même remarque,
// `lib/decks/assemble.ts`, `restartDeck`.
export async function restartDeckAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deckIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await restartDeck(user.id, parsed.data.deckId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

export type { AcquireTarget }

// Binders proposés par la feuille `File them where?` (`ExportSheet`) —
// `lib/decks/assemble.ts`, `listAcquireTargets`.
export async function listAcquireTargetsAction(
  input: unknown,
): Promise<AcquireTarget[] | { error: string }> {
  const parsed = deckIdSchema.safeParse(input)
  if (!parsed.success) return { error: 'invalid' }

  const user = await requireSession()
  try {
    return await listAcquireTargets(user.id, parsed.data.deckId)
  } catch {
    return { error: 'failed' }
  }
}

const acquireMissingSchema = z.object({
  deckId: z.uuid(),
  containerId: z.uuid().nullable(),
})

// « Add all N to the collection » —
// `lib/decks/assemble.ts`, `acquireMissing`. `containerId: null` dépose au
// container racine (« No binder », loose dans la collection).
export async function acquireMissingAction(
  input: unknown,
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const parsed = acquireMissingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    const result = await acquireMissing(user.id, parsed.data.deckId, parsed.data.containerId)
    return { ok: true, ...result }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
