'use server'

// Mutation de l'écran `Decks` : création d'un deck depuis la feuille
// `New deck`. Toute entrée externe est validée par Zod à la frontière
// (docs/development.md) avant d'atteindre `createContainer`
// (lib/containers/containers.ts), seule voie d'écriture autorisée sur
// `containers` — même patron que `createBinderOrListAction`
// (`app/(app)/collection/actions.ts`).
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { containers, holdings } from '@spellcache/db/schema'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { createContainer, deleteContainer, updateContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'
import { FORMAT_RULES, type DeckFormat } from '@/lib/decks/legality'
import { requireSession } from '@/lib/auth-guards'
import { db } from '@spellcache/db'

const DECK_FORMATS = Object.keys(FORMAT_RULES) as [DeckFormat, ...DeckFormat[]]

const createDeckSchema = z.object({
  name: z.string().trim().min(1).max(80),
  format: z.enum(DECK_FORMATS).nullable(),
  // `cardId` du catalogue (commandant optionnel choisi dans le catalogue) —
  // jamais castée, validée comme un `uuid` Scryfall avant d'atteindre
  // `addHolding`.
  commanderCardId: z.uuid().nullable(),
})

export async function createDeckAction(
  input: unknown,
): Promise<{ ok: true; deckId: string } | { ok: false; error: string }> {
  const parsed = createDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  // Idempotent : appelé une seconde fois ici
  // uniquement pour récupérer le `collectionId`, absent de `SessionUser`
  // (lib/auth-guards.ts) — même patron que `createBinderOrListAction`.
  const { collectionId } = await bootstrapCollection(user.id, {
    username: user.username,
    displayName: null,
  })

  // Un deck naît en `deck_state = 'plan'` : seule cette création l'écrit, les
  // transitions d'état suivantes passent par `lib/decks/assemble.ts`.
  const deck = await createContainer(user.id, collectionId, {
    kind: 'deck',
    name: parsed.data.name,
    format: parsed.data.format,
    deckState: 'plan',
  })

  if (parsed.data.commanderCardId) {
    // Le commandant est un holding comme un autre (docs/development.md : « un deck est
    // un container, ses cartes sont des holdings ») — `is_commander = true`
    // le distingue et `zone = 'commander'` (`holdings.zone`) le sépare du mainboard : les deux
    // colonnes s'écrivent dans la même transaction, jamais l'une puis l'autre
    // par un second appel — un commandant en `zone = 'main'` s'afficherait à
    // la fois dans `Commander · 1` et dans `Mainboard`, et gonflerait
    // `counts.main`, `manaCurve` et `colorPips` ; un échec entre deux
    // écritures séparées pourrait laisser
    // `zone = 'commander'` avec `is_commander = false`, irrécupérable depuis
    // l'interface (`hasCommanderHolding` n'interroge que `zone`). `zone:
    // 'commander'` fait aussi partie de la clé d'unicité du holding
    // (`lib/containers/holdings.ts`) : le commandant ne fusionne jamais avec
    // un exemplaire déjà présent au mainboard.
    await addHolding(
      user.id,
      {
        containerId: deck.id,
        cardId: parsed.data.commanderCardId,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        zone: 'commander',
      },
      1,
      { isCommander: true },
    )
  }

  return { ok: true, deckId: deck.id }
}

// Renommage d'un deck depuis le menu contextuel de la vue étagères (appui
// long — `Move to folder…`, `Rename`, `Duplicate`, `Dismantle`). Posé à côté
// de `createDeckAction` plutôt que dans `folder-actions.ts` : c'est une
// mutation de deck, pas de dossier. `updateContainer`
// (lib/containers/containers.ts) reste la
// seule voie d'écriture sur `containers` et porte déjà la garde
// `requireContainerAccess` — aucun second chemin d'autorisation (docs/development.md).
const renameDeckSchema = z.object({ deckId: z.uuid(), name: z.string().trim().min(1).max(80) })

// Notes de l'onglet `Infos` d'un deck. Bornées à 4000 caractères : un champ
// texte libre sans plafond est une porte ouverte, et aucune note utile n'en
// demande plus.
const deckNotesSchema = z.object({
  deckId: z.uuid(),
  description: z.string().max(4000),
})

// Supprimer un deck. Ses cartes ne disparaissent pas avec lui : celles d'un
// deck monté sont des exemplaires de la collection, la cascade FK n'emporte
// que les lignes du container. Un plan, lui, n'avait rien pris à personne.
const deleteDeckSchema = z.object({ deckId: z.uuid() })

export async function deleteDeckAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deleteDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await deleteContainer(user.id, parsed.data.deckId)
  } catch {
    return { ok: false, error: 'failed' }
  }

  return { ok: true }
}

export async function saveDeckNotesAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = deckNotesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await updateContainer(user.id, parsed.data.deckId, { description: parsed.data.description })
  } catch {
    return { ok: false, error: 'not found' }
  }

  return { ok: true }
}

export async function renameDeckAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = renameDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await updateContainer(user.id, parsed.data.deckId, { name: parsed.data.name })
  } catch {
    return { ok: false, error: 'not found' }
  }

  return { ok: true }
}

// Feuille `Edit deck` : nom ET format, le format venant d'une liste
// déroulante prédéfinie (demande produit, 2026-09-01) — les sept formats
// connus de `lib/decks/legality.ts` ou chaîne vide (= pas de format,
// `null`). Le schéma verrouille cette liste : un format libre n'existe plus.
const updateDeckSchema = z.object({
  deckId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  format: z.union([z.literal(''), z.enum(DECK_FORMATS)]),
})

export async function updateDeckAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    await updateContainer(user.id, parsed.data.deckId, {
      name: parsed.data.name,
      format: parsed.data.format.length === 0 ? null : parsed.data.format,
    })
  } catch {
    return { ok: false, error: 'not found' }
  }

  return { ok: true }
}

// « Duplicate » : une copie réelle, container ET holdings, toujours en
// `deck_state = 'plan'` même depuis un deck monté — dupliquer ne crée jamais
// d'entrée de collection. Pas de fonction `duplicateContainer` générique dans
// `lib/containers/containers.ts` : copie posée ici, au plus près de son seul
// appelant, plutôt que d'étendre un module partagé pour un seul consommateur.
const deckIdSchema = z.object({ deckId: z.uuid() })

export async function duplicateDeckAction(
  input: unknown,
): Promise<{ ok: true; deckId: string } | { ok: false; error: string }> {
  const parsed = deckIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  try {
    const access = await requireContainerAccess(user.id, parsed.data.deckId, 'read')

    const [source] = await db
      .select({ name: containers.name, format: containers.format, kind: containers.kind })
      .from(containers)
      .where(eq(containers.id, parsed.data.deckId))
      .limit(1)
    if (!source || source.kind !== 'deck') return { ok: false, error: 'not found' }

    const copy = await createContainer(user.id, access.collectionId, {
      kind: 'deck',
      name: source.name,
      format: source.format,
      deckState: 'plan',
    })

    const sourceHoldings = await db
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, parsed.data.deckId))

    for (const holding of sourceHoldings) {
      await addHolding(
        user.id,
        {
          containerId: copy.id,
          cardId: holding.cardId,
          finish: holding.finish,
          condition: holding.condition,
          language: holding.language,
          zone: holding.zone,
        },
        holding.qty,
        { isCommander: holding.isCommander },
      )
    }

    return { ok: true, deckId: copy.id }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
