// Test unitaire : pile de cartes scannées en attente de revue
// (`lib/scanner/pending.ts`).
import { describe, expect, it } from 'vitest'

import { mergePending, parseScanPayload, type PendingLine } from '@/lib/scanner/pending'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

function line(cardId: string, qty: number, patch: Partial<PendingLine> = {}): PendingLine {
  return { cardId, qty, finish: 'nonfoil', exact: true, condition: 'nm', language: 'en', ...patch }
}

describe('parseScanPayload', () => {
  const detected = { condition: 'lp', language: 'auto', foil: false } as const

  it('reads the cards returned by the Android scanner as non-foil lines with the default condition', () => {
    expect(parseScanPayload({ cards: [{ cardId: A, qty: 2, exact: false, language: 'fr' }] }, detected)).toEqual([
      { cardId: A, qty: 2, exact: false, condition: 'lp', language: 'fr', finish: 'nonfoil' },
    ])
  })

  it('applies the default language over the printed one unless it is auto', () => {
    const [card] = parseScanPayload(
      { cards: [{ cardId: A, qty: 1, exact: true, language: 'fr' }] },
      { condition: 'nm', language: 'de', foil: false },
    )
    expect(card?.language).toBe('de')
  })

  it('applies the default foil to cards from an older scanner', () => {
    const [card] = parseScanPayload(
      { cards: [{ cardId: A, qty: 1, exact: true, language: 'en' }] },
      { condition: 'nm', language: 'auto', foil: true },
    )
    expect(card?.finish).toBe('foil')
  })

  it('keeps the language and foil chosen on the scanner over the defaults', () => {
    const [card] = parseScanPayload(
      { cards: [{ cardId: A, qty: 1, exact: true, language: 'ja', foil: false }] },
      { condition: 'nm', language: 'de', foil: true },
    )
    expect(card).toMatchObject({ language: 'ja', finish: 'nonfoil' })
  })

  it('ignores a malformed payload', () => {
    expect(parseScanPayload(null, detected)).toEqual([])
    expect(parseScanPayload({ cards: [{ cardId: 'nope', qty: 1, exact: true, language: 'en' }] }, detected)).toEqual([])
    expect(parseScanPayload({ cards: [{ cardId: A, qty: 0, exact: true, language: 'en' }] }, detected)).toEqual([])
  })
})

describe('mergePending', () => {
  it('adds the copies of a card already pending and appends new cards', () => {
    const merged = mergePending([line(A, 1)], [line(A, 2), line(B, 1)])
    expect(merged).toEqual([line(A, 3), line(B, 1)])
  })

  it('keeps foil and non-foil copies, or two languages, of a card on separate lines', () => {
    const merged = mergePending([line(A, 1, { finish: 'foil' })], [line(A, 2), line(A, 1, { language: 'fr' })])
    expect(merged).toEqual([line(A, 1, { finish: 'foil' }), line(A, 2), line(A, 1, { language: 'fr' })])
  })

  it('merges lines that became identical', () => {
    expect(mergePending([], [line(A, 1), line(B, 1), line(A, 2)])).toEqual([line(A, 3), line(B, 1)])
  })

  it('confirms a printing found by name once it is read exactly', () => {
    expect(mergePending([line(A, 1, { exact: false })], [line(A, 1)])[0]?.exact).toBe(true)
  })

  it('leaves the original lines untouched', () => {
    const original = [line(A, 1)]
    mergePending(original, [line(A, 1)])
    expect(original[0]?.qty).toBe(1)
  })
})
