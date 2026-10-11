// Export d'un échange, pour l'envoyer à l'autre partie. Pur : la feuille
// d'export formate côté client ce que l'écran affiche déjà.
//
// Trois formes : un résumé lisible par n'importe qui (les deux côtés,
// l'argent, les notes), une liste de cartes réimportable (même grammaire que
// `formatContainerList` : `<qty> <name> (<SET>) <number>`, que `parseList`
// relit), et un CSV pour un tableur.
import { formatMoney, type Currency } from '@/lib/format/money'

import { sideTotalMinor, unitPriceMinor } from './pricing'
import type { TradeLineView, TradeView } from './trades'

export type TradeExportFormat = 'summary' | 'list' | 'csv'

// La finition n'a pas de place dans une ligne de liste que `parseList` relit
// (le CSV la porte) ; le résumé, lui, la dit en clair.
const FINISH_NOTE: Record<TradeLineView['finish'], string> = {
  nonfoil: '',
  foil: ' (foil)',
  etched: ' (etched)',
}

function listLine(line: TradeLineView): string {
  return `${line.qty} ${line.name} (${line.setCode.toUpperCase()}) ${line.collectorNumber}`
}

function summaryLine(line: TradeLineView): string {
  return `${listLine(line)}${FINISH_NOTE[line.finish]}`
}

function money(amountMinor: number, currency: Currency): string {
  return formatMoney(amountMinor, currency)
}

function signed(amountMinor: number, currency: Currency): string {
  if (amountMinor === 0) return 'Even'
  return `${amountMinor > 0 ? '+' : '−'}${money(Math.abs(amountMinor), currency)}`
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function summary(trade: TradeView): string {
  const myName = trade.myName
  const give = sideTotalMinor(trade.give)
  const get = sideTotalMinor(trade.get)
  const verb = trade.status === 'completed' ? 'gave' : 'give'
  const partnerVerb = trade.status === 'completed' ? 'gave' : 'gives'
  const out: string[] = [
    `Trade between ${myName} and ${trade.partnerName} · ${day(trade.completedAt ?? trade.createdAt)}`,
    '',
    `${myName} ${verb} (${money(give.valueMinor, trade.currency)})`,
    ...trade.give.lines.map(summaryLine),
  ]
  if (trade.give.cashMinor > 0)
    out.push(`+ ${money(trade.give.cashMinor, trade.currency)} cash`)
  out.push(
    '',
    `${trade.partnerName} ${partnerVerb} (${money(get.valueMinor, trade.currency)})`,
    ...trade.get.lines.map(summaryLine),
  )
  if (trade.get.cashMinor > 0)
    out.push(`+ ${money(trade.get.cashMinor, trade.currency)} cash`)
  out.push(
    '',
    `Balance for ${myName}: ${signed(get.valueMinor - give.valueMinor, trade.currency)}`,
  )

  const notes = [
    trade.give.notes && `${myName}: ${trade.give.notes}`,
    trade.get.notes && `${trade.partnerName}: ${trade.get.notes}`,
  ].filter(Boolean)
  if (notes.length > 0) out.push('', 'Notes', ...(notes as string[]))
  return out.join('\n')
}

// Les deux côtés sous des en-têtes `//` : `parseList` ignore ces lignes, la
// liste se réimporte telle quelle (ou côté par côté).
function cardList(trade: TradeView): string {
  const myName = trade.myName
  const sections: string[] = []
  if (trade.get.lines.length > 0)
    sections.push(
      [`// ${trade.partnerName} → ${myName}`, ...trade.get.lines.map(listLine)].join(
        '\n',
      ),
    )
  if (trade.give.lines.length > 0)
    sections.push(
      [`// ${myName} → ${trade.partnerName}`, ...trade.give.lines.map(listLine)].join(
        '\n',
      ),
    )
  return sections.join('\n\n')
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function csv(trade: TradeView): string {
  const myName = trade.myName
  const header = [
    'Giver',
    'Count',
    'Name',
    'Set',
    'Number',
    'Finish',
    'Condition',
    'Language',
    'Unit price',
  ]
  const rows = [
    ...trade.give.lines.map((line) => [myName, line]),
    ...trade.get.lines.map((line) => [trade.partnerName, line]),
  ] as Array<[string, TradeLineView]>
  const body = rows.map(([giver, line]) => {
    const unit = unitPriceMinor(line)
    return [
      giver,
      String(line.qty),
      line.name,
      line.setCode.toUpperCase(),
      line.collectorNumber,
      line.finish,
      line.condition.toUpperCase(),
      line.language,
      unit === null ? '' : (unit / 100).toFixed(2),
    ]
  })
  return [header, ...body].map((cells) => cells.map(csvCell).join(',')).join('\n')
}

export function exportTrade(trade: TradeView, format: TradeExportFormat): string {
  if (format === 'list') return cardList(trade)
  if (format === 'csv') return csv(trade)
  return summary(trade)
}

export function exportFileName(trade: TradeView, format: TradeExportFormat): string {
  const partner = trade.partnerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const stamp = (trade.completedAt ?? trade.createdAt).slice(0, 10)
  return `trade-${partner || 'partner'}-${stamp}.${format === 'csv' ? 'csv' : 'txt'}`
}
