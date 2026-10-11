// Échanges de cartes (outil Trading mode).
//
// Autorisation : être partie d'un échange donne le droit de le LIRE, jamais
// d'écrire dans une collection. Chaque écriture de holdings est vérifiée par
// `requireCollectionAccess` pour la partie à qui appartient la collection
// touchée — l'acceptation de cette partie est son consentement, le contrôle
// d'accès reste celui de `collection_members` (docs/development.md : aucun
// second chemin d'autorisation). Une partie ne voit jamais la collection de
// l'autre, seulement les lignes que l'autre a mises dans l'échange.
import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'

import {
  cardPrices,
  cards,
  containers,
  holdings,
  tradeLines,
  trades,
  users,
  type Condition,
  type Finish,
  type Holding,
  type Trade,
  type TradeCurrency,
  type TradeLine,
  type TradeMode,
  type TradeParty,
  type TradeStatus,
} from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { thumbUrl } from '@spellcache/core/images'
import {
  ContainerAccessError,
  requireCollectionAccess,
} from '@/lib/collections/authorize'
import { getActiveCollectionId } from '@/lib/collections/active'
import { recomputeContainerStats } from '@/lib/containers/stats'
import { currencyOf } from '@/lib/price-source'

import { PARTNER_QUERY_MIN } from './partners'
import { clampRate, marketPriceMinor, sideValueMinor, type LatestPrices } from './pricing'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

export type TradeErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'not_open'
  | 'stale'
  | 'empty'
  | 'unavailable'
  | 'expired'
  | 'invalid'

export class TradeError extends Error {
  constructor(
    readonly code: TradeErrorCode,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export type { TradeMode }

// Seuls ces containers portent des cartes possédées : une liste est une
// envie, un deck se défait d'abord (`plan`/`assemble` ne sont pas physiques,
// `built` est verrouillé) — même périmètre que `lib/decks/availability.ts`.
const TRADEABLE_KINDS = ['collection', 'binder'] as const

const IN_PERSON_DEFAULT_NAME = 'In person'
// Le container racine porte le nom de la collection ; l'app l'affiche
// partout comme « Collection ».
const ROOT_LABEL = 'Collection'

function modeOf(trade: Trade): TradeMode {
  return trade.mode
}

function otherParty(party: TradeParty): TradeParty {
  return party === 'initiator' ? 'counterparty' : 'initiator'
}

function partyOf(trade: Trade, userId: string): TradeParty | null {
  if (trade.initiatorId === userId) return 'initiator'
  if (trade.counterpartyId === userId) return 'counterparty'
  return null
}

function collectionOf(trade: Trade, party: TradeParty): string | null {
  return party === 'initiator'
    ? trade.initiatorCollectionId
    : trade.counterpartyCollectionId
}

function destinationOf(trade: Trade, party: TradeParty): string | null {
  return party === 'initiator'
    ? trade.initiatorContainerId
    : trade.counterpartyContainerId
}

function acceptedRevisionOf(trade: Trade, party: TradeParty): number | null {
  return party === 'initiator'
    ? trade.initiatorAcceptedRevision
    : trade.counterpartyAcceptedRevision
}

function rateOf(trade: Trade, giver: TradeParty): number {
  return giver === 'initiator' ? trade.initiatorRatePct : trade.counterpartyRatePct
}

// Qui écrit les lignes d'un côté : la partie qui donne, sauf en personne où
// l'initiateur saisit aussi ce qu'il reçoit.
function canEditSide(trade: Trade, party: TradeParty, giver: TradeParty): boolean {
  return modeOf(trade) === 'in_person' ? party === 'initiator' : party === giver
}

async function assertCollectionWrite(
  userId: string,
  collectionId: string | null,
  executor: Executor = db,
): Promise<void> {
  if (!collectionId) throw new TradeError('forbidden', 'Collection no longer exists.')
  try {
    await requireCollectionAccess(userId, collectionId, 'write', executor)
  } catch (error) {
    if (error instanceof ContainerAccessError)
      throw new TradeError('forbidden', error.message)
    throw error
  }
}

// Un échange inconnu et un échange dont on n'est pas partie répondent tous
// deux `not_found` : rien ne révèle l'existence d'un échange tiers.
async function loadTradeFor(
  executor: Executor,
  userId: string,
  tradeId: string,
  lock = false,
): Promise<{ trade: Trade; party: TradeParty }> {
  const query = executor.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  const [trade] = lock ? await query.for('update') : await query
  const party = trade ? partyOf(trade, userId) : null
  if (!trade || !party) throw new TradeError('not_found')
  return { trade, party }
}

interface WritableTrade {
  trade: Trade
  party: TradeParty
  collectionId: string
}

// Garde de toute écriture : verrou sur l'échange, échange encore ouvert,
// droit d'écriture sur sa propre collection. La contrepartie rattache ici sa
// collection active à sa première écriture.
async function lockWritable(
  tx: Tx,
  userId: string,
  tradeId: string,
): Promise<WritableTrade> {
  const { trade, party } = await loadTradeFor(tx, userId, tradeId, true)
  if (trade.status !== 'open') throw new TradeError('not_open')

  let collectionId = collectionOf(trade, party)
  if (party === 'counterparty' && collectionId === null) {
    collectionId = await getActiveCollectionId(userId, tx)
    if (collectionId) {
      await tx
        .update(trades)
        .set({ counterpartyCollectionId: collectionId })
        .where(eq(trades.id, trade.id))
      trade.counterpartyCollectionId = collectionId
    }
  }
  await assertCollectionWrite(userId, collectionId, tx)
  return { trade, party, collectionId: collectionId! }
}

// Toute écriture remonte l'échange en tête des listes des deux parties.
async function touch(tx: Tx, tradeId: string): Promise<void> {
  await tx.update(trades).set({ updatedAt: new Date() }).where(eq(trades.id, tradeId))
}

async function bumpRevision(tx: Tx, tradeId: string): Promise<void> {
  await tx
    .update(trades)
    .set({ revision: sql`${trades.revision} + 1`, updatedAt: new Date() })
    .where(eq(trades.id, tradeId))
}

async function latestPricesOf(
  executor: Executor,
  cardIds: string[],
): Promise<Map<string, LatestPrices>> {
  const unique = [...new Set(cardIds)]
  if (unique.length === 0) return new Map()
  const rows = await executor
    .selectDistinctOn([cardPrices.cardId], {
      cardId: cardPrices.cardId,
      usd: cardPrices.usd,
      usd_foil: cardPrices.usdFoil,
      eur: cardPrices.eur,
      eur_foil: cardPrices.eurFoil,
    })
    .from(cardPrices)
    .where(inArray(cardPrices.cardId, unique))
    .orderBy(cardPrices.cardId, desc(cardPrices.day))
  return new Map(rows.map(({ cardId, ...prices }) => [cardId, prices]))
}

// --- Création ---------------------------------------------------------------

export interface CreateTradeInput {
  // Compte de l'instance ; absent = échange en personne.
  counterpartyId?: string
  counterpartyName?: string
}

export async function createTrade(
  userId: string,
  input: CreateTradeInput,
): Promise<{ tradeId: string }> {
  const collectionId = await getActiveCollectionId(userId)
  await assertCollectionWrite(userId, collectionId)

  const [me] = await db
    .select({ username: users.username, priceSource: users.priceSource })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!me?.username) throw new TradeError('forbidden')

  let counterpartyName = input.counterpartyName?.trim() || IN_PERSON_DEFAULT_NAME
  if (input.counterpartyId) {
    const [partner] = await db
      .select({ username: users.username })
      .from(users)
      .where(
        and(
          eq(users.id, input.counterpartyId),
          ne(users.id, userId),
          eq(users.toolTradingMode, true),
          isNotNull(users.username),
        ),
      )
      .limit(1)
    if (!partner?.username) throw new TradeError('not_found', 'Unknown trade partner.')
    counterpartyName = partner.username
  }

  const [created] = await db
    .insert(trades)
    .values({
      mode: input.counterpartyId ? 'account' : 'in_person',
      currency: currencyOf(me),
      initiatorId: userId,
      initiatorName: me.username,
      initiatorCollectionId: collectionId,
      counterpartyId: input.counterpartyId ?? null,
      counterpartyName,
    })
    .returning({ id: trades.id })
  if (!created) throw new Error('Failed to create trade.')
  return { tradeId: created.id }
}

// Comptes joignables : ceux qui ont activé l'outil, recherchés par préfixe de
// pseudonyme. Un compte qui ne l'a pas activé n'apparaît jamais.
export interface TradePartner {
  id: string
  username: string
}

export async function searchTradePartners(
  userId: string,
  query: string,
): Promise<TradePartner[]> {
  const term = query.trim().toLowerCase()
  if (term.length < PARTNER_QUERY_MIN) return []
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      and(
        ne(users.id, userId),
        eq(users.toolTradingMode, true),
        isNotNull(users.username),
        ilike(users.username, `${escapeLike(term)}%`),
      ),
    )
    .orderBy(asc(users.username))
    .limit(8)
  return rows.map((row) => ({ id: row.id, username: row.username ?? '' }))
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`)
}

// --- Lignes -----------------------------------------------------------------

export async function addHoldingLine(
  userId: string,
  tradeId: string,
  holdingId: string,
  qty: number,
): Promise<void> {
  if (!Number.isInteger(qty) || qty < 1) throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade, party, collectionId } = await lockWritable(tx, userId, tradeId)

    const [holding] = await tx
      .select({
        holding: holdings,
        collectionId: containers.collectionId,
        kind: containers.kind,
      })
      .from(holdings)
      .innerJoin(containers, eq(containers.id, holdings.containerId))
      .where(eq(holdings.id, holdingId))
      .limit(1)
    if (
      !holding ||
      holding.collectionId !== collectionId ||
      !(TRADEABLE_KINDS as readonly string[]).includes(holding.kind)
    ) {
      throw new TradeError('unavailable')
    }

    const [existing] = await tx
      .select()
      .from(tradeLines)
      .where(
        and(
          eq(tradeLines.tradeId, trade.id),
          eq(tradeLines.giver, party),
          eq(tradeLines.holdingId, holdingId),
        ),
      )
      .limit(1)
    const nextQty = (existing?.qty ?? 0) + qty
    if (nextQty > holding.holding.qty) throw new TradeError('unavailable')

    if (existing) {
      await tx
        .update(tradeLines)
        .set({ qty: nextQty })
        .where(eq(tradeLines.id, existing.id))
    } else {
      await tx.insert(tradeLines).values({
        tradeId: trade.id,
        giver: party,
        cardId: holding.holding.cardId,
        finish: holding.holding.finish,
        condition: holding.holding.condition,
        language: holding.holding.language,
        qty,
        holdingId,
      })
    }
    await bumpRevision(tx, trade.id)
  })
}

export interface CatalogLineInput {
  cardId: string
  finish: Finish
  condition: Condition
  language: string
  qty: number
}

// Ce qu'on reçoit lors d'un échange en personne : la carte n'existe dans
// aucune collection de l'instance, elle vient du catalogue.
export async function addCatalogLine(
  userId: string,
  tradeId: string,
  input: CatalogLineInput,
): Promise<void> {
  if (!Number.isInteger(input.qty) || input.qty < 1) throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) !== 'in_person' || party !== 'initiator')
      throw new TradeError('forbidden')

    const [card] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.id, input.cardId))
      .limit(1)
    if (!card) throw new TradeError('invalid')

    const [existing] = await tx
      .select()
      .from(tradeLines)
      .where(
        and(
          eq(tradeLines.tradeId, trade.id),
          eq(tradeLines.giver, 'counterparty'),
          eq(tradeLines.cardId, input.cardId),
          eq(tradeLines.finish, input.finish),
          eq(tradeLines.condition, input.condition),
          eq(tradeLines.language, input.language),
        ),
      )
      .limit(1)

    if (existing) {
      await tx
        .update(tradeLines)
        .set({ qty: existing.qty + input.qty })
        .where(eq(tradeLines.id, existing.id))
    } else {
      await tx
        .insert(tradeLines)
        .values({ tradeId: trade.id, giver: 'counterparty', ...input })
    }
    await bumpRevision(tx, trade.id)
  })
}

export interface UpdateLinePatch {
  qty?: number
  // `null` efface le prix saisi et revient au prix du marché.
  priceOverrideMinor?: number | null
}

async function lockLine(tx: Tx, tradeId: string, lineId: string): Promise<TradeLine> {
  const [line] = await tx
    .select()
    .from(tradeLines)
    .where(and(eq(tradeLines.id, lineId), eq(tradeLines.tradeId, tradeId)))
    .for('update')
    .limit(1)
  // Ligne retirée entre-temps (double tap, autre partie) : l'écran est en
  // retard sur l'échange.
  if (!line) throw new TradeError('stale')
  return line
}

// La quantité appartient à qui saisit ce côté ; le prix d'une ligne, lui, se
// négocie : les deux parties peuvent le corriger, ce qui invalide toute
// acceptation en cours.
export async function updateLine(
  userId: string,
  tradeId: string,
  lineId: string,
  patch: UpdateLinePatch,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    const line = await lockLine(tx, trade.id, lineId)
    const set: Partial<Pick<TradeLine, 'qty' | 'priceOverrideMinor'>> = {}

    if (patch.qty !== undefined) {
      if (!canEditSide(trade, party, line.giver)) throw new TradeError('forbidden')
      if (!Number.isInteger(patch.qty) || patch.qty < 1) throw new TradeError('invalid')
      if (line.holdingId) {
        const [holding] = await tx
          .select({ qty: holdings.qty })
          .from(holdings)
          .where(eq(holdings.id, line.holdingId))
          .limit(1)
        if (!holding || patch.qty > holding.qty) throw new TradeError('unavailable')
      }
      set.qty = patch.qty
    }
    if (patch.priceOverrideMinor !== undefined) {
      if (
        patch.priceOverrideMinor !== null &&
        (!Number.isInteger(patch.priceOverrideMinor) || patch.priceOverrideMinor < 0)
      ) {
        throw new TradeError('invalid')
      }
      set.priceOverrideMinor = patch.priceOverrideMinor
    }
    if (Object.keys(set).length === 0) return

    await tx.update(tradeLines).set(set).where(eq(tradeLines.id, line.id))
    await bumpRevision(tx, trade.id)
  })
}

export async function removeLine(
  userId: string,
  tradeId: string,
  lineId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    const line = await lockLine(tx, trade.id, lineId)
    if (!canEditSide(trade, party, line.giver)) throw new TradeError('forbidden')
    await tx.delete(tradeLines).where(eq(tradeLines.id, line.id))
    await bumpRevision(tx, trade.id)
  })
}

// Ajustement de la valeur des cartes données par `giver`. Négociable par les
// deux parties, comme le prix d'une ligne.
export async function setRate(
  userId: string,
  tradeId: string,
  giver: TradeParty,
  ratePct: number,
): Promise<void> {
  if (!Number.isFinite(ratePct)) throw new TradeError('invalid')
  const rate = clampRate(ratePct)
  await db.transaction(async (tx) => {
    const { trade } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) === 'in_person' && partyOf(trade, userId) !== 'initiator')
      throw new TradeError('forbidden')
    await tx
      .update(trades)
      .set(
        giver === 'initiator'
          ? { initiatorRatePct: rate }
          : { counterpartyRatePct: rate },
      )
      .where(eq(trades.id, trade.id))
    await bumpRevision(tx, trade.id)
  })
}

// Où atterrit ce que la partie reçoit : `null` = container racine de sa
// collection. Propre à chaque partie, donc sans effet sur la révision.
export async function setDestination(
  userId: string,
  tradeId: string,
  containerId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party, collectionId } = await lockWritable(tx, userId, tradeId)
    if (containerId !== null)
      await assertTradeableContainer(tx, containerId, collectionId)
    await tx
      .update(trades)
      .set(
        party === 'initiator'
          ? { initiatorContainerId: containerId }
          : { counterpartyContainerId: containerId },
      )
      .where(eq(trades.id, trade.id))
    await touch(tx, trade.id)
  })
}

async function assertTradeableContainer(
  executor: Executor,
  containerId: string,
  collectionId: string,
): Promise<void> {
  const [container] = await executor
    .select({ collectionId: containers.collectionId, kind: containers.kind })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1)
  if (
    !container ||
    container.collectionId !== collectionId ||
    !(TRADEABLE_KINDS as readonly string[]).includes(container.kind)
  ) {
    throw new TradeError('unavailable')
  }
}

// --- Conclusion -------------------------------------------------------------

// Annulation d'un échange en personne, même fenêtre de 6 secondes que les
// suppressions de holdings (lib/containers/holdings.ts).
const UNDO_TTL_MS = 6_000

interface UndoEntry {
  userId: string
  tradeId: string
  // Holdings donnés, tels qu'avant l'échange, et la quantité retirée.
  given: Array<{ snapshot: Holding; removed: number }>
  received: Array<{ holdingId: string; added: number }>
  // `trade_lines.holding_id` passe à `null` quand le holding source est
  // supprimé (`set null`) : à rétablir si l'échange est annulé.
  lineHoldings: Array<{ lineId: string; holdingId: string }>
  expiresAt: number
}

declare global {
  var __spellcacheTradeUndo: Map<string, UndoEntry> | undefined
}

function undoStore(): Map<string, UndoEntry> {
  if (!globalThis.__spellcacheTradeUndo) globalThis.__spellcacheTradeUndo = new Map()
  return globalThis.__spellcacheTradeUndo
}

interface ApplyEffects {
  given: UndoEntry['given']
  received: UndoEntry['received']
  lineHoldings: UndoEntry['lineHoldings']
}

async function rootContainerOf(tx: Tx, collectionId: string): Promise<string> {
  const [root] = await tx
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')),
    )
    .limit(1)
  if (!root) throw new TradeError('unavailable')
  return root.id
}

// Applique l'échange dans la transaction de l'appelant, l'échange déjà
// verrouillé. Tout ou rien : la moindre ligne qui ne tient plus (holding
// supprimé, quantité insuffisante, carte modifiée) annule tout.
async function applyTrade(tx: Tx, trade: Trade): Promise<ApplyEffects> {
  const mode = modeOf(trade)
  const lines = await tx.select().from(tradeLines).where(eq(tradeLines.tradeId, trade.id))
  if (lines.length === 0) throw new TradeError('empty')

  // Parties qui possèdent une collection dans cet échange : l'initiateur
  // toujours, la contrepartie seulement entre deux comptes.
  const accounts: TradeParty[] =
    mode === 'in_person' ? ['initiator'] : ['initiator', 'counterparty']
  const parties = new Map<
    TradeParty,
    { userId: string; collectionId: string; destinationId: string }
  >()
  for (const party of accounts) {
    const userId = party === 'initiator' ? trade.initiatorId : trade.counterpartyId
    const collectionId = collectionOf(trade, party)
    if (!userId || !collectionId) throw new TradeError('forbidden')
    await assertCollectionWrite(userId, collectionId, tx)
    const chosen = destinationOf(trade, party)
    if (chosen) await assertTradeableContainer(tx, chosen, collectionId)
    parties.set(party, {
      userId,
      collectionId,
      destinationId: chosen ?? (await rootContainerOf(tx, collectionId)),
    })
  }

  const effects: ApplyEffects = { given: [], received: [], lineHoldings: [] }
  const touched = new Set<string>()

  // Retraits : une ligne par holding source, quantités cumulées.
  const outgoing = new Map<string, { party: TradeParty; qty: number; line: TradeLine }>()
  for (const line of lines) {
    if (!parties.has(line.giver)) continue
    if (!line.holdingId) throw new TradeError('unavailable')
    effects.lineHoldings.push({ lineId: line.id, holdingId: line.holdingId })
    const current = outgoing.get(line.holdingId)
    outgoing.set(line.holdingId, {
      party: line.giver,
      qty: (current?.qty ?? 0) + line.qty,
      line,
    })
  }

  // Verrous posés en une fois, dans l'ordre des identifiants : deux échanges
  // qui partagent des holdings ne peuvent pas se bloquer mutuellement.
  const lockedRows =
    outgoing.size === 0
      ? []
      : await tx
          .select({
            holding: holdings,
            collectionId: containers.collectionId,
            kind: containers.kind,
          })
          .from(holdings)
          .innerJoin(containers, eq(containers.id, holdings.containerId))
          .where(inArray(holdings.id, [...outgoing.keys()]))
          .orderBy(asc(holdings.id))
          .for('update', { of: holdings })
  const locked = new Map(lockedRows.map((row) => [row.holding.id, row]))

  for (const [holdingId, { party, qty, line }] of outgoing) {
    const row = locked.get(holdingId)
    const owner = parties.get(party)!
    if (
      !row ||
      row.collectionId !== owner.collectionId ||
      !(TRADEABLE_KINDS as readonly string[]).includes(row.kind) ||
      row.holding.cardId !== line.cardId ||
      row.holding.finish !== line.finish ||
      row.holding.condition !== line.condition ||
      row.holding.language !== line.language ||
      row.holding.qty < qty
    ) {
      throw new TradeError('unavailable')
    }

    if (row.holding.qty === qty) {
      await tx.delete(holdings).where(eq(holdings.id, holdingId))
    } else {
      await tx
        .update(holdings)
        .set({ qty: row.holding.qty - qty })
        .where(eq(holdings.id, holdingId))
    }
    effects.given.push({ snapshot: row.holding, removed: qty })
    touched.add(row.holding.containerId)
  }

  // Ajouts : chez l'autre partie, si elle a une collection ici.
  for (const line of lines) {
    const receiver = parties.get(otherParty(line.giver))
    if (!receiver) continue
    const match = and(
      eq(holdings.containerId, receiver.destinationId),
      eq(holdings.cardId, line.cardId),
      eq(holdings.finish, line.finish),
      eq(holdings.condition, line.condition),
      eq(holdings.language, line.language),
      eq(holdings.zone, 'main'),
    )
    const [existing] = await tx
      .select()
      .from(holdings)
      .where(match)
      .for('update')
      .limit(1)
    if (existing) {
      await tx
        .update(holdings)
        .set({ qty: existing.qty + line.qty })
        .where(eq(holdings.id, existing.id))
      effects.received.push({ holdingId: existing.id, added: line.qty })
    } else {
      const [created] = await tx
        .insert(holdings)
        .values({
          containerId: receiver.destinationId,
          cardId: line.cardId,
          finish: line.finish,
          condition: line.condition,
          language: line.language,
          qty: line.qty,
        })
        .returning({ id: holdings.id })
      effects.received.push({ holdingId: created!.id, added: line.qty })
    }
    touched.add(receiver.destinationId)
  }

  // Prix du marché figés : l'historique ne suit plus les cours.
  const prices = await latestPricesOf(
    tx,
    lines.map((line) => line.cardId),
  )
  for (const line of lines) {
    await tx
      .update(tradeLines)
      .set({
        unitPriceMinor: marketPriceMinor(
          prices.get(line.cardId) ?? null,
          line.finish,
          trade.currency,
        ),
      })
      .where(eq(tradeLines.id, line.id))
  }

  const now = new Date()
  await tx
    .update(trades)
    .set({ status: 'completed', completedAt: now, updatedAt: now })
    .where(eq(trades.id, trade.id))

  for (const containerId of touched) await recomputeContainerStats(containerId, tx)
  return effects
}

// Échange en personne : l'initiateur conclut seul. `revision` est celle que
// l'écran affichait — une modification arrivée entre-temps refuse plutôt que
// d'appliquer autre chose que ce qui a été vu.
export async function completeInPerson(
  userId: string,
  tradeId: string,
  revision: number,
): Promise<{ undoToken: string }> {
  const effects = await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) !== 'in_person' || party !== 'initiator')
      throw new TradeError('forbidden')
    if (trade.revision !== revision) throw new TradeError('stale')
    return applyTrade(tx, trade)
  })

  const undoToken = randomUUID()
  undoStore().set(undoToken, {
    userId,
    tradeId,
    ...effects,
    expiresAt: Date.now() + UNDO_TTL_MS,
  })
  const timer = setTimeout(() => undoStore().delete(undoToken), UNDO_TTL_MS)
  timer.unref?.()
  return { undoToken }
}

// Entre deux comptes : chaque partie accepte la révision qu'elle a vue ; la
// seconde acceptation sur la même révision applique l'échange dans la même
// transaction.
export async function acceptTrade(
  userId: string,
  tradeId: string,
  revision: number,
): Promise<{ completed: boolean }> {
  return db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) !== 'account') throw new TradeError('forbidden')
    if (trade.revision !== revision) throw new TradeError('stale')

    await tx
      .update(trades)
      .set(
        party === 'initiator'
          ? { initiatorAcceptedRevision: revision }
          : { counterpartyAcceptedRevision: revision },
      )
      .where(eq(trades.id, trade.id))
    await touch(tx, trade.id)

    if (acceptedRevisionOf(trade, otherParty(party)) !== revision)
      return { completed: false }
    await applyTrade(tx, trade)
    return { completed: true }
  })
}

export async function withdrawAcceptance(userId: string, tradeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    await tx
      .update(trades)
      .set(
        party === 'initiator'
          ? { initiatorAcceptedRevision: null }
          : { counterpartyAcceptedRevision: null },
      )
      .where(eq(trades.id, trade.id))
    await touch(tx, trade.id)
  })
}

// Un échange annulé reste dans l'historique des deux parties : aucune donnée
// n'est supprimée.
export async function cancelTrade(userId: string, tradeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party } = await loadTradeFor(tx, userId, tradeId, true)
    if (trade.status !== 'open') throw new TradeError('not_open')
    if (modeOf(trade) === 'in_person' && party !== 'initiator')
      throw new TradeError('forbidden')
    await tx
      .update(trades)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(trades.id, trade.id))
  })
}

// Un jeton expiré refuse (`expired`) plutôt que de répondre « rien à
// restaurer » : l'écran doit dire que l'échange reste appliqué.
export async function undoInPerson(userId: string, undoToken: string): Promise<void> {
  const entry = undoStore().get(undoToken)
  if (!entry || entry.expiresAt < Date.now()) {
    undoStore().delete(undoToken)
    throw new TradeError('expired')
  }
  if (entry.userId !== userId) throw new TradeError('forbidden')

  await db.transaction(async (tx) => {
    const { trade } = await loadTradeFor(tx, userId, entry.tradeId, true)
    if (trade.status !== 'completed') throw new TradeError('not_open')
    const collectionId = trade.initiatorCollectionId
    await assertCollectionWrite(userId, collectionId, tx)
    const touched = new Set<string>()

    // Les cartes ont pu être déplacées ou retirées entre-temps : on ne les
    // reprend que là où l'échange les a mises en jeu (sa collection, racine
    // ou binder), sinon tout est refusé.
    const holdingIds = [
      ...entry.received.map((received) => received.holdingId),
      ...entry.given.map((given) => given.snapshot.id),
    ]
    const rows = await tx
      .select({
        holding: holdings,
        collectionId: containers.collectionId,
        kind: containers.kind,
      })
      .from(holdings)
      .innerJoin(containers, eq(containers.id, holdings.containerId))
      .where(inArray(holdings.id, holdingIds))
      .orderBy(asc(holdings.id))
      .for('update', { of: holdings })
    const current = new Map(rows.map((row) => [row.holding.id, row]))
    const inPlay = (row: (typeof rows)[number]) =>
      row.collectionId === collectionId &&
      (TRADEABLE_KINDS as readonly string[]).includes(row.kind)

    for (const { holdingId, added } of entry.received) {
      const row = current.get(holdingId)
      if (!row || !inPlay(row) || row.holding.qty < added)
        throw new TradeError('unavailable')
      if (row.holding.qty === added)
        await tx.delete(holdings).where(eq(holdings.id, holdingId))
      else
        await tx
          .update(holdings)
          .set({ qty: row.holding.qty - added })
          .where(eq(holdings.id, holdingId))
      touched.add(row.holding.containerId)
    }

    for (const { snapshot, removed } of entry.given) {
      const row = current.get(snapshot.id)
      if (row) {
        if (!inPlay(row)) throw new TradeError('unavailable')
        await tx
          .update(holdings)
          .set({ qty: row.holding.qty + removed })
          .where(eq(holdings.id, row.holding.id))
        touched.add(row.holding.containerId)
        continue
      }
      // Holding vidé par l'échange : recréé à l'identique, si son container
      // existe encore dans la collection.
      const [container] = await tx
        .select({ id: containers.id })
        .from(containers)
        .where(
          and(
            eq(containers.id, snapshot.containerId),
            eq(containers.collectionId, collectionId!),
          ),
        )
        .limit(1)
      if (!container) throw new TradeError('unavailable')
      await tx.insert(holdings).values({ ...snapshot, qty: removed })
      touched.add(snapshot.containerId)
    }

    for (const { lineId, holdingId } of entry.lineHoldings) {
      await tx
        .update(tradeLines)
        .set({ holdingId, unitPriceMinor: null })
        .where(eq(tradeLines.id, lineId))
    }
    await tx
      .update(tradeLines)
      .set({ unitPriceMinor: null })
      .where(eq(tradeLines.tradeId, trade.id))
    await tx
      .update(trades)
      .set({
        status: 'open',
        completedAt: null,
        revision: sql`${trades.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, trade.id))

    for (const containerId of touched) await recomputeContainerStats(containerId, tx)
  })

  undoStore().delete(undoToken)
}

// --- Lecture ----------------------------------------------------------------

export interface TradeLineView {
  id: string
  cardId: string
  name: string
  setCode: string
  collectorNumber: string
  finish: Finish
  condition: Condition
  language: string
  qty: number
  thumbUrl: string
  // Figé une fois l'échange conclu, courant sinon.
  marketPriceMinor: number | null
  priceOverrideMinor: number | null
  // Renseignés seulement pour les lignes de la partie qui regarde : la
  // collection de l'autre ne fuit jamais (ni container, ni quantité possédée).
  sourceName: string | null
  maxQty: number | null
}

export interface TradeSideView {
  giver: TradeParty
  ratePct: number
  canEdit: boolean
  lines: TradeLineView[]
}

export interface TradeView {
  id: string
  status: TradeStatus
  mode: TradeMode
  currency: TradeCurrency
  me: TradeParty
  partnerName: string
  revision: number
  createdAt: string
  completedAt: string | null
  // Ce que je donne / ce que je reçois, relatifs à la partie qui regarde.
  give: TradeSideView
  get: TradeSideView
  destination: { containerId: string | null; name: string | null }
  acceptedByMe: boolean
  acceptedByPartner: boolean
  // Ma collection permet-elle encore d'écrire ? Faux pour un `viewer`.
  canWrite: boolean
}

export async function getTradeView(userId: string, tradeId: string): Promise<TradeView> {
  const { trade, party } = await loadTradeFor(db, userId, tradeId)
  const mode = modeOf(trade)

  const rows = await db
    .select({
      line: tradeLines,
      name: cards.name,
      setCode: cards.setCode,
      collectorNumber: cards.collectorNumber,
      holdingQty: holdings.qty,
      sourceName: containers.name,
      sourceKind: containers.kind,
    })
    .from(tradeLines)
    .innerJoin(cards, eq(cards.id, tradeLines.cardId))
    .leftJoin(holdings, eq(holdings.id, tradeLines.holdingId))
    .leftJoin(containers, eq(containers.id, holdings.containerId))
    .where(eq(tradeLines.tradeId, trade.id))
    .orderBy(asc(tradeLines.addedAt), asc(tradeLines.id))

  const prices =
    trade.status === 'completed'
      ? new Map()
      : await latestPricesOf(
          db,
          rows.map((row) => row.line.cardId),
        )

  function toLine(row: (typeof rows)[number]): TradeLineView {
    const mine = row.line.giver === party
    return {
      id: row.line.id,
      cardId: row.line.cardId,
      name: row.name,
      setCode: row.setCode,
      collectorNumber: row.collectorNumber,
      finish: row.line.finish,
      condition: row.line.condition,
      language: row.line.language,
      qty: row.line.qty,
      thumbUrl: thumbUrl(row.line.cardId, 'small'),
      marketPriceMinor:
        trade.status === 'completed'
          ? row.line.unitPriceMinor
          : marketPriceMinor(
              prices.get(row.line.cardId) ?? null,
              row.line.finish,
              trade.currency,
            ),
      priceOverrideMinor: row.line.priceOverrideMinor,
      sourceName: mine
        ? row.sourceKind === 'collection'
          ? ROOT_LABEL
          : row.sourceName
        : null,
      maxQty: mine ? row.holdingQty : null,
    }
  }

  let canWrite = false
  const collectionId =
    collectionOf(trade, party) ??
    (party === 'counterparty' ? await getActiveCollectionId(userId) : null)
  try {
    await assertCollectionWrite(userId, collectionId)
    canWrite = true
  } catch (error) {
    if (!(error instanceof TradeError)) throw error
  }
  const open = trade.status === 'open' && canWrite

  const destinationId = destinationOf(trade, party)
  let destinationName: string | null = null
  if (destinationId) {
    const [container] = await db
      .select({ name: containers.name })
      .from(containers)
      .where(eq(containers.id, destinationId))
      .limit(1)
    destinationName = container?.name ?? null
  }

  const other = otherParty(party)
  return {
    id: trade.id,
    status: trade.status,
    mode,
    currency: trade.currency,
    me: party,
    partnerName: party === 'initiator' ? trade.counterpartyName : trade.initiatorName,
    revision: trade.revision,
    createdAt: trade.createdAt.toISOString(),
    completedAt: trade.completedAt?.toISOString() ?? null,
    give: {
      giver: party,
      ratePct: rateOf(trade, party),
      canEdit: open && canEditSide(trade, party, party),
      lines: rows.filter((row) => row.line.giver === party).map(toLine),
    },
    get: {
      giver: other,
      ratePct: rateOf(trade, other),
      canEdit: open && canEditSide(trade, party, other),
      lines: rows.filter((row) => row.line.giver === other).map(toLine),
    },
    destination: { containerId: destinationId, name: destinationName },
    acceptedByMe: acceptedRevisionOf(trade, party) === trade.revision,
    acceptedByPartner: acceptedRevisionOf(trade, other) === trade.revision,
    canWrite,
  }
}

export interface TradeSummary {
  id: string
  status: TradeStatus
  mode: TradeMode
  currency: TradeCurrency
  partnerName: string
  giveCount: number
  getCount: number
  giveMinor: number
  getMinor: number
  // Échange entre comptes ouvert dont l'autre partie attend ma réponse.
  awaitingMe: boolean
  updatedAt: string
}

const HISTORY_LIMIT = 50

export async function listTrades(userId: string): Promise<TradeSummary[]> {
  // Les échanges ouverts sont toujours listés ; seul l'historique est borné.
  const mine = or(eq(trades.initiatorId, userId), eq(trades.counterpartyId, userId))
  const open = await db
    .select()
    .from(trades)
    .where(and(mine, eq(trades.status, 'open')))
    .orderBy(desc(trades.updatedAt))
  const history = await db
    .select()
    .from(trades)
    .where(and(mine, ne(trades.status, 'open')))
    .orderBy(desc(trades.updatedAt))
    .limit(HISTORY_LIMIT)
  const rows = [...open, ...history]
  if (rows.length === 0) return []

  const lines = await db
    .select()
    .from(tradeLines)
    .where(
      inArray(
        tradeLines.tradeId,
        rows.map((trade) => trade.id),
      ),
    )
  const openCardIds = lines
    .filter(
      (line) => rows.find((trade) => trade.id === line.tradeId)?.status !== 'completed',
    )
    .map((line) => line.cardId)
  const prices = await latestPricesOf(db, openCardIds)

  return rows.map((trade) => {
    const party = partyOf(trade, userId)!
    const other = otherParty(party)
    const priced = (giver: TradeParty) =>
      lines
        .filter((line) => line.tradeId === trade.id && line.giver === giver)
        .map((line) => ({
          qty: line.qty,
          priceOverrideMinor: line.priceOverrideMinor,
          marketPriceMinor:
            trade.status === 'completed'
              ? line.unitPriceMinor
              : marketPriceMinor(
                  prices.get(line.cardId) ?? null,
                  line.finish,
                  trade.currency,
                ),
        }))
    const give = priced(party)
    const get = priced(other)
    return {
      id: trade.id,
      status: trade.status,
      mode: modeOf(trade),
      currency: trade.currency,
      partnerName: party === 'initiator' ? trade.counterpartyName : trade.initiatorName,
      giveCount: give.reduce((sum, line) => sum + line.qty, 0),
      getCount: get.reduce((sum, line) => sum + line.qty, 0),
      giveMinor: sideValueMinor(give, rateOf(trade, party)).valueMinor,
      getMinor: sideValueMinor(get, rateOf(trade, other)).valueMinor,
      awaitingMe:
        trade.status === 'open' &&
        modeOf(trade) === 'account' &&
        acceptedRevisionOf(trade, party) !== trade.revision &&
        acceptedRevisionOf(trade, other) === trade.revision,
      updatedAt: trade.updatedAt.toISOString(),
    }
  })
}

// Holdings que la partie qui regarde peut mettre dans l'échange : sa propre
// collection, containers possédés seulement.
export interface TradeableHolding {
  holdingId: string
  cardId: string
  name: string
  setCode: string
  collectorNumber: string
  finish: Finish
  condition: Condition
  language: string
  qty: number
  // Déjà dans l'échange : le sélecteur n'en propose que le reste.
  inTrade: number
  containerName: string
  thumbUrl: string
  marketPriceMinor: number | null
}

const HOLDING_SEARCH_LIMIT = 40

export async function searchTradeableHoldings(
  userId: string,
  tradeId: string,
  query: string,
): Promise<TradeableHolding[]> {
  const { trade, party } = await loadTradeFor(db, userId, tradeId)
  const collectionId =
    collectionOf(trade, party) ??
    (party === 'counterparty' ? await getActiveCollectionId(userId) : null)
  if (!collectionId) return []
  try {
    await requireCollectionAccess(userId, collectionId, 'read')
  } catch (error) {
    if (error instanceof ContainerAccessError) return []
    throw error
  }

  const words = query.trim().split(/\s+/).filter(Boolean)
  const rows = await db
    .select({
      holding: holdings,
      name: cards.name,
      setCode: cards.setCode,
      collectorNumber: cards.collectorNumber,
      containerName: containers.name,
      containerKind: containers.kind,
    })
    .from(holdings)
    .innerJoin(containers, eq(containers.id, holdings.containerId))
    .innerJoin(cards, eq(cards.id, holdings.cardId))
    .where(
      and(
        eq(containers.collectionId, collectionId),
        inArray(containers.kind, [...TRADEABLE_KINDS]),
        ...words.map((word) => ilike(cards.name, `%${escapeLike(word)}%`)),
      ),
    )
    .orderBy(asc(cards.name), asc(cards.setCode), asc(holdings.id))
    .limit(HOLDING_SEARCH_LIMIT)

  const inTrade = new Map<string, number>()
  if (rows.length > 0) {
    const existing = await db
      .select({ holdingId: tradeLines.holdingId, qty: tradeLines.qty })
      .from(tradeLines)
      .where(
        and(
          eq(tradeLines.tradeId, trade.id),
          inArray(
            tradeLines.holdingId,
            rows.map((row) => row.holding.id),
          ),
        ),
      )
    for (const line of existing) {
      if (line.holdingId)
        inTrade.set(line.holdingId, (inTrade.get(line.holdingId) ?? 0) + line.qty)
    }
  }
  const prices = await latestPricesOf(
    db,
    rows.map((row) => row.holding.cardId),
  )

  return rows.map((row) => ({
    holdingId: row.holding.id,
    cardId: row.holding.cardId,
    name: row.name,
    setCode: row.setCode,
    collectorNumber: row.collectorNumber,
    finish: row.holding.finish,
    condition: row.holding.condition,
    language: row.holding.language,
    qty: row.holding.qty,
    inTrade: inTrade.get(row.holding.id) ?? 0,
    containerName: row.containerKind === 'collection' ? ROOT_LABEL : row.containerName,
    thumbUrl: thumbUrl(row.holding.cardId, 'small'),
    marketPriceMinor: marketPriceMinor(
      prices.get(row.holding.cardId) ?? null,
      row.holding.finish,
      trade.currency,
    ),
  }))
}

export interface TradeDestination {
  // `null` = container racine.
  containerId: string | null
  name: string
}

export async function listTradeDestinations(
  userId: string,
  tradeId: string,
): Promise<TradeDestination[]> {
  const { trade, party } = await loadTradeFor(db, userId, tradeId)
  const collectionId =
    collectionOf(trade, party) ??
    (party === 'counterparty' ? await getActiveCollectionId(userId) : null)
  if (!collectionId) return []
  try {
    await requireCollectionAccess(userId, collectionId, 'write')
  } catch (error) {
    if (error instanceof ContainerAccessError) return []
    throw error
  }

  const binders = await db
    .select({ id: containers.id, name: containers.name })
    .from(containers)
    .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'binder')))
    .orderBy(asc(containers.sortOrder), asc(containers.name))
  return [
    { containerId: null, name: ROOT_LABEL },
    ...binders.map((binder) => ({ containerId: binder.id, name: binder.name })),
  ]
}
