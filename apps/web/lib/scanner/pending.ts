// Cartes scannées en attente de revue. Elles vivent dans l'onglet
// (`sessionStorage`) jusqu'à l'ajout : rien n'est écrit en base avant que
// l'écran de revue ne valide, et un rechargement de la page ne perd pas la
// pile.
import { z } from 'zod'

import type { Condition, Finish } from '@spellcache/db/schema'

// Marqueur du user agent posé par une app Android qui embarque le scanner
// (`apps/android/capacitor.config.ts`).
export const SCANNER_SHELL_MARKER = 'SpellcacheScanner'
// Navigation interceptée par l'app Android, qui ouvre la caméra
// (`ScannerPlugin.java`).
export const SCANNER_URL = 'spellcache://scanner'

export interface PendingLine {
  cardId: string
  qty: number
  finish: Finish
  // `false` : reconnue par son nom, l'impression reste à confirmer.
  exact: boolean
  // État et langue de cette carte, réglables carte par carte dans la revue.
  condition: Condition
  language: string
}

// Valeurs par défaut d'une carte reçue (réglages de scan) ; langue `auto` :
// celle imprimée sur la carte.
export interface ScanDefaults {
  condition: Condition
  language: string
  foil: boolean
}

// Ce que l'activité native rend en se refermant.
const scanPayloadSchema = z.object({
  cards: z
    .array(
      z.object({
        cardId: z.uuid(),
        qty: z.number().int().positive().max(999),
        exact: z.boolean(),
        language: z.string().trim().min(1).max(8),
        // Choisi sur le scanner (actions rapides), langue comprise : absent
        // d'un scanner plus ancien, les réglages de scan s'appliquent.
        foil: z.boolean().optional(),
      }),
    )
    .max(500),
})

export function parseScanPayload(payload: unknown, defaults: ScanDefaults): PendingLine[] {
  const parsed = scanPayloadSchema.safeParse(payload)
  if (!parsed.success) return []
  return parsed.data.cards.map(({ foil, ...card }) => ({
    ...card,
    finish: (foil ?? defaults.foil) ? 'foil' : 'nonfoil',
    condition: defaults.condition,
    language: foil !== undefined || defaults.language === 'auto' ? card.language : defaults.language,
  }))
}

// Une ligne par impression et par holding : foil et non-foil, ou deux
// langues, d'une même carte restent distincts jusqu'à l'ajout.
export function lineKey(line: Pick<PendingLine, 'cardId' | 'finish' | 'language' | 'condition'>): string {
  return `${line.cardId}|${line.finish}|${line.language}|${line.condition}`
}

// Une ligne déjà en attente gagne les exemplaires scannés à nouveau ; une
// lecture exacte confirme l'impression d'une lecture par le nom.
export function mergePending(lines: PendingLine[], incoming: PendingLine[]): PendingLine[] {
  const merged: PendingLine[] = []
  for (const card of [...lines, ...incoming]) {
    const existing = merged.find((line) => lineKey(line) === lineKey(card))
    if (existing) {
      existing.qty += card.qty
      existing.exact = existing.exact || card.exact
    } else {
      merged.push({ ...card })
    }
  }
  return merged
}

const STORAGE_KEY = 'spellcache:scanner'

const storedSchema = z.array(
  z.object({
    cardId: z.uuid(),
    qty: z.number().int().positive(),
    finish: z.enum(['nonfoil', 'foil', 'etched']),
    exact: z.boolean(),
    // Absent d'une pile enregistrée avant l'état par carte.
    condition: z.enum(['nm', 'lp', 'mp', 'hp', 'dmg']).default('nm'),
    language: z.string().min(1).max(8),
  }),
)

// Stockage indisponible (navigation privée, données bloquées) : la pile
// reste en mémoire le temps de la page.
export function loadPending(): PendingLine[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = storedSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function savePending(lines: PendingLine[]): void {
  try {
    if (lines.length === 0) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  } catch {
    // Voir `loadPending`.
  }
}
