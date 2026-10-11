'use server'

// Server Actions de l'outil Trading mode : validation Zod à la frontière,
// garde de session et d'outil, puis `lib/trades/trades.ts` — seul endroit qui
// écrit les échanges et les holdings qu'ils déplacent.
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireSession, type SessionUser } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import {
  acceptTrade,
  addCatalogLine,
  addHoldingLine,
  cancelTrade,
  completeInPerson,
  createTrade,
  getTradeView,
  listTradeDestinations,
  removeLine,
  searchTradePartners,
  searchTradeableHoldings,
  setDestination,
  setRate,
  TradeError,
  undoInPerson,
  updateLine,
  withdrawAcceptance,
  type TradeDestination,
  type TradeErrorCode,
  type TradePartner,
  type TradeView,
  type TradeableHolding,
} from '@/lib/trades/trades'

export type TradeActionError = TradeErrorCode
export type TradeActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: TradeActionError }

// Outil éteint : la route répond 404 (`page.tsx`), les actions refusent de
// la même façon — un onglet caché ne suffit pas.
async function requireTrading(): Promise<SessionUser> {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.tradingMode) throw new TradeError('forbidden')
  return session
}

async function run<S extends z.ZodType, T extends object>(
  schema: S,
  input: unknown,
  body: (session: SessionUser, data: z.infer<S>) => Promise<T>,
): Promise<TradeActionResult<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const session = await requireTrading()
    const result = await body(session, parsed.data)
    return { ok: true, ...result }
  } catch (error) {
    if (error instanceof TradeError) return { ok: false, error: error.code }
    throw error
  }
}

function revalidateTrades(tradeId?: string): void {
  revalidatePath('/tools/trade')
  if (tradeId) revalidatePath(`/tools/trade/${tradeId}`)
}

const tradeIdSchema = z.object({ tradeId: z.uuid() })
const finishSchema = z.enum(['nonfoil', 'foil', 'etched'])
const conditionSchema = z.enum(['nm', 'lp', 'mp', 'hp', 'dmg'])
const partySchema = z.enum(['initiator', 'counterparty'])
// Au-delà, une saisie de prix est une faute de frappe (centimes).
const MAX_PRICE_MINOR = 99_999_999

const createSchema = z.union([
  z.object({ counterpartyId: z.uuid() }),
  z.object({ counterpartyName: z.string().trim().max(60) }),
])

export async function createTradeAction(
  input: unknown,
): Promise<TradeActionResult<{ tradeId: string }>> {
  return run(createSchema, input, async (session, data) => {
    const result = await createTrade(session.id, data)
    revalidateTrades()
    return result
  })
}

const partnerSearchSchema = z.object({ query: z.string().max(40) })

export async function searchTradePartnersAction(
  input: unknown,
): Promise<TradeActionResult<{ partners: TradePartner[] }>> {
  return run(partnerSearchSchema, input, async (session, data) => ({
    partners: await searchTradePartners(session.id, data.query),
  }))
}

export async function getTradeAction(
  input: unknown,
): Promise<TradeActionResult<{ trade: TradeView }>> {
  return run(tradeIdSchema, input, async (session, data) => ({
    trade: await getTradeView(session.id, data.tradeId),
  }))
}

const holdingSearchSchema = tradeIdSchema.extend({ query: z.string().max(100) })

export async function searchTradeableHoldingsAction(
  input: unknown,
): Promise<TradeActionResult<{ holdings: TradeableHolding[] }>> {
  return run(holdingSearchSchema, input, async (session, data) => ({
    holdings: await searchTradeableHoldings(session.id, data.tradeId, data.query),
  }))
}

const addHoldingSchema = tradeIdSchema.extend({
  holdingId: z.uuid(),
  qty: z.int().min(1).max(999),
})

export async function addHoldingLineAction(input: unknown): Promise<TradeActionResult> {
  return run(addHoldingSchema, input, async (session, data) => {
    await addHoldingLine(session.id, data.tradeId, data.holdingId, data.qty)
    revalidateTrades(data.tradeId)
    return {}
  })
}

const addCatalogSchema = tradeIdSchema.extend({
  cardId: z.uuid(),
  finish: finishSchema,
  condition: conditionSchema,
  language: z.string().trim().min(1).max(8),
  qty: z.int().min(1).max(999),
})

export async function addCatalogLineAction(input: unknown): Promise<TradeActionResult> {
  return run(addCatalogSchema, input, async (session, data) => {
    const { tradeId, ...line } = data
    await addCatalogLine(session.id, tradeId, line)
    revalidateTrades(tradeId)
    return {}
  })
}

const updateLineSchema = tradeIdSchema.extend({
  lineId: z.uuid(),
  qty: z.int().min(1).max(999).optional(),
  priceOverrideMinor: z.int().min(0).max(MAX_PRICE_MINOR).nullable().optional(),
})

export async function updateLineAction(input: unknown): Promise<TradeActionResult> {
  return run(updateLineSchema, input, async (session, data) => {
    await updateLine(session.id, data.tradeId, data.lineId, {
      qty: data.qty,
      priceOverrideMinor: data.priceOverrideMinor,
    })
    revalidateTrades(data.tradeId)
    return {}
  })
}

const removeLineSchema = tradeIdSchema.extend({ lineId: z.uuid() })

export async function removeLineAction(input: unknown): Promise<TradeActionResult> {
  return run(removeLineSchema, input, async (session, data) => {
    await removeLine(session.id, data.tradeId, data.lineId)
    revalidateTrades(data.tradeId)
    return {}
  })
}

const rateSchema = tradeIdSchema.extend({
  giver: partySchema,
  ratePct: z.int().min(1).max(1000),
})

export async function setRateAction(input: unknown): Promise<TradeActionResult> {
  return run(rateSchema, input, async (session, data) => {
    await setRate(session.id, data.tradeId, data.giver, data.ratePct)
    revalidateTrades(data.tradeId)
    return {}
  })
}

export async function listTradeDestinationsAction(
  input: unknown,
): Promise<TradeActionResult<{ destinations: TradeDestination[] }>> {
  return run(tradeIdSchema, input, async (session, data) => ({
    destinations: await listTradeDestinations(session.id, data.tradeId),
  }))
}

const destinationSchema = tradeIdSchema.extend({ containerId: z.uuid().nullable() })

export async function setDestinationAction(input: unknown): Promise<TradeActionResult> {
  return run(destinationSchema, input, async (session, data) => {
    await setDestination(session.id, data.tradeId, data.containerId)
    revalidateTrades(data.tradeId)
    return {}
  })
}

const revisionSchema = tradeIdSchema.extend({ revision: z.int().min(0) })

// Les écrans de collection lisent les holdings à chaque rendu : seule la
// page d'accueil, qui peut être servie depuis le cache du routeur, est
// revalidée en plus des écrans d'échange.
function revalidateCollection(): void {
  revalidatePath('/collection')
}

export async function completeInPersonAction(
  input: unknown,
): Promise<TradeActionResult<{ undoToken: string }>> {
  return run(revisionSchema, input, async (session, data) => {
    const result = await completeInPerson(session.id, data.tradeId, data.revision)
    revalidateTrades(data.tradeId)
    revalidateCollection()
    return result
  })
}

const undoSchema = z.object({ undoToken: z.uuid() })

export async function undoInPersonAction(input: unknown): Promise<TradeActionResult> {
  return run(undoSchema, input, async (session, data) => {
    await undoInPerson(session.id, data.undoToken)
    revalidateTrades()
    revalidateCollection()
    return {}
  })
}

export async function acceptTradeAction(
  input: unknown,
): Promise<TradeActionResult<{ completed: boolean }>> {
  return run(revisionSchema, input, async (session, data) => {
    const result = await acceptTrade(session.id, data.tradeId, data.revision)
    revalidateTrades(data.tradeId)
    if (result.completed) revalidateCollection()
    return result
  })
}

export async function withdrawAcceptanceAction(
  input: unknown,
): Promise<TradeActionResult> {
  return run(tradeIdSchema, input, async (session, data) => {
    await withdrawAcceptance(session.id, data.tradeId)
    revalidateTrades(data.tradeId)
    return {}
  })
}

export async function cancelTradeAction(input: unknown): Promise<TradeActionResult> {
  return run(tradeIdSchema, input, async (session, data) => {
    await cancelTrade(session.id, data.tradeId)
    revalidateTrades(data.tradeId)
    return {}
  })
}
