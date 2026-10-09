'use server'

// Mutation des écrans d'accueil : création d'un binder ou d'une liste. Toute
// entrée externe est validée par Zod à la frontière (docs/development.md) avant
// d'atteindre `createContainer` (lib/containers/containers.ts), seule voie d'écriture autorisée
// sur `containers`.
import { z } from 'zod'

import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { createContainer } from '@/lib/containers/containers'
import { requireSession } from '@/lib/auth-guards'

// Sert le bouton `New binder or list` de l'accueil Shelves comme le lien
// `New binder` / `New list` de l'accueil Compact : `kind` est la seule
// différence entre un binder et une liste (`ListSummary` est
// `BinderSummary`, même géométrie de ligne).
const createBinderOrListSchema = z.object({
  kind: z.enum(['binder', 'list']),
  name: z.string().trim().min(1).max(80),
})

export async function createBinderOrListAction(
  input: unknown,
): Promise<
  { ok: true; containerId: string; kind: 'binder' | 'list' } | { ok: false; error: string }
> {
  const parsed = createBinderOrListSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  // Idempotent : appelé une seconde fois ici
  // uniquement pour récupérer le `collectionId`, absent de `SessionUser`
  // (lib/auth-guards.ts).
  const { collectionId } = await bootstrapCollection(user.id, {
    username: user.username,
    displayName: null,
  })

  const container = await createContainer(user.id, collectionId, {
    kind: parsed.data.kind,
    name: parsed.data.name,
  })

  return { ok: true, containerId: container.id, kind: parsed.data.kind }
}
