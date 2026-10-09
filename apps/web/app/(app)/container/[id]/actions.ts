'use server'

// Mutations et lectures côté client de l'écran de container. Toute entrée
// externe est validée par Zod à la frontière (docs/development.md) avant
// d'atteindre les fonctions de `lib/containers/` — la seule voie d'écriture
// sur `holdings`/`containers`.
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getCardPreview, type CardPreview } from '@/components/desktop/preview-pane-data'
import { containers, holdings, type ContainerKind } from '@spellcache/db/schema'
import { cards } from '@spellcache/db/schema'
import {
  addHolding,
  moveHoldings,
  removeHoldings,
  restoreHoldings,
  setHoldingQuantity,
  updateHolding,
} from '@/lib/containers/holdings'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { requireSession } from '@/lib/auth-guards'
import { db } from '@spellcache/db'
import type { ScryfallImageUris } from '@spellcache/core/scryfall/schemas'
import { EMPTY_FILTERS, type HoldingFilters } from '@/lib/view-state/parse'

import {
  countHoldings,
  getContainerHeader,
  listContainerSets,
  listHoldings,
  InvalidHoldingCursorError,
  type ContainerHeader,
  type ContainerSetOption,
  type HoldingPage,
} from './holdings-data'

export type { ContainerSetOption } from './holdings-data'

const finishSchema = z.enum(['nonfoil', 'foil', 'etched'])
const conditionSchema = z.enum(['nm', 'lp', 'mp', 'hp', 'dmg'])

// Filtres de la feuille `Filters` (`HoldingFilters`)
// — validés à la frontière comme toute entrée externe (docs/development.md), jamais
// castés. `binderId` restreint la liste à un binder, ou au vrac de la racine,
// sur le périmètre élargi de la racine (`buildWhereConditions`).
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

const sortSchema = z.object({
  key: z.enum(['name', 'price', 'cmc', 'rarity', 'set', 'added', 'qty']),
  dir: z.enum(['high', 'low']),
})

// Lecture d'une page de holdings depuis le client (scroll infini) — même
// patron que `searchCatalogAction` : une
// réponse distincte et typée pour un curseur invalide plutôt qu'une
// exception opaque.
const listHoldingsSchema = z.object({
  containerId: z.uuid(),
  cursor: z.string().nullish(),
  limit: z.number().int().positive().max(200).optional(),
  query: z.string().optional(),
  filters: holdingFiltersSchema.optional(),
  sort: sortSchema.optional(),
  groupBy: z.enum(['set', 'type', 'colour', 'rarity', 'binder', 'none']).nullish(),
})

export interface InvalidCursorResponse {
  error: 'invalid_cursor'
}

export async function listHoldingsAction(
  input: unknown,
): Promise<HoldingPage | InvalidCursorResponse> {
  const parsed = listHoldingsSchema.parse(input)
  const user = await requireSession()

  try {
    return await listHoldings(user.id, parsed.containerId, {
      cursor: parsed.cursor,
      limit: parsed.limit,
      query: parsed.query,
      filters: parsed.filters,
      sort: parsed.sort,
      groupBy: parsed.groupBy,
    })
  } catch (error) {
    if (error instanceof InvalidHoldingCursorError) {
      return { error: 'invalid_cursor' }
    }
    throw error
  }
}

// Compte annoncé par le bouton primaire `Show N cards` — débouncé et annulé
// côté client (recompter à chaque frappe inonderait le serveur), jamais
// appliqué tant que l'utilisateur n'a pas validé.
const countHoldingsSchema = z.object({
  containerId: z.uuid(),
  query: z.string().optional(),
  filters: holdingFiltersSchema.optional(),
})

export async function countHoldingsAction(input: unknown): Promise<{ count: number }> {
  const parsed = countHoldingsSchema.parse(input)
  const user = await requireSession()
  const count = await countHoldings(user.id, parsed.containerId, {
    query: parsed.query,
    filters: parsed.filters ?? EMPTY_FILTERS,
  })
  return { count }
}

// Sets détenus dans ce container (ligne `Set` de la feuille
// `Filters`) — chargés à l'ouverture de la feuille, pas au montage de
// l'écran de container (évite un aller-retour supplémentaire tant que la
// feuille n'est pas ouverte).
export async function listContainerSetsAction(containerId: unknown): Promise<ContainerSetOption[]> {
  const id = z.uuid().parse(containerId)
  const user = await requireSession()
  return listContainerSets(user.id, id)
}

// Total et valeur relus après mutation (invalidation de la clé de container
// côté client — `lib/query/keys.ts`).
export async function getContainerHeaderAction(containerId: unknown): Promise<ContainerHeader> {
  const id = z.uuid().parse(containerId)
  const user = await requireSession()
  return getContainerHeader(user.id, id)
}

const setQuantitySchema = z.object({
  holdingId: z.uuid(),
  qty: z.number().int(),
})

export async function setQuantityAction(input: unknown): Promise<
  { ok: true; qty: number; removed: boolean; undoToken?: string } | { ok: false; error: string }
> {
  const parsed = setQuantitySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    // `qty <= 0` retire la ligne — passe par
    // `removeHoldings` plutôt que `setHoldingQuantity` (qui supprime aussi
    // mais sans jeton) : c'est `removeHoldings` qui porte l'`undoToken` de 6
    // secondes (lib/containers/holdings.ts).
    if (parsed.data.qty <= 0) {
      const result = await removeHoldings(user.id, [parsed.data.holdingId])
      if (result.removed === 0) return { ok: false, error: 'not_found' }
      return { ok: true, qty: 0, removed: true, undoToken: result.undoToken }
    }

    const result = await setHoldingQuantity(user.id, parsed.data.holdingId, parsed.data.qty)
    return { ok: true, qty: result.qty, removed: result.removed }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// Restauration d'une suppression : rejoue le jeton contre `restoreHoldings`
// — ne reconstruit jamais la ligne côté client (elle perdrait `addedAt` et
// l'`id`).
const undoSchema = z.object({ undoToken: z.string().min(1) })

export async function undoAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'expired' }> {
  const parsed = undoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'expired' }

  const user = await requireSession()
  const result = await restoreHoldings(user.id, parsed.data.undoToken)
  if (result.restored === 0) return { ok: false, error: 'expired' }
  return { ok: true }
}

// `containerId: null` (appelée depuis la recherche/l'écran d'un set, hors de
// tout container ouvert) ajoute au
// container racine de la collection du compte, résolu ici par
// `bootstrapCollection` (idempotent — la collection existe déjà à ce point,
// `requireSession()` vient de la garantir ; `displayName: null` n'affecte
// que la branche « créer une collection », qui ne s'exécute jamais ici).
const addCardSchema = z.object({
  containerId: z.uuid().nullable(),
  cardId: z.uuid(),
  finish: finishSchema,
  condition: conditionSchema,
  qty: z.number().int().positive(),
  language: z.string().trim().min(1).max(8).optional(),
})

export async function addCardAction(
  input: unknown,
): Promise<{ ok: true; holdingId: string } | { ok: false; error: string }> {
  const parsed = addCardSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const containerId =
      parsed.data.containerId ??
      (await bootstrapCollection(user.id, { username: user.username, displayName: null })).containerId

    const result = await addHolding(
      user.id,
      {
        containerId,
        cardId: parsed.data.cardId,
        finish: parsed.data.finish,
        condition: parsed.data.condition,
        language: parsed.data.language ?? 'en',
      },
      parsed.data.qty,
    )
    return { ok: true, holdingId: result.holdingId }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// Édition de condition/finish depuis la feuille de détail : sans mutation
// ici, « modifier la condition » n'aurait aucun chemin d'écriture. Enveloppe
// `updateHolding`, déjà idempotent sur la clé de holding.
// `language`/`notes` (`EditCardSheet`/`EditListCardSheet`) rejoignent
// `condition`/`finish` sur ce même point d'écriture — `updateHolding`
// les portait déjà (`UpdateHoldingPatch`), seule la frontière Zod manquait.
const updateHoldingSchema = z.object({
  holdingId: z.uuid(),
  condition: conditionSchema.optional(),
  finish: finishSchema.optional(),
  language: z.string().trim().min(1).max(8).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export async function updateHoldingAction(
  input: unknown,
): Promise<{ ok: true; holdingId: string } | { ok: false; error: string }> {
  const parsed = updateHoldingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const result = await updateHolding(user.id, parsed.data.holdingId, {
      condition: parsed.data.condition,
      finish: parsed.data.finish,
      language: parsed.data.language,
      notes: parsed.data.notes,
    })
    return { ok: true, holdingId: result.holdingId }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// Notes/langue d'une ligne (`EditCardSheet`/`EditListCardSheet`) — lus
// à part de `HoldingRow` (`holdings-data.ts`) : ce ne sont pas des colonnes
// affichées dans une liste de centaines de lignes, les y ajouter grossirait
// la projection de `listHoldings` pour un besoin qui ne se pose qu'à
// l'ouverture d'une feuille sur une seule ligne — même précédent que
// `getCardDetailAction` ci-dessous pour le texte d'oracle.
export interface HoldingDetail {
  notes: string | null
  language: string
}

export async function getHoldingDetailAction(holdingId: unknown): Promise<HoldingDetail | null> {
  const id = z.uuid().parse(holdingId)
  const user = await requireSession()

  const [row] = await db
    .select({ containerId: holdings.containerId, notes: holdings.notes, language: holdings.language })
    .from(holdings)
    .where(eq(holdings.id, id))
    .limit(1)
  if (!row) return null

  await requireContainerAccess(user.id, row.containerId, 'read')
  return { notes: row.notes, language: row.language }
}

// Déplace une seule ligne vers un autre container (ligne `Binder` de
// `EditCardSheet`) — enveloppe `moveHoldings` déjà utilisé par
// `BulkEditSheet`/`ActionBar` pour une sélection entière ; ici la
// sélection n'a qu'un seul élément.
const moveHoldingSchema = z.object({ holdingId: z.uuid(), targetContainerId: z.uuid() })

export async function moveHoldingAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = moveHoldingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    await moveHoldings(user.id, [parsed.data.holdingId], parsed.data.targetContainerId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// Binders de la collection + le container racine, pour la ligne `Binder` de
// `EditCardSheet` — même source que `listBulkMoveTargetsAction`
// (`bulk-actions.ts`) mais incluant `kind: 'collection'` (rendu comme
// « No binder », la destination qui délie une carte de tout binder) : cette
// feuille édite une seule ligne, jamais toute la sélection groupée, un
// second fichier plutôt qu'un paramètre supplémentaire sur celui-là pour
// ne pas faire porter à `bulk-actions.ts` un cas qu'il n'a jamais eu.
export interface HoldingBinderOption {
  id: string
  name: string
  isRoot: boolean
}

export async function listHoldingBindersAction(containerId: unknown): Promise<HoldingBinderOption[]> {
  const id = z.uuid().parse(containerId)
  const user = await requireSession()
  const access = await requireContainerAccess(user.id, id, 'read')

  const rows = await db
    .select({ id: containers.id, name: containers.name, kind: containers.kind })
    .from(containers)
    .where(eq(containers.collectionId, access.collectionId))
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))

  return rows
    .filter((row): row is { id: string; name: string; kind: ContainerKind } =>
      row.kind === 'binder' || row.kind === 'collection',
    )
    .map((row) => ({
      id: row.id,
      name: row.kind === 'collection' ? 'No binder' : row.name,
      isRoot: row.kind === 'collection',
    }))
}

export interface CardDetail {
  id: string
  name: string
  typeLine: string
  oracleText: string | null
  imageUris: ScryfallImageUris | null
}

// Détail catalogue pour la feuille de carte (type, texte
// d'oracle, illustration `normal` — absentes de `HoldingRow`, qui ne porte
// que ce qu'une ligne de liste affiche). Lecture catalogue, pas de collection
// : une session valide suffit, `requireContainerAccess` n'a rien à vérifier
// ici (aucun `containerId` en jeu).
export async function getCardDetailAction(cardId: unknown): Promise<CardDetail | null> {
  const id = z.uuid().parse(cardId)
  await requireSession()

  const [row] = await db
    .select({
      id: cards.id,
      name: cards.name,
      typeLine: cards.typeLine,
      oracleText: cards.oracleText,
      imageUris: cards.imageUris,
    })
    .from(cards)
    .where(eq(cards.id, id))
    .limit(1)

  return row ?? null
}

// Contenu du panneau d'aperçu desktop — la
// seule voie par laquelle le client atteint `getCardPreview`, avec les deux
// identifiants validés par Zod à la frontière (docs/development.md), jamais castés.
// L'autorisation reste celle de `requireContainerAccess`, appelée par
// `getCardPreview` lui-même : un `containerId` d'URL ne donne pas accès à la
// collection d'autrui.
//
// Déclenché sur la ligne **sélectionnée**, jamais au survol (en charger
// davantage ferait une requête par ligne survolée).
const cardPreviewSchema = z.object({ cardId: z.uuid(), containerId: z.uuid() })

export async function getCardPreviewAction(input: unknown): Promise<CardPreview> {
  const parsed = cardPreviewSchema.parse(input)
  const user = await requireSession()
  return getCardPreview(user.id, parsed.cardId, parsed.containerId)
}
