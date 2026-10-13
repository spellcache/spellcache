'use server'

// Écran de revue du scanner : lecture des cartes scannées et ajout groupé.
// Entrées validées par Zod à la frontière (docs/development.md), outil
// éteint refusé comme les routes de `/tools`.
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { containers } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { requireSession } from '@/lib/auth-guards'
import { addHoldings, MAX_HOLDING_QTY } from '@/lib/containers/holdings'
import { getActiveCollectionId } from '@/lib/collections/active'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { getPreferences } from '@/lib/preferences'
import { currencyOf } from '@/lib/price-source'
import type { Currency } from '@/lib/format/money'
import {
  getScannedCards,
  MAX_SCANNED_LINES,
  SCAN_DESTINATION_KINDS,
  type ScannedCard,
} from '@/lib/scanner/review'
import { saveScannerSettings, scannerSettingsSchema, type ScannerSettings } from '@/lib/scanner/settings'
import { getToolFlags } from '@/lib/tools/tool-flags'

async function requireScanner() {
  const user = await requireSession()
  const tools = await getToolFlags(user.id)
  if (!tools.card_scanner) throw new Error('Card scanner is disabled.')
  return user
}

const cardIdsSchema = z.array(z.uuid()).max(MAX_SCANNED_LINES)

export async function getScannedCardsAction(
  input: unknown,
): Promise<{ cards: ScannedCard[]; currency: Currency }> {
  const cardIds = cardIdsSchema.parse(input)
  const user = await requireScanner()
  const currency = currencyOf(await getPreferences(user.id))
  return { cards: await getScannedCards([...new Set(cardIds)], currency), currency }
}

const saveSchema = z.object({
  containerId: z.uuid(),
  // État et langue carte par carte (écran de revue).
  lines: z
    .array(
      z.object({
        cardId: z.uuid(),
        finish: z.enum(['nonfoil', 'foil', 'etched']),
        condition: z.enum(['nm', 'lp', 'mp', 'hp', 'dmg']),
        language: z.string().trim().min(1).max(8),
        qty: z.number().int().positive().max(MAX_HOLDING_QTY),
      }),
    )
    .min(1)
    .max(MAX_SCANNED_LINES),
})

export type SaveScannedResult = { ok: true; added: number } | { ok: false; error: 'invalid' | 'failed' }

export async function saveScannedCardsAction(input: unknown): Promise<SaveScannedResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const user = await requireScanner()
  const { containerId, lines } = parsed.data

  try {
    // Destination de la collection affichée, jamais un deck (`listScanDestinations`).
    const access = await requireContainerAccess(user.id, containerId, 'write')
    const [target] = await db
      .select({ kind: containers.kind })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1)
    const activeCollectionId = await getActiveCollectionId(user.id)
    if (
      !target ||
      !SCAN_DESTINATION_KINDS.includes(target.kind as (typeof SCAN_DESTINATION_KINDS)[number]) ||
      access.collectionId !== activeCollectionId
    ) {
      return { ok: false, error: 'invalid' }
    }

    const result = await addHoldings(user.id, containerId, lines)
    return { ok: true, added: result.added }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// Réglages de scan de l'écran de revue (son, vibration, foil, langue, état,
// sets) : seules ces clés, fusionnées avec celles de l'app Android
// (`lib/scanner/settings.ts`).
const reviewSettingsSchema = scannerSettingsSchema.pick({
  sound: true,
  vibration: true,
  foilDefault: true,
  language: true,
  condition: true,
  sets: true,
})

export async function updateScannerSettingsAction(
  input: unknown,
): Promise<{ ok: true; settings: ScannerSettings } | { ok: false }> {
  const parsed = reviewSettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false }
  const user = await requireScanner()
  return { ok: true, settings: await saveScannerSettings(user.id, parsed.data) }
}
