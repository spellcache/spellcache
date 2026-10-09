'use server'

// Actions de partage et de liste : basculer la visibilité, résoudre un aperçu,
// importer, annuler, exporter. Toute entrée externe est validée par Zod à la
// frontière (docs/development.md) — jamais castée, jamais lue avant
// `safeParse`.
import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  cards,
  containers,
  holdings,
  importLists,
  type Condition,
  type DeckZone,
  type Finish,
  type Visibility,
} from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { ContainerAccessError, requireContainerAccess, resolveAccess } from '@/lib/collections/authorize'
import {
  NotOwnerError,
  NotShareableError,
  SHAREABLE_KINDS,
  setContainerVisibility,
} from '@/lib/containers/containers'
import { DeckLockedError, assertNotDeckLocked } from '@/lib/containers/holdings'
import { recomputeContainerStats } from '@/lib/containers/stats'
import { db } from '@spellcache/db'
import { parseList } from '@/lib/lists/parse-list'
import { resolveList, type ResolveSummary, type ResolvedLine } from '@/lib/lists/resolve-list'
import { getPreferences } from '@/lib/preferences'
import { currencyOf } from '@/lib/price-source'

// Une ligne de liste texte ne porte ni finition, ni état, ni langue (un
// export CSV, si) : à défaut, elle écrit la même clé que le reste de l'app
// pour un ajout « nu » (`lib/containers/holdings.ts` — mêmes défauts de
// colonne que `packages/db/src/schema.ts`).
const IMPORT_FINISH: Finish = 'nonfoil'
const IMPORT_CONDITION: Condition = 'nm'
const IMPORT_LANGUAGE = 'en'
const DEFAULT_ZONE: DeckZone = 'main'

const conditionSchema = z.enum(['nm', 'lp', 'mp', 'hp', 'dmg'])

// Caractères d'une liste collée ou d'un fichier importé.
const MAX_LIST_TEXT = 1_500_000

// ---------------------------------------------------------------- visibilité

const setVisibilitySchema = z.object({
  containerId: z.uuid(),
  visibility: z.enum(['private', 'public']),
})

export async function setVisibilityAction(
  input: unknown,
): Promise<{ ok: true; visibility: Visibility } | { ok: false; error: string }> {
  const parsed = setVisibilitySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const { containerId, visibility } = parsed.data

  try {
    const updated = await setContainerVisibility(user.id, containerId, visibility)

    // La page publique est rendue dynamiquement (`dynamic = 'force-dynamic'`
    // dans `app/(public)/s/[containerId]/page.tsx`) : aucune entrée de cache
    // de route complète ne survit à ce basculement. `revalidatePath` reste
    // appelé pour les caches de données de Next qu'une évolution ultérieure
    // introduirait, et pour que le retour privé → 404 ne dépende pas d'un
    // seul mécanisme : rendre public puis privé ne doit pas laisser la page
    // en cache.
    revalidatePath(`/s/${containerId}`)
    revalidatePath('/collection')

    return { ok: true, visibility: updated.visibility }
  } catch (error) {
    if (error instanceof NotOwnerError) return { ok: false, error: 'not_owner' }
    if (error instanceof NotShareableError) return { ok: false, error: 'not_shareable' }
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export interface SharingState {
  visibility: Visibility
  // `false` pour un `editor` : l'entrée de menu reste rendue mais inerte —
  // voir `setContainerVisibility`.
  canShare: boolean
  shareable: boolean
}

const sharingStateSchema = z.object({ containerId: z.uuid() })

export async function getSharingStateAction(
  input: unknown,
): Promise<{ ok: true; state: SharingState } | { ok: false; error: string }> {
  const parsed = sharingStateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const access = await resolveAccess(user.id, parsed.data.containerId)
  if (!access) return { ok: false, error: 'forbidden' }

  const [row] = await db
    .select({ kind: containers.kind, visibility: containers.visibility })
    .from(containers)
    .where(eq(containers.id, parsed.data.containerId))
    .limit(1)
  if (!row) return { ok: false, error: 'failed' }

  return {
    ok: true,
    state: {
      visibility: row.visibility,
      canShare: access.role === 'owner',
      shareable: SHAREABLE_KINDS.includes(row.kind),
    },
  }
}

// ------------------------------------------------------------------- aperçu

const resolveListSchema = z.object({
  containerId: z.uuid(),
  // Un export CSV de collection complet (ManaBox : ~200 caractères par
  // ligne) dépasse vite 200 000 caractères ; la borne reste sous la limite
  // de corps des Server Actions (`serverActions.bodySizeLimit`,
  // next.config.ts).
  text: z.string().max(MAX_LIST_TEXT),
})

export interface ListPreview {
  lines: ResolvedLine[]
  summary: ResolveSummary
  ignored: string[]
}

// N'écrit **rien** : l'import n'écrit rien tant que l'aperçu n'est pas
// validé. Aucune transaction, aucun `insert` :
// cette action lit le catalogue et rend la main.
export async function resolveListAction(
  input: unknown,
): Promise<{ ok: true; preview: ListPreview } | { ok: false; error: string }> {
  const parsed = resolveListSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    await requireContainerAccess(user.id, parsed.data.containerId, 'write')
    const currency = currencyOf(await getPreferences(user.id))

    const { lines, ignored } = parseList(parsed.data.text)
    const resolved = await resolveList(lines, { currency })

    return { ok: true, preview: { lines: resolved.lines, summary: resolved.summary, ignored } }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

// ------------------------------------------------------------------- import

const importListSchema = z.object({
  containerId: z.uuid(),
  text: z.string().max(MAX_LIST_TEXT),
  // Arbitrage de l'utilisateur sur les lignes ambiguës, et correction des
  // lignes inconnues : l'index désigne la ligne dans `ParseResult.lines`,
  // le même ordre que celui rendu par `resolveListAction`.
  choices: z
    .array(z.object({ lineIndex: z.number().int().min(0), cardId: z.uuid() }))
    .max(2_000)
    .optional(),
  // Arbitrage par défaut de la feuille `Import & export` unifiée (« Condition
  // when the source doesn't say », « Treat as foil by default ») — une ligne
  // collée ne porte ni condition ni finition, ces deux réglages disent quoi
  // écrire à leur place. Optionnels : `ImportSheet` omet les deux et
  // retombe sur `IMPORT_CONDITION`/`IMPORT_FINISH` (nm/nonfoil).
  condition: conditionSchema.optional(),
  foil: z.boolean().optional(),
})

interface ImportDelta {
  holdingId: string
  // Ce que **cet** import a ajouté à cette ligne, jamais son état final :
  // annuler retire exactement ce delta, une ligne qui préexistait retrouve
  // donc sa quantité d'origine au lieu d'être supprimée.
  delta: number
}

interface ImportUndoEntry {
  userId: string
  containerId: string
  importListId: string
  deltas: ImportDelta[]
  expiresAt: number
}

// Même patron que `lib/containers/containers.ts` et
// `lib/containers/holdings.ts` : fenêtre de 6 secondes, jeton en mémoire de
// process.
const UNDO_TTL_MS = 6_000

declare global {
  var __spellcacheImportUndo: Map<string, ImportUndoEntry> | undefined
}

function undoStore(): Map<string, ImportUndoEntry> {
  if (!globalThis.__spellcacheImportUndo) {
    globalThis.__spellcacheImportUndo = new Map()
  }
  return globalThis.__spellcacheImportUndo
}

interface PlannedWrite {
  cardId: string
  zone: DeckZone
  qty: number
  finish: Finish
  condition: Condition
  language: string
}

// Même clé de fusion que `matchKey` (lib/containers/holdings.ts) :
// `(card_id, finish, condition, language, zone)` dans un même container.
function writeKey(row: Omit<PlannedWrite, 'qty'>): string {
  return `${row.cardId}:${row.zone}:${row.finish}:${row.condition}:${row.language}`
}

// Choisit la carte à écrire pour une ligne résolue. `null` = la ligne n'est
// pas importée : seules les lignes `resolved` et les `ambiguous` arbitrées
// sont importées ; les `unknown` sont rapportées à l'utilisateur.
//
// Un `cardId` venu du client n'est jamais accepté tel quel : il doit figurer
// parmi les candidats que le serveur vient lui-même de calculer pour cette
// ligne. Sans ce contrôle, un appelant pourrait faire écrire n'importe quelle
// carte du catalogue sous couvert d'arbitrage.
function chooseCard(line: ResolvedLine, choice: string | undefined): string | null {
  if (line.status === 'resolved') return line.cardId

  const candidates = line.candidates ?? []
  if (choice && candidates.some((candidate) => candidate.cardId === choice)) return choice

  // Défaut d'arbitrage : l'impression la moins chère du catalogue —
  // `resolveList` a déjà trié les candidats par prix croissant. Ne s'applique
  // qu'aux ambiguës : une ligne `unknown` sans correction explicite reste non
  // importée, ses propositions trigramme ne sont que des suggestions.
  if (line.status === 'ambiguous' && candidates.length > 0) return candidates[0]!.cardId

  return null
}

export async function importListAction(
  input: unknown,
): Promise<{ ok: true; imported: number; undoToken: string } | { ok: false; error: string }> {
  const parsed = importListSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const { containerId, text } = parsed.data
  // Défauts d'écriture de cet import — `IMPORT_CONDITION`/`IMPORT_FINISH`
  // tant que la feuille `Import & export` unifiée n'a rien précisé.
  const writeCondition: Condition = parsed.data.condition ?? IMPORT_CONDITION
  const writeFinish: Finish = parsed.data.foil ? 'foil' : IMPORT_FINISH

  try {
    await requireContainerAccess(user.id, containerId, 'write')
    // Un deck `built` refuse toute écriture — l'import est une écriture de
    // holdings comme une autre.
    await assertNotDeckLocked(db, containerId)

    const [container] = await db
      .select({ kind: containers.kind })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1)
    if (!container) return { ok: false, error: 'failed' }

    const currency = currencyOf(await getPreferences(user.id))
    const { lines } = parseList(text)
    // Le serveur ré-analyse et ré-résout le texte au lieu de faire confiance
    // aux `cardId` de l'aperçu : seuls des noms réellement présents au
    // catalogue peuvent atteindre `holdings`.
    const { lines: resolvedLines } = await resolveList(lines, { currency })

    const choices = new Map((parsed.data.choices ?? []).map((c) => [c.lineIndex, c.cardId]))

    // Regroupées par clé de fusion avant écriture : quatre lignes
    // `1 Lightning Bolt` produisent un seul holding de 4, jamais quatre
    // lignes ni quatre allers-retours en base. Finition, état et langue
    // viennent de la ligne quand un export CSV les donne, sinon des défauts
    // de la feuille d'import.
    const planned = new Map<string, PlannedWrite>()
    for (const [index, line] of resolvedLines.entries()) {
      const cardId = chooseCard(line, choices.get(index))
      if (!cardId) continue

      // La zone ne concerne qu'un deck : un binder, une liste ou la
      // collection racine restent sur `main`, la valeur par défaut de la
      // colonne, quoi que le texte collé annonce.
      const zone: DeckZone = container.kind === 'deck' ? (line.zone ?? DEFAULT_ZONE) : DEFAULT_ZONE
      const write = {
        cardId,
        zone,
        qty: line.qty,
        finish: line.finish ?? writeFinish,
        condition: line.condition ?? writeCondition,
        language: line.language ?? IMPORT_LANGUAGE,
      }
      const key = writeKey(write)
      const existing = planned.get(key)
      if (existing) existing.qty += line.qty
      else planned.set(key, write)
    }

    if (planned.size === 0) return { ok: false, error: 'nothing_to_import' }

    const writes = [...planned.values()]
    const cardIds = [...new Set(writes.map((write) => write.cardId))]

    const { deltas, imported, importListId } = await db.transaction(async (tx) => {
      // Une seule lecture pour toutes les lignes de l'import, verrouillée : les
      // fusions concurrentes attendent, comme dans `addHolding`.
      const existingRows = await tx
        .select()
        .from(holdings)
        .where(and(eq(holdings.containerId, containerId), inArray(holdings.cardId, cardIds)))
        .for('update')

      // La zone fait partie de la clé, sinon un import au sideboard
      // écraserait le mainboard.
      const byKey = new Map(existingRows.map((row) => [writeKey(row), row]))

      const recorded: ImportDelta[] = []
      const toInsert: Array<typeof holdings.$inferInsert> = []

      for (const write of writes) {
        const row = byKey.get(writeKey(write))
        if (row) {
          await tx
            .update(holdings)
            .set({
              qty: row.qty + write.qty,
              // Même couplage qu'à l'insertion ci-dessous : une ligne déjà
              // en zone `commander` doit porter `is_commander`, jamais
              // rétrogradée par une fusion.
              isCommander: row.isCommander || write.zone === 'commander',
            })
            .where(eq(holdings.id, row.id))
          recorded.push({ holdingId: row.id, delta: write.qty })
        } else {
          toInsert.push({
            containerId,
            cardId: write.cardId,
            qty: write.qty,
            finish: write.finish,
            condition: write.condition,
            language: write.language,
            zone: write.zone,
            // `zone` et `is_commander` s'écrivent **ensemble**, jamais l'un
            // sans l'autre : une ligne `zone = 'commander'` avec
            // `is_commander = false` est un état que ni `getDeck` ni
            // `deck-view` ne savent surfacer, et que `hasCommanderHolding` rend
            // indéfiniment bloquant. Une section `Commander` d'une liste collée
            // doit donc produire un vrai commandant, pas une ligne de mainboard
            // déguisée.
            isCommander: write.zone === 'commander',
          })
        }
      }

      if (toInsert.length > 0) {
        // Une seule insertion multi-lignes, pas une par carte. Le
        // `returning` d'un `insert ... values` rend les lignes dans l'ordre
        // fourni : l'index de `created` désigne donc la même ligne que celui
        // de `toInsert`, et le delta mémorisé est bien la quantité que cet
        // import vient d'écrire.
        const created = await tx.insert(holdings).values(toInsert).returning({ id: holdings.id })
        created.forEach((row, index) => {
          recorded.push({ holdingId: row.id, delta: toInsert[index]!.qty })
        })
      }

      await recomputeContainerStats(containerId, tx)

      const totalCopies = writes.reduce((sum, write) => sum + write.qty, 0)

      // Traçabilité : `line_count` compte les lignes de carte réellement
      // écrites, pas les lignes du texte collé ni le nombre d'exemplaires.
      const [journal] = await tx
        .insert(importLists)
        .values({ containerId, userId: user.id, lineCount: writes.length })
        .returning({ id: importLists.id })

      return { deltas: recorded, imported: totalCopies, importListId: journal!.id }
    })

    const undoToken = randomUUID()
    undoStore().set(undoToken, {
      userId: user.id,
      containerId,
      importListId,
      deltas,
      expiresAt: Date.now() + UNDO_TTL_MS,
    })
    const timer = setTimeout(() => undoStore().delete(undoToken), UNDO_TTL_MS)
    timer.unref?.()

    revalidatePath('/collection')

    return { ok: true, imported, undoToken }
  } catch (error) {
    if (error instanceof DeckLockedError) return { ok: false, error: 'deck_locked' }
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

// ---------------------------------------------------------------- annulation

const undoImportSchema = z.object({ undoToken: z.uuid() })

// Retire **le delta**, jamais un état final restauré :
// une ligne créée par l'import disparaît, une ligne qui préexistait
// redescend exactement de ce que l'import lui avait ajouté.
export async function undoImportAction(
  input: unknown,
): Promise<{ ok: true; undone: boolean } | { ok: false; error: string }> {
  const parsed = undoImportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const entry = undoStore().get(parsed.data.undoToken)
  if (!entry || entry.expiresAt < Date.now()) {
    undoStore().delete(parsed.data.undoToken)
    return { ok: true, undone: false }
  }
  if (entry.userId !== user.id) return { ok: false, error: 'forbidden' }

  try {
    await requireContainerAccess(user.id, entry.containerId, 'write')

    await db.transaction(async (tx) => {
      const ids = entry.deltas.map((delta) => delta.holdingId)
      const rows = await tx
        .select({ id: holdings.id, qty: holdings.qty })
        .from(holdings)
        .where(inArray(holdings.id, ids))
        .for('update')
      const qtyById = new Map(rows.map((row) => [row.id, row.qty]))

      const toDelete: string[] = []
      for (const { holdingId, delta } of entry.deltas) {
        const currentQty = qtyById.get(holdingId)
        // La ligne a disparu entre-temps (suppression manuelle pendant les
        // 6 secondes) : rien à défaire, et surtout rien à recréer.
        if (currentQty === undefined) continue

        const next = currentQty - delta
        if (next > 0) {
          await tx.update(holdings).set({ qty: next }).where(eq(holdings.id, holdingId))
        } else {
          toDelete.push(holdingId)
        }
      }
      if (toDelete.length > 0) {
        await tx.delete(holdings).where(inArray(holdings.id, toDelete))
      }

      await tx.delete(importLists).where(eq(importLists.id, entry.importListId))
      await recomputeContainerStats(entry.containerId, tx)
    })

    undoStore().delete(parsed.data.undoToken)
    revalidatePath('/collection')
    return { ok: true, undone: true }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

// -------------------------------------------------------------------- export

export interface ExportLine {
  qty: number
  name: string
  setCode: string
  collectorNumber: string
  // Structure du deck. Sans elle, l'export d'un deck Commander se
  // réimportait à plat : commandant et côté fondus dans le mainboard, alors
  // que `parseList` sait lire les trois en-têtes de section. `is_commander`
  // fait foi sur `zone` — même normalisation que `getDeck` et
  // `lib/sharing/public-container.ts`.
  zone: DeckZone
  isCommander: boolean
}

const exportSchema = z.object({ containerId: z.uuid() })

// Toutes les cartes du container, pas seulement la première page de la liste
// virtualisée : un export tronqué ne se réimporterait pas à l'identique.
// Une seule requête, jointure `holdings → cards`.
export async function getContainerListAction(
  input: unknown,
): Promise<{ ok: true; lines: ExportLine[] } | { ok: false; error: string }> {
  const parsed = exportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    await requireContainerAccess(user.id, parsed.data.containerId, 'read')

    const rows = await db
      .select({
        qty: holdings.qty,
        name: cards.name,
        setCode: cards.setCode,
        collectorNumber: cards.collectorNumber,
        zone: holdings.zone,
        isCommander: holdings.isCommander,
      })
      .from(holdings)
      .innerJoin(cards, eq(cards.id, holdings.cardId))
      .where(eq(holdings.containerId, parsed.data.containerId))
      .orderBy(asc(cards.name), asc(cards.setCode), asc(cards.collectorNumber))

    return { ok: true, lines: rows }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
