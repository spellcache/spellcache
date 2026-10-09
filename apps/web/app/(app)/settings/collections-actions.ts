'use server'

// Multi-collection : changer de collection affichée, en créer une nouvelle.
// Entrées validées par Zod à la frontière (docs/development.md).
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { users } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { setActiveCollection } from '@/lib/collections/active'
import { ContainerAccessError } from '@/lib/collections/authorize'
import { createCollection } from '@/lib/collections/bootstrap'
import { deleteCollection } from '@/lib/collections/members'
import { db } from '@spellcache/db'

const switchInputSchema = z.object({ collectionId: z.uuid() })
const createInputSchema = z.object({ name: z.string().trim().min(1).max(80) })

export async function switchCollectionAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'invalid' | 'forbidden' }> {
  const user = await requireSession()
  const parsed = switchInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const switched = await setActiveCollection(user.id, parsed.data.collectionId)
  return switched ? { ok: true } : { ok: false, error: 'forbidden' }
}

// Nouvelle collection dont l'appelant est `owner`, aussitôt affichée.
export async function createCollectionAction(
  input: unknown,
): Promise<{ ok: true; collectionId: string } | { ok: false; error: 'invalid' }> {
  const user = await requireSession()
  const parsed = createInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const { collectionId } = await db.transaction(async (tx) => {
    const created = await createCollection(tx, user.id, parsed.data.name)
    await tx.update(users).set({ activeCollectionId: created.collectionId }).where(eq(users.id, user.id))
    return created
  })
  return { ok: true, collectionId }
}

const deleteInputSchema = z.object({ collectionId: z.uuid() })

// Suppression définitive, réservée à un `owner` de la collection.
export async function deleteCollectionAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'invalid' | 'forbidden' }> {
  const user = await requireSession()
  const parsed = deleteInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    await deleteCollection(user.id, parsed.data.collectionId)
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
  return { ok: true }
}
