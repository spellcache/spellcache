// `lib/trades/export.ts` : les trois formes d'export d'un échange. La liste
// de cartes doit se réimporter telle quelle (`parseList`), le CSV échapper ce
// qui doit l'être, le résumé dire l'argent et les notes.
import { describe, expect, it } from 'vitest'

import { parseList } from '@/lib/lists/parse-list'
import { exportFileName, exportTrade } from '@/lib/trades/export'
import type { TradeLineView, TradeView } from '@/lib/trades/trades'

function line(overrides: Partial<TradeLineView>): TradeLineView {
  return {
    id: overrides.name ?? 'line',
    cardId: 'card',
    name: 'Lightning Bolt',
    setCode: '2x2',
    collectorNumber: '117',
    finish: 'nonfoil',
    condition: 'nm',
    language: 'en',
    qty: 1,
    thumbUrl: '',
    marketPriceMinor: 180,
    priceOverrideMinor: null,
    sourceName: null,
    maxQty: null,
    fromCatalog: false,
    ...overrides,
  }
}

const trade: TradeView = {
  id: 'trade',
  status: 'completed',
  mode: 'in_person',
  currency: 'eur',
  me: 'initiator',
  myName: 'alice',
  partnerName: 'Sam, at the LGS',
  revision: 3,
  createdAt: '2026-10-11T10:00:00.000Z',
  completedAt: '2026-10-11T12:00:00.000Z',
  give: {
    giver: 'initiator',
    ratePct: 100,
    canEdit: false,
    cashMinor: 0,
    notes: 'Counterspell has a dent.',
    canEditNotes: true,
    lines: [
      line({ name: 'Lightning Bolt', qty: 2 }),
      line({
        name: 'Counterspell',
        setCode: 'mh2',
        collectorNumber: '267',
        finish: 'foil',
        marketPriceMinor: 400,
      }),
    ],
  },
  get: {
    giver: 'counterparty',
    ratePct: 100,
    canEdit: false,
    cashMinor: 500,
    notes: null,
    canEditNotes: true,
    lines: [
      line({
        name: 'Sol Ring',
        setCode: 'cmm',
        collectorNumber: '410',
        marketPriceMinor: 240,
        priceOverrideMinor: 220,
      }),
    ],
  },
  destination: { containerId: null, name: null },
  acceptedByMe: false,
  acceptedByPartner: false,
  joined: true,
  canWrite: true,
}

describe('exportTrade', () => {
  it('writes a readable summary with cash, balance and notes', () => {
    const text = exportTrade(trade, 'summary')
    expect(text).toContain('Trade between alice and Sam, at the LGS · Oct 11, 2026')
    expect(text).toContain('alice gave (€7.60)')
    expect(text).toContain('1 Counterspell (MH2) 267 (foil)')
    expect(text).toContain('Sam, at the LGS gave (€7.20)')
    expect(text).toContain('+ €5.00 cash')
    expect(text).toContain('Balance for alice: −€0.40')
    expect(text).toContain('alice: Counterspell has a dent.')
  })

  it('writes a card list that parses back to the same cards', () => {
    const text = exportTrade(trade, 'list')
    const parsed = parseList(text)
    expect(
      parsed.lines.map((entry) => [
        entry.qty,
        entry.name,
        entry.setCode,
        entry.collectorNumber,
      ]),
    ).toEqual([
      [1, 'Sol Ring', 'cmm', '410'],
      [2, 'Lightning Bolt', '2x2', '117'],
      [1, 'Counterspell', 'mh2', '267'],
    ])
    expect(parsed.ignored).toHaveLength(2)
  })

  it('writes a CSV with quoted cells and typed prices', () => {
    const rows = exportTrade(trade, 'csv').split('\n')
    expect(rows[0]).toBe(
      'Giver,Count,Name,Set,Number,Finish,Condition,Language,Unit price',
    )
    expect(rows[2]).toBe('alice,1,Counterspell,MH2,267,foil,NM,en,4.00')
    expect(rows[3]).toBe('"Sam, at the LGS",1,Sol Ring,CMM,410,nonfoil,NM,en,2.20')
  })

  it('names the file after the partner and the day', () => {
    expect(exportFileName(trade, 'csv')).toBe('trade-sam-at-the-lgs-2026-10-11.csv')
    expect(exportFileName(trade, 'summary')).toBe('trade-sam-at-the-lgs-2026-10-11.txt')
  })
})
