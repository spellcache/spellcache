'use server'

// Renommage de la collection (groupe `Collection` de Settings). Toute
// entrée externe validée par Zod à la frontière (docs/development.md) avant
// `lib/collections/rename.ts`, seul chemin d'écriture.
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'
import { ContainerAccessError } from '@/lib/collections/authorize'
import { renameCollection } from '@/lib/collections/rename'

const renameCollectionInputSchema = z.object({
  collectionId: z.uuid(),
  name: z.string().trim().min(1).max(80),
})

export type RenameCollectionResult =
  | { ok: true; name: string }
  | { ok: false; error: 'invalid' | 'forbidden' }

export async function renameCollectionAction(input: unknown): Promise<RenameCollectionResult> {
  const session = await requireSession()

  const parsed = renameCollectionInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  try {
    await renameCollection(session.id, parsed.data.collectionId, parsed.data.name)
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }

  revalidatePath('/settings')
  return { ok: true, name: parsed.data.name }
}
