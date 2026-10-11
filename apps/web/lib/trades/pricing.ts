// Calcul de la balance d'un échange. Pur (aucun `import { db }`) : l'écran
// d'échange recalcule les totaux à chaque saisie côté client avec exactement
// la règle que le serveur applique.
import type { Finish } from '@spellcache/db/schema'
import type { Currency } from '@/lib/format/money'

// Bornes de l'ajustement par côté : au-delà, ce n'est plus une décote mais
// un autre échange.
export const RATE_MIN_PCT = 50
export const RATE_MAX_PCT = 150
export const RATE_PRESETS_PCT = [80, 90, 100, 110] as const

export interface PricedLine {
  qty: number
  marketPriceMinor: number | null
  priceOverrideMinor: number | null
}

export interface LatestPrices {
  usd: string | null
  usd_foil: string | null
  eur: string | null
  eur_foil: string | null
}

// Même règle que `container_stats` : `foil` et `etched` lisent les colonnes
// `_foil` (le schéma n'a pas de colonne `etched`).
export function marketPriceMinor(
  prices: LatestPrices | null,
  finish: Finish,
  currency: Currency,
): number | null {
  if (!prices) return null
  const raw =
    finish === 'nonfoil'
      ? currency === 'usd'
        ? prices.usd
        : prices.eur
      : currency === 'usd'
        ? prices.usd_foil
        : prices.eur_foil
  return raw === null ? null : Math.round(Number(raw) * 100)
}

export function unitPriceMinor(line: PricedLine): number | null {
  return line.priceOverrideMinor ?? line.marketPriceMinor
}

// Une carte sans prix compte pour 0 sans annuler le total, comme partout
// ailleurs dans l'app ; `missing` permet de le signaler.
export function sideValueMinor(
  lines: PricedLine[],
  ratePct: number,
): { valueMinor: number; missing: number } {
  let raw = 0
  let missing = 0
  for (const line of lines) {
    const unit = unitPriceMinor(line)
    if (unit === null) missing += 1
    else raw += unit * line.qty
  }
  return { valueMinor: Math.round((raw * ratePct) / 100), missing }
}

export interface TradeBalance {
  giveMinor: number
  getMinor: number
  // Positif : on reçoit plus qu'on ne donne.
  deltaMinor: number
  missing: number
}

export function tradeBalance(
  give: { lines: PricedLine[]; ratePct: number },
  get: { lines: PricedLine[]; ratePct: number },
): TradeBalance {
  const given = sideValueMinor(give.lines, give.ratePct)
  const received = sideValueMinor(get.lines, get.ratePct)
  return {
    giveMinor: given.valueMinor,
    getMinor: received.valueMinor,
    deltaMinor: received.valueMinor - given.valueMinor,
    missing: given.missing + received.missing,
  }
}

export function clampRate(ratePct: number): number {
  return Math.min(RATE_MAX_PCT, Math.max(RATE_MIN_PCT, Math.round(ratePct)))
}

// Saisie d'un prix unitaire : `12`, `12.5`, `12,50` (la virgule décimale est
// courante en Europe). `null` pour toute autre forme.
export function parsePriceMinor(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  // Six chiffres au plus : la même borne que la Server Action.
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}
