// Test unitaire :
// `formatDecklistText` (ex-`formatDeckList` — même contrat, partagée par les formats Moxfield/Archidekt et
// Plain text plutôt que dédiée à un format unique) produit une ligne par
// carte au format « <qty> <name> (<SET>) <collector_number> » — pure, aucun
// accès base, indépendant du composant React qui l'appelle
// (`app/(app)/decks/[id]/export-sheet.tsx`).
import { describe, expect, it } from 'vitest'

import { formatDecklistText } from '@/app/(app)/decks/[id]/export-sheet'
import type { DeckSlot } from '@/app/(app)/decks/[id]/deck-data'

function slot(overrides: Partial<DeckSlot> & { name: string; setLine: string }): DeckSlot {
  return {
    holdingId: 'h1',
    cardId: 'c1',
    manaCost: null,
    need: 1,
    ownedElsewhere: 0,
    state: 'missing',
    priceMinor: null,
    zone: 'main',
    thumbUrl: '/api/card-image/c1/small',
    ...overrides,
  }
}

describe('formatDecklistText', () => {
  it('formats a single card as "<qty> <name> (<SET>) <collector_number>"', () => {
    const text = formatDecklistText([
      slot({ name: 'Wrath of God', setLine: 'DMR #34 · not owned', need: 1 }),
    ])
    expect(text).toBe('1 Wrath of God (DMR) 34')
  })

  it('carries the quantity actually needed, not always 1', () => {
    const text = formatDecklistText([slot({ name: 'Mountain', setLine: 'M21 #275 · owned ×3', need: 3 })])
    expect(text).toBe('3 Mountain (M21) 275')
  })

  it('joins multiple cards with one line each, in the given order', () => {
    const text = formatDecklistText([
      slot({ name: 'Sol Ring', setLine: 'LTC #305 · not owned', need: 1 }),
      slot({ name: 'Cultivate', setLine: 'M21 #177 · not owned', need: 1 }),
    ])
    expect(text).toBe('1 Sol Ring (LTC) 305\n1 Cultivate (M21) 177')
  })

  it('returns an empty string for an empty list', () => {
    expect(formatDecklistText([])).toBe('')
  })
})
