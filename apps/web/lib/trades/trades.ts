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
import { dismantleDeckInTransaction } from '@/lib/decks/assemble'
import { parseList } from '@/lib/lists/parse-list'
import { resolveList } from '@/lib/lists/resolve-list'
import { currencyOf } from '@/lib/price-source'

import { PARTNER_QUERY_MIN } from './partners'
import { clampRate, marketPriceMinor, sideTotalMinor, type LatestPrices } from './pricing'

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

// Seuls ces containers portent des cartes possédées carte par carte : une
// liste est une envie, et un deck n'est pas physique tant qu'il n'est pas
// `built`. Les lignes d'un deck `built` sont des réservations adossées au
// stock de la collection, que seul `dismantleDeck` sait défaire : un tel deck
// s'échange donc entier (`addDeckLines`), jamais carte par carte.
const TRADEABLE_KINDS = ['collection', 'binder'] as const

// Sentinelle de `dismantleDeck` en mode `discard` : aucun container cible.
const NO_TARGET = '00000000-0000-0000-0000-000000000000'

// Bornes des saisies libres : un montant au-delà est une faute de frappe,
// une note plus longue n'est plus une note.
export const MAX_CASH_MINOR = 99_999_999
export const MAX_NOTES_LENGTH = 2000

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

function fixedOf(trade: Trade, giver: TradeParty): number | null {
  return giver === 'initiator' ? trade.initiatorValueMinor : trade.counterpartyValueMinor
}

function cashOf(trade: Trade, giver: TradeParty): number {
  return giver === 'initiator' ? trade.initiatorCashMinor : trade.counterpartyCashMinor
}

function notesOf(trade: Trade, giver: TradeParty): string | null {
  return giver === 'initiator' ? trade.initiatorNotes : trade.counterpartyNotes
}

// Entre deux comptes, la contrepartie n'agit sur l'échange qu'une fois
// l'offre acceptée ; en personne, la question ne se pose pas.
function awaitsJoin(trade: Trade): boolean {
  return modeOf(trade) === 'account' && trade.counterpartyJoinedAt === null
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
  options: { beforeJoin?: boolean } = {},
): Promise<WritableTrade> {
  const { trade, party } = await loadTradeFor(tx, userId, tradeId, true)
  if (trade.status !== 'open') throw new TradeError('not_open')
  if (party === 'counterparty' && awaitsJoin(trade) && !options.beforeJoin) {
    throw new TradeError('forbidden', 'The offer has not been accepted yet.')
  }

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

// Met `qty` exemplaires du holding dans l'échange (cumulés avec ceux qui y
// sont déjà, ou `exact` : exactement `qty`), dans la transaction de
// l'appelant, l'échange déjà verrouillé.
async function putHoldingLine(
  tx: Tx,
  trade: Trade,
  party: TradeParty,
  holding: Holding,
  qty: number,
  exact = false,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(tradeLines)
    .where(
      and(
        eq(tradeLines.tradeId, trade.id),
        eq(tradeLines.giver, party),
        eq(tradeLines.holdingId, holding.id),
      ),
    )
    .limit(1)
  const nextQty = exact ? qty : (existing?.qty ?? 0) + qty
  if (nextQty > holding.qty) throw new TradeError('unavailable')

  if (existing) {
    await tx
      .update(tradeLines)
      .set({ qty: nextQty })
      .where(eq(tradeLines.id, existing.id))
  } else {
    await tx.insert(tradeLines).values({
      tradeId: trade.id,
      giver: party,
      cardId: holding.cardId,
      finish: holding.finish,
      condition: holding.condition,
      language: holding.language,
      qty: nextQty,
      holdingId: holding.id,
    })
  }
}

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

    await putHoldingLine(tx, trade, party, holding.holding, qty)
    await bumpRevision(tx, trade.id)
  })
}

// Lignes de l'échange qui viennent d'un deck entier : celles dont le holding
// vit dans un deck. Une seule requête pour tout un échange.
async function deckLineIds(
  executor: Executor,
  tradeId: string,
): Promise<Map<string, string>> {
  const rows = await executor
    .select({ lineId: tradeLines.id, deckId: containers.id })
    .from(tradeLines)
    .innerJoin(holdings, eq(holdings.id, tradeLines.holdingId))
    .innerJoin(containers, eq(containers.id, holdings.containerId))
    .where(and(eq(tradeLines.tradeId, tradeId), eq(containers.kind, 'deck')))
  return new Map(rows.map((row) => [row.lineId, row.deckId]))
}

// Un deck `built` entre dans l'échange entier : une ligne par carte du deck,
// à sa quantité. Les cartes réellement cédées se décident à l'application,
// par le démontage du deck (voir `applyTrade`).
export async function addDeckLines(
  userId: string,
  tradeId: string,
  deckId: string,
): Promise<{ added: number }> {
  return db.transaction(async (tx) => {
    const { trade, party, collectionId } = await lockWritable(tx, userId, tradeId)
    const [deck] = await tx
      .select({
        collectionId: containers.collectionId,
        kind: containers.kind,
        deckState: containers.deckState,
      })
      .from(containers)
      .where(eq(containers.id, deckId))
      .limit(1)
    if (
      !deck ||
      deck.collectionId !== collectionId ||
      deck.kind !== 'deck' ||
      deck.deckState !== 'built'
    )
      throw new TradeError('unavailable')

    const rows = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, deckId))
      .orderBy(asc(holdings.id))
    if (rows.length === 0) throw new TradeError('empty')
    for (const holding of rows)
      await putHoldingLine(tx, trade, party, holding, holding.qty, true)
    await bumpRevision(tx, trade.id)
    return { added: rows.reduce((sum, row) => sum + row.qty, 0) }
  })
}

// « Select all » d'un binder (ou de la racine) : chaque holding du container
// entre dans l'échange avec tous ses exemplaires.
export async function addContainerLines(
  userId: string,
  tradeId: string,
  containerId: string,
): Promise<{ added: number }> {
  return db.transaction(async (tx) => {
    const { trade, party, collectionId } = await lockWritable(tx, userId, tradeId)
    await assertTradeableContainer(tx, containerId, collectionId)
    const rows = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, containerId))
      .orderBy(asc(holdings.id))
    for (const holding of rows)
      await putHoldingLine(tx, trade, party, holding, holding.qty, true)
    if (rows.length > 0) await bumpRevision(tx, trade.id)
    return { added: rows.reduce((sum, row) => sum + row.qty, 0) }
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
  await addCatalogLines(userId, tradeId, [input])
}

// Plusieurs cartes d'un coup (liste importée), dans une seule transaction :
// tout entre, ou rien.
export async function addCatalogLines(
  userId: string,
  tradeId: string,
  inputs: CatalogLineInput[],
): Promise<void> {
  if (inputs.length === 0) return
  if (inputs.some((input) => !Number.isInteger(input.qty) || input.qty < 1))
    throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) !== 'in_person' || party !== 'initiator')
      throw new TradeError('forbidden')

    const known = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(inArray(cards.id, [...new Set(inputs.map((input) => input.cardId))]))
    const knownIds = new Set(known.map((card) => card.id))
    if (inputs.some((input) => !knownIds.has(input.cardId)))
      throw new TradeError('invalid')

    for (const input of inputs) await putCatalogLine(tx, trade, input)
    await bumpRevision(tx, trade.id)
  })
}

async function putCatalogLine(
  tx: Tx,
  trade: Trade,
  input: CatalogLineInput,
): Promise<void> {
  {
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
  }
}

// Aperçu d'une liste collée (decklist ou CSV) avant de l'ajouter : même
// analyse et même résolution que l'import d'une liste dans un container.
export interface ImportPreviewLine {
  raw: string
  qty: number
  name: string
  status: 'resolved' | 'ambiguous' | 'unknown'
  cardId: string | null
  finish: Finish
  condition: Condition
  language: string
  candidates: Array<{
    cardId: string
    setCode: string
    collectorNumber: string
    priceMinor: number | null
  }>
}

const IMPORT_LINE_LIMIT = 500

export async function previewImport(
  userId: string,
  tradeId: string,
  text: string,
): Promise<{ lines: ImportPreviewLine[]; ignored: number }> {
  const { trade, party } = await loadTradeFor(db, userId, tradeId)
  if (modeOf(trade) !== 'in_person' || party !== 'initiator')
    throw new TradeError('forbidden')
  const parsed = parseList(text)
  if (parsed.lines.length > IMPORT_LINE_LIMIT) throw new TradeError('invalid')
  const { lines } = await resolveList(parsed.lines, { currency: trade.currency })
  return {
    ignored: parsed.ignored.length,
    lines: lines.map((line) => ({
      raw: line.raw,
      qty: line.qty,
      name: line.name,
      status: line.status,
      cardId: line.cardId,
      finish: line.finish ?? 'nonfoil',
      condition: line.condition ?? 'nm',
      language: line.language ?? 'en',
      candidates: line.candidates ?? [],
    })),
  }
}

export interface UpdateLinePatch {
  qty?: number
  // `null` efface le prix saisi et revient au prix du marché.
  priceOverrideMinor?: number | null
  // Seulement pour une carte venue du catalogue : celle d'un holding porte
  // déjà les siennes.
  finish?: Finish
  condition?: Condition
  language?: string
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
    const set: Partial<
      Pick<TradeLine, 'qty' | 'priceOverrideMinor' | 'finish' | 'condition' | 'language'>
    > = {}

    if (patch.qty !== undefined) {
      if (!canEditSide(trade, party, line.giver)) throw new TradeError('forbidden')
      if ((await deckLineIds(tx, trade.id)).has(line.id))
        throw new TradeError('forbidden')
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
    if (
      patch.finish !== undefined ||
      patch.condition !== undefined ||
      patch.language !== undefined
    ) {
      if (line.holdingId !== null || !canEditSide(trade, party, line.giver))
        throw new TradeError('forbidden')
      if (patch.finish !== undefined) set.finish = patch.finish
      if (patch.condition !== undefined) set.condition = patch.condition
      if (patch.language !== undefined) set.language = patch.language
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
    // Retirer une carte d'un deck entier retire tout le deck.
    const decks = await deckLineIds(tx, trade.id)
    const deckId = decks.get(line.id)
    const ids = deckId
      ? [...decks].filter(([, id]) => id === deckId).map(([lineId]) => lineId)
      : [line.id]
    await tx.delete(tradeLines).where(inArray(tradeLines.id, ids))
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
          ? { initiatorRatePct: rate, initiatorValueMinor: null }
          : { counterpartyRatePct: rate, counterpartyValueMinor: null },
      )
      .where(eq(trades.id, trade.id))
    await bumpRevision(tx, trade.id)
  })
}

// Argent donné par `giver`, saisi par qui saisit ce côté. Change la valeur
// de l'échange : toute acceptation en cours tombe.
export async function setCash(
  userId: string,
  tradeId: string,
  giver: TradeParty,
  amountMinor: number,
): Promise<void> {
  if (!Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > MAX_CASH_MINOR)
    throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (!canEditSide(trade, party, giver)) throw new TradeError('forbidden')
    await tx
      .update(trades)
      .set(
        giver === 'initiator'
          ? { initiatorCashMinor: amountMinor }
          : { counterpartyCashMinor: amountMinor },
      )
      .where(eq(trades.id, trade.id))
    await bumpRevision(tx, trade.id)
  })
}

// Notes d'un côté : n'entrent pas dans la valeur, donc ni révision ni
// acceptation touchées, et restent modifiables une fois l'échange conclu.
export async function setNotes(
  userId: string,
  tradeId: string,
  giver: TradeParty,
  notes: string,
): Promise<void> {
  const value = notes.trim()
  if (value.length > MAX_NOTES_LENGTH) throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade, party } = await loadTradeFor(tx, userId, tradeId, true)
    if (trade.status === 'cancelled') throw new TradeError('not_open')
    if (party === 'counterparty' && awaitsJoin(trade)) throw new TradeError('forbidden')
    if (!canEditSide(trade, party, giver)) throw new TradeError('forbidden')
    await assertCollectionWrite(userId, collectionOf(trade, party), tx)
    await tx
      .update(trades)
      .set(
        giver === 'initiator'
          ? { initiatorNotes: value || null }
          : { counterpartyNotes: value || null },
      )
      .where(eq(trades.id, trade.id))
    await touch(tx, trade.id)
  })
}

// La contrepartie accepte d'ouvrir l'échange après avoir vu l'offre ; elle
// choisit ensuite ce qu'elle donne. Refuser l'offre, c'est annuler.
export async function joinTrade(userId: string, tradeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId, { beforeJoin: true })
    if (party !== 'counterparty' || !awaitsJoin(trade)) throw new TradeError('forbidden')
    await tx
      .update(trades)
      .set({ counterpartyJoinedAt: new Date() })
      .where(eq(trades.id, trade.id))
    await touch(tx, trade.id)
  })
}

// Valeur fixe des cartes données par `giver`, à la place du pourcentage
// (« tes cartes valent 20 € pour moi »). Négociable comme le pourcentage ;
// `null` revient au pourcentage.
export async function setSideValue(
  userId: string,
  tradeId: string,
  giver: TradeParty,
  amountMinor: number | null,
): Promise<void> {
  if (
    amountMinor !== null &&
    (!Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > MAX_CASH_MINOR)
  )
    throw new TradeError('invalid')
  await db.transaction(async (tx) => {
    const { trade } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) === 'in_person' && partyOf(trade, userId) !== 'initiator')
      throw new TradeError('forbidden')
    await tx
      .update(trades)
      .set(
        giver === 'initiator'
          ? { initiatorValueMinor: amountMinor }
          : { counterpartyValueMinor: amountMinor },
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

  // Decks cédés entiers : démontés (`discard`) dans cette transaction ; ce
  // qui en sort vraiment est remis à l'autre partie. Une ligne qui n'est
  // adossée à aucun exemplaire (carte jamais acquise) ne part pas.
  const decks = await deckLineIds(tx, trade.id)
  const deckGroups = new Map<string, { party: TradeParty; lines: TradeLine[] }>()
  for (const line of lines) {
    const deckId = decks.get(line.id)
    if (!deckId) continue
    const group = deckGroups.get(deckId) ?? { party: line.giver, lines: [] }
    group.lines.push(line)
    deckGroups.set(deckId, group)
  }
  const deckReceipts: Array<{
    giver: TradeParty
    cardId: string
    finish: Finish
    condition: Condition
    language: string
    qty: number
  }> = []

  // Retraits : une ligne par holding source, quantités cumulées.
  const outgoing = new Map<string, { party: TradeParty; qty: number; line: TradeLine }>()
  for (const line of lines) {
    if (!parties.has(line.giver) || decks.has(line.id)) continue
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

  for (const [deckId, group] of deckGroups) {
    const owner = parties.get(group.party)!
    const [deck] = await tx
      .select({ collectionId: containers.collectionId, deckState: containers.deckState })
      .from(containers)
      .where(eq(containers.id, deckId))
      .for('update')
      .limit(1)
    if (!deck || deck.collectionId !== owner.collectionId || deck.deckState !== 'built')
      throw new TradeError('unavailable')
    // Le deck doit être resté celui qui a été proposé (un deck `built` est
    // verrouillé, mais il a pu être remis en chantier puis remonté).
    const current = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, deckId))
    const byId = new Map(current.map((row) => [row.id, row]))
    const unchanged =
      current.length === group.lines.length &&
      group.lines.every(
        (line) => line.holdingId !== null && byId.get(line.holdingId)?.qty === line.qty,
      )
    if (!unchanged) throw new TradeError('unavailable')

    const { consumed } = await dismantleDeckInTransaction(
      tx,
      owner.userId,
      deckId,
      NO_TARGET,
      'discard',
    )
    for (const piece of consumed) deckReceipts.push({ giver: group.party, ...piece })
  }

  // Ajouts : chez l'autre partie, si elle a une collection ici. Un deck cédé
  // entier remet les exemplaires réellement sortis de la collection, pas ses
  // lignes de besoin.
  const receipts = [
    ...lines.filter((line) => !decks.has(line.id)),
    ...deckReceipts.map((piece) => ({ ...piece, giver: piece.giver })),
  ]
  for (const line of receipts) {
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
): Promise<{ undoToken: string | null }> {
  const { effects, withDeck } = await db.transaction(async (tx) => {
    const { trade, party } = await lockWritable(tx, userId, tradeId)
    if (modeOf(trade) !== 'in_person' || party !== 'initiator')
      throw new TradeError('forbidden')
    if (trade.revision !== revision) throw new TradeError('stale')
    const withDeck = (await deckLineIds(tx, trade.id)).size > 0
    return { effects: await applyTrade(tx, trade), withDeck }
  })
  // Remonter un deck démonté n'est pas une simple écriture inverse : un
  // échange qui en cède un ne s'annule pas.
  if (withDeck) return { undoToken: null }

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
    if (modeOf(trade) !== 'account' || awaitsJoin(trade))
      throw new TradeError('forbidden')
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
    const { trade, party } = await lockWritable(tx, userId, tradeId, { beforeJoin: true })
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
  // Carte reçue en personne, choisie au catalogue : sa finition et son état
  // se règlent dans l'échange.
  fromCatalog: boolean
  // Deck cédé entier dont vient la ligne : ni quantité ni retrait carte par
  // carte. Son nom est montré aux deux parties — c'est le deck qui est offert.
  deck: { id: string; name: string } | null
}

export interface TradeSideView {
  giver: TradeParty
  ratePct: number
  // Valeur fixe des cartes de ce côté, à la place du pourcentage.
  fixedMinor: number | null
  // Ajouter, retirer, changer les quantités et l'argent de ce côté.
  canEdit: boolean
  cashMinor: number
  notes: string | null
  canEditNotes: boolean
  lines: TradeLineView[]
}

export interface TradeView {
  id: string
  status: TradeStatus
  mode: TradeMode
  currency: TradeCurrency
  me: TradeParty
  myName: string
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
  // Entre deux comptes : l'offre a-t-elle été acceptée par la contrepartie ?
  // Toujours vrai en personne.
  joined: boolean
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
      sourceId: containers.id,
      sourceName: containers.name,
      sourceKind: containers.kind,
      sourceState: containers.deckState,
    })
    .from(tradeLines)
    .innerJoin(cards, eq(cards.id, tradeLines.cardId))
    .leftJoin(holdings, eq(holdings.id, tradeLines.holdingId))
    .leftJoin(containers, eq(containers.id, holdings.containerId))
    .where(eq(tradeLines.tradeId, trade.id))
    // Les lignes d'un même ajout groupé partagent leur horodatage : le nom
    // départage, puis l'identifiant.
    .orderBy(asc(tradeLines.addedAt), asc(cards.name), asc(tradeLines.id))

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
      fromCatalog: mode === 'in_person' && row.line.giver === 'counterparty',
      deck:
        row.sourceKind === 'deck' && row.sourceId && row.sourceName
          ? { id: row.sourceId, name: row.sourceName }
          : null,
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
  const joined = !awaitsJoin(trade)
  const open = trade.status === 'open' && canWrite && (joined || party === 'initiator')
  const notesWritable =
    trade.status !== 'cancelled' && canWrite && (joined || party === 'initiator')

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
    myName: party === 'initiator' ? trade.initiatorName : trade.counterpartyName,
    partnerName: party === 'initiator' ? trade.counterpartyName : trade.initiatorName,
    revision: trade.revision,
    createdAt: trade.createdAt.toISOString(),
    completedAt: trade.completedAt?.toISOString() ?? null,
    give: {
      giver: party,
      ratePct: rateOf(trade, party),
      fixedMinor: fixedOf(trade, party),
      canEdit: open && canEditSide(trade, party, party),
      cashMinor: cashOf(trade, party),
      notes: notesOf(trade, party),
      canEditNotes: notesWritable && canEditSide(trade, party, party),
      lines: rows.filter((row) => row.line.giver === party).map(toLine),
    },
    get: {
      giver: other,
      ratePct: rateOf(trade, other),
      fixedMinor: fixedOf(trade, other),
      canEdit: open && canEditSide(trade, party, other),
      cashMinor: cashOf(trade, other),
      notes: notesOf(trade, other),
      canEditNotes: notesWritable && canEditSide(trade, party, other),
      lines: rows.filter((row) => row.line.giver === other).map(toLine),
    },
    destination: { containerId: destinationId, name: destinationName },
    acceptedByMe: acceptedRevisionOf(trade, party) === trade.revision,
    acceptedByPartner: acceptedRevisionOf(trade, other) === trade.revision,
    joined,
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
      giveMinor: sideTotalMinor({
        lines: give,
        ratePct: rateOf(trade, party),
        cashMinor: cashOf(trade, party),
        fixedMinor: fixedOf(trade, party),
      }).valueMinor,
      getMinor: sideTotalMinor({
        lines: get,
        ratePct: rateOf(trade, other),
        cashMinor: cashOf(trade, other),
        fixedMinor: fixedOf(trade, other),
      }).valueMinor,
      awaitingMe:
        trade.status === 'open' &&
        modeOf(trade) === 'account' &&
        ((party === 'counterparty' && awaitsJoin(trade)) ||
          (!awaitsJoin(trade) &&
            acceptedRevisionOf(trade, party) !== trade.revision &&
            acceptedRevisionOf(trade, other) === trade.revision)),
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
  // Déjà dans l'échange (et sa ligne, pour l'en retirer).
  inTrade: number
  lineId: string | null
  containerName: string
  thumbUrl: string
  marketPriceMinor: number | null
}

export type BrowseScope = 'all' | 'binders' | 'decks'

export interface BrowseGroup {
  containerId: string
  name: string
  kind: 'collection' | 'binder' | 'deck'
  cardCount: number
  selectedCount: number
  // Carte par carte : faux pour un deck, qui s'échange entier.
  tradeable: boolean
  // Une ligne de l'échange venue de ce container (pour retirer un deck
  // entier d'un geste), `null` s'il n'y en a aucune.
  lineId: string | null
  // Chargés seulement pour une recherche ou un container ouvert.
  holdings: TradeableHolding[] | null
}

const BROWSE_SEARCH_LIMIT = 80
const BROWSE_CONTAINER_LIMIT = 300

function scopeKinds(scope: BrowseScope): Array<'collection' | 'binder' | 'deck'> {
  if (scope === 'binders') return ['binder']
  if (scope === 'decks') return ['deck']
  return ['collection', 'binder', 'deck']
}

export async function browseTradeable(
  userId: string,
  tradeId: string,
  options: { query?: string; scope?: BrowseScope; containerId?: string } = {},
): Promise<BrowseGroup[]> {
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

  const kinds = scopeKinds(options.scope ?? 'all')
  const groupRows = await db
    .select({
      id: containers.id,
      name: containers.name,
      kind: containers.kind,
      deckState: containers.deckState,
      sortOrder: containers.sortOrder,
      cardCount: sql<number>`coalesce(sum(${holdings.qty}), 0)::int`,
    })
    .from(containers)
    .leftJoin(holdings, eq(holdings.containerId, containers.id))
    .where(
      and(
        eq(containers.collectionId, collectionId),
        inArray(containers.kind, kinds),
        or(ne(containers.kind, 'deck'), eq(containers.deckState, 'built')),
      ),
    )
    .groupBy(containers.id)
    .orderBy(asc(containers.sortOrder), asc(containers.name))

  const mine = await db
    .select({
      lineId: tradeLines.id,
      holdingId: tradeLines.holdingId,
      qty: tradeLines.qty,
      containerId: holdings.containerId,
    })
    .from(tradeLines)
    .innerJoin(holdings, eq(holdings.id, tradeLines.holdingId))
    .where(and(eq(tradeLines.tradeId, trade.id), eq(tradeLines.giver, party)))
  const selectedByContainer = new Map<string, number>()
  const lineByContainer = new Map<string, string>()
  const lineByHolding = new Map<string, { lineId: string; qty: number }>()
  for (const line of mine) {
    selectedByContainer.set(
      line.containerId,
      (selectedByContainer.get(line.containerId) ?? 0) + line.qty,
    )
    if (!lineByContainer.has(line.containerId))
      lineByContainer.set(line.containerId, line.lineId)
    if (line.holdingId)
      lineByHolding.set(line.holdingId, { lineId: line.lineId, qty: line.qty })
  }

  // La racine en tête, puis binders et decks dans leur ordre.
  const rank = { collection: 0, binder: 1, deck: 2 } as const
  const groups: BrowseGroup[] = groupRows
    .map((row) => ({
      containerId: row.id,
      name: row.kind === 'collection' ? ROOT_LABEL : row.name,
      kind: row.kind as BrowseGroup['kind'],
      cardCount: Number(row.cardCount),
      selectedCount: selectedByContainer.get(row.id) ?? 0,
      tradeable: (TRADEABLE_KINDS as readonly string[]).includes(row.kind),
      lineId: lineByContainer.get(row.id) ?? null,
      holdings: null as TradeableHolding[] | null,
    }))
    .sort((a, b) => rank[a.kind] - rank[b.kind])

  const words = (options.query ?? '').trim().split(/\s+/).filter(Boolean)
  const tradeableIds = groups
    .filter((group) => group.tradeable)
    .map((group) => group.containerId)
  const targetIds = options.containerId
    ? tradeableIds.filter((id) => id === options.containerId)
    : words.length > 0
      ? tradeableIds
      : []
  if (targetIds.length === 0) return words.length > 0 ? [] : groups

  const rows = await db
    .select({
      holding: holdings,
      name: cards.name,
      setCode: cards.setCode,
      collectorNumber: cards.collectorNumber,
    })
    .from(holdings)
    .innerJoin(cards, eq(cards.id, holdings.cardId))
    .where(
      and(
        inArray(holdings.containerId, targetIds),
        ...words.map((word) => ilike(cards.name, `%${escapeLike(word)}%`)),
      ),
    )
    .orderBy(asc(cards.name), asc(cards.setCode), asc(holdings.id))
    .limit(options.containerId ? BROWSE_CONTAINER_LIMIT : BROWSE_SEARCH_LIMIT)
  const prices = await latestPricesOf(
    db,
    rows.map((row) => row.holding.cardId),
  )

  const byContainer = new Map<string, TradeableHolding[]>()
  for (const row of rows) {
    const group = groups.find((entry) => entry.containerId === row.holding.containerId)!
    const line = lineByHolding.get(row.holding.id)
    const item: TradeableHolding = {
      holdingId: row.holding.id,
      cardId: row.holding.cardId,
      name: row.name,
      setCode: row.setCode,
      collectorNumber: row.collectorNumber,
      finish: row.holding.finish,
      condition: row.holding.condition,
      language: row.holding.language,
      qty: row.holding.qty,
      inTrade: line?.qty ?? 0,
      lineId: line?.lineId ?? null,
      containerName: group.name,
      thumbUrl: thumbUrl(row.holding.cardId, 'small'),
      marketPriceMinor: marketPriceMinor(
        prices.get(row.holding.cardId) ?? null,
        row.holding.finish,
        trade.currency,
      ),
    }
    const list = byContainer.get(row.holding.containerId)
    if (list) list.push(item)
    else byContainer.set(row.holding.containerId, [item])
  }

  // Une recherche ne garde que les containers où elle trouve quelque chose.
  return groups
    .map((group) => ({
      ...group,
      holdings:
        byContainer.get(group.containerId) ??
        (targetIds.includes(group.containerId) ? [] : null),
    }))
    .filter((group) => words.length === 0 || (group.holdings?.length ?? 0) > 0)
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
