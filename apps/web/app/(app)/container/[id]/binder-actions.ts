'use server'

// Actions du binder : apparence, renommage, suppression. Toute entrée externe
// est validée par Zod à la frontière (docs/development.md) avant d'atteindre
// `lib/containers/containers.ts` — la
// seule voie d'écriture sur `containers`.
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { cards } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { ContainerAccessError, requireContainerAccess } from '@/lib/collections/authorize'
import {
  deleteBinder,
  deleteContainer,
  updateContainer,
} from '@/lib/containers/containers'
import { db } from '@spellcache/db'
import type { GradientKey } from '@/lib/binders/gradients'

import { listContainerCards } from './holdings-data'

// Littéral les six clés plutôt que `z.string().refine(isGradientKey)` : un
// `z.enum` infère directement le type `GradientKey`, sans cast — une nouvelle clé dans
// `lib/binders/gradients.ts` sans mise à jour ici casse la build (`tsc`),
// jamais silencieusement acceptée en base.
const gradientKeySchema = z.enum([
  'blue',
  'green',
  'red',
  'grey',
  'gold',
  'purple',
]) satisfies z.ZodType<GradientKey>

// `BinderLook` — trois états mutuellement exclusifs, jamais un
// `cover_gradient` et un `cover_card_id` renseignés ensemble.
//
// `commander` est un quatrième état, propre aux decks : le bouton palette ouvre
// la feuille d'apparence avec un état par défaut Commander art, l'illustration
// venant du commandant sans configuration. Sans `intensity` propre, comme
// `none` : un deck en mode `commander` rend son fond commandant à l'opacité
// fixe du design validé (`0.55`, `components/decks/deck-backdrop.tsx`), jamais
// modulée par `Intensity` (qui ne plafonne que les deux overrides explicites
// `colour`/`art`, même règle que pour un binder). `saveBinderLookAction`
// persiste donc `commander` exactement comme `none` (aucune colonne
// supplémentaire) — les deux valent « pas de dérogation posée », seule la
// lecture d'un deck (commandant présent ou non) distingue leur rendu.
export type BinderLook =
  | { mode: 'none' }
  | { mode: 'colour'; gradient: GradientKey; intensity: number }
  | { mode: 'art'; cardId: string; intensity: number }
  | { mode: 'commander' }

const binderLookSchema: z.ZodType<BinderLook> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal('colour'),
    gradient: gradientKeySchema,
    intensity: z.number().min(0).max(1),
  }),
  z.object({
    mode: z.literal('art'),
    cardId: z.uuid(),
    intensity: z.number().min(0).max(1),
  }),
  z.object({ mode: z.literal('commander') }),
])

const saveBinderLookSchema = z.object({
  containerId: z.uuid(),
  look: binderLookSchema,
})

export type SaveBinderLookResult =
  | { ok: true; coverArtist: string | null }
  | { ok: false; error: 'unknown_card' | 'forbidden' | 'invalid' }

// Répercute l'apparence sur l'accueil Compact (`BinderRow`) au prochain
// affichage, sans rechargement complet — une invalidation de cache serveur,
// jamais un `window.location.reload()`. L'écran de détail courant se met à jour
// lui-même en optimiste (`binder-header.tsx`), cette invalidation ne le
// concerne pas.
function revalidateCollectionHome(): void {
  revalidatePath('/collection')
}

export async function saveBinderLookAction(
  input: unknown,
): Promise<SaveBinderLookResult> {
  const parsed = saveBinderLookSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const { containerId, look } = parsed.data

  try {
    // Autorisation d'abord, toute autre lecture ensuite (docs/development.md, « une
    // seule voie d'autorisation ») : interroger `holdings` avant
    // `requireContainerAccess` transformerait ce contrôle en oracle
    // d'appartenance carte↔container inter-collections pour un appelant non
    // membre, qui recevrait `not_in_binder` au lieu de `forbidden` sans que
    // son accès n'ait jamais été vérifié.
    await requireContainerAccess(user.id, containerId, 'write')

    let coverArtist: string | null = null
    if (look.mode === 'art') {
      // N'importe quelle carte du catalogue peut servir de fond — elle n'a
      // pas à être dans le binder ni même possédée (« Any card can be the
      // backdrop — it does not have to be one you own »). On vérifie
      // seulement qu'elle existe dans
      // le miroir local : `containers.cover_card_id` porte une FK vers
      // `cards`, autant répondre proprement qu'exploser dessus.
      const [row] = await db
        .select({ id: cards.id, artist: cards.artist })
        .from(cards)
        .where(eq(cards.id, look.cardId))
        .limit(1)
      if (!row) return { ok: false, error: 'unknown_card' }
      // Rendu à l'appelant pour le crédit `Art by` de l'en-tête mis à jour
      // en optimiste (`deck-view.tsx`).
      coverArtist = row.artist
    }

    await updateContainer(user.id, containerId, {
      coverGradient: look.mode === 'colour' ? look.gradient : null,
      coverCardId: look.mode === 'art' ? look.cardId : null,
      // Toujours mode ∈ { colour, art } quand `intensity` existe — ni `none`
      // ni `commander` n'en portent, `containers.cover_intensity` retombe
      // alors sur le défaut de colonne (`packages/db/src/schema.ts`, `0.52`) plutôt que
      // d'être écrit à zéro : aucun des deux n'a de fond à moduler par ce
      // réglage (l'opacité du fond commandant est fixe, pas pilotée par
      // `Intensity`).
      ...(look.mode === 'colour' || look.mode === 'art'
        ? { coverIntensity: String(look.intensity) }
        : {}),
    })

    revalidateCollectionHome()
    return { ok: true, coverArtist }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    throw error
  }
}

const renameContainerSchema = z.object({
  containerId: z.uuid(),
  name: z.string().trim().min(1).max(80),
})

export async function renameContainerAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = renameContainerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    await updateContainer(user.id, parsed.data.containerId, { name: parsed.data.name })
    revalidateCollectionHome()
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

const deleteBinderSchema = z.object({ containerId: z.uuid() })

export async function deleteBinderAction(
  input: unknown,
): Promise<{ ok: true; movedHoldings: number } | { ok: false; error: string }> {
  const parsed = deleteBinderSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const result = await deleteBinder(user.id, parsed.data.containerId)
    revalidateCollectionHome()
    return { ok: true, movedHoldings: result.movedHoldings }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export interface BinderCardOption {
  cardId: string
  name: string
  thumbUrl: string
}

const listBinderCardsSchema = z.object({
  containerId: z.uuid(),
  query: z.string().optional(),
})

// Cartes du binder pour le sélecteur du mode `Card art` : on liste les cartes
// du binder, pas le catalogue — jamais la recherche globale.
const deleteListSchema = z.object({ containerId: z.uuid() })

// Suppression d'une liste. Distincte de `deleteBinderAction` ci-dessus, qui
// déplace les holdings du binder vers le container racine avant de le
// supprimer : les cartes d'une liste ne sont pas dans la collection (onglet
// `Lists`), les reverser dans la racine les y ferait entrer.
// `deleteContainer` laisse la cascade FK emporter les holdings de la
// liste et ne touche à rien d'autre — la collection est inchangée.
//
// `deleteBinder` rejette d'ailleurs tout `kind` autre que `binder` : sans
// cette action, une liste n'avait aucun chemin de suppression.
export async function deleteListAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'failed' }> {
  const parsed = deleteListSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    await deleteContainer(user.id, parsed.data.containerId)
    revalidateCollectionHome()
    return { ok: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function listBinderCardsAction(input: unknown): Promise<BinderCardOption[]> {
  const parsed = listBinderCardsSchema.safeParse(input)
  if (!parsed.success) return []

  const user = await requireSession()
  return listContainerCards(user.id, parsed.data.containerId, parsed.data.query ?? '')
}
