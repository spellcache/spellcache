// Test unitaire : chaque règle de format et les cas limites de
// `evaluateDeck`. Pure — aucun accès base : `evaluateDeck` doit rester pure
// et testable.
import { describe, expect, it } from 'vitest'

import {
  evaluateDeck,
  FORMAT_RULES,
  isDeckFormat,
  type DeckCommander,
  type DeckEvaluationCard,
} from '@/lib/decks/legality'
import type { Legality } from '@spellcache/db/schema'

const LEGAL_EVERYWHERE: Record<string, Legality> = {
  commander: 'legal',
  modern: 'legal',
  standard: 'legal',
  pioneer: 'legal',
  legacy: 'legal',
  vintage: 'legal',
  pauper: 'legal',
}

function card(overrides: Partial<DeckEvaluationCard> & { cardId: string; name: string }): DeckEvaluationCard {
  return {
    qty: 1,
    legalities: LEGAL_EVERYWHERE,
    colorIdentity: [],
    typeLine: 'Creature — Human',
    ...overrides,
  }
}

function commander(colorIdentity: string[], overrides: Partial<DeckCommander> = {}): DeckCommander {
  return {
    name: 'Commander',
    typeLine: 'Legendary Creature — Human',
    oracleText: null,
    colorIdentity,
    ...overrides,
  }
}

function basicLand(name: 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest', qty: number): DeckEvaluationCard {
  return card({
    cardId: `basic-${name}`,
    name,
    qty,
    typeLine: `Basic Land — ${name}`,
    colorIdentity: [],
  })
}

describe('lib/decks/legality — FORMAT_RULES', () => {
  it('covers exactly the seven documented formats', () => {
    expect(Object.keys(FORMAT_RULES).sort()).toEqual(
      ['commander', 'legacy', 'modern', 'pauper', 'pioneer', 'standard', 'vintage'].sort(),
    )
  })

  it('gives Commander a 100-card exact-size singleton deck that needs a commander', () => {
    expect(FORMAT_RULES.commander).toEqual({
      size: 100,
      sizeMode: 'exact',
      singleton: true,
      maxCopies: 1,
      needsCommander: true,
    })
  })

  it.each(['modern', 'standard', 'pioneer', 'legacy', 'vintage', 'pauper'] as const)(
    'gives %s a 60-card floor, 4-copy, non-singleton deck with no commander requirement',
    (format) => {
      expect(FORMAT_RULES[format]).toEqual({
        size: 60,
        sizeMode: 'min',
        singleton: false,
        maxCopies: 4,
        needsCommander: false,
      })
    },
  )

  it('isDeckFormat rejects an unknown or exotic format', () => {
    expect(isDeckFormat('brawl')).toBe(false)
    expect(isDeckFormat('')).toBe(false)
    expect(isDeckFormat('commander')).toBe(true)
  })
})

describe('lib/decks/legality — evaluateDeck', () => {
  // Un Commander de 64 cartes avec deux cartes non-
  // terrain en double retourne `needsWork`, « 36 short · 2 duplicates ».
  it('flags a 64-card Commander deck with two duplicated non-land cards', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Atraxa, Praetors’ Voice', qty: 1, colorIdentity: ['W', 'U', 'B', 'G'] }),
      card({ cardId: 'dup-1', name: 'Sol Ring', qty: 2, colorIdentity: [] }),
      card({ cardId: 'dup-2', name: 'Arcane Signet', qty: 2, colorIdentity: [] }),
      basicLand('Plains', 59),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'plan',
      cards,
      commanders: [commander(['W', 'U', 'B', 'G'])],
    })

    expect(status.kind).toBe('needsWork')
    expect(status.label).toBe('36 short · 2 duplicates')
    expect(status.issues).toEqual([
      { kind: 'short', count: 36 },
      { kind: 'duplicates', count: 2, cardNames: ['Sol Ring', 'Arcane Signet'] },
    ])
  })

  // Demande produit (2026-09-01) : seul Commander porte des règles — tout
  // autre format posé retourne `noRules`, sans contrôle ni libellé de
  // légalité, quelle que soit la composition.
  it('returns noRules for any non-Commander format, clean or not', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Lightning Bolt', qty: 4 }),
      card({ cardId: 'b', name: 'Ragavan, Nimble Pilferer', qty: 4 }),
      basicLand('Mountain', 52),
    ]

    const status = evaluateDeck({ format: 'modern', deckState: 'assemble', cards, commanders: [] })

    expect(status).toEqual({ kind: 'noRules', label: 'Modern', issues: [] })
  })

  // Une carte hors identité colorée produit un
  // `LegalityIssue` `colour_identity` avec le nom de la carte.
  it('flags a card outside the commander color identity', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      card({ cardId: 'off-colour', name: 'Cryptic Command', qty: 1, colorIdentity: ['U'] }),
      basicLand('Mountain', 98),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'plan',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status.issues).toContainEqual({
      kind: 'colour_identity',
      count: 1,
      cardNames: ['Cryptic Command'],
    })
  })

  // Les terrains de base échappent à la règle singleton
  // et à la limite de quatre exemplaires, dans tous les formats.
  it('never flags basic lands as duplicates, in Commander or a 4-copy format', () => {
    const commanderCards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      basicLand('Mountain', 40),
      basicLand('Forest', 59),
    ]
    const commanderStatus = evaluateDeck({
      format: 'commander',
      deckState: 'plan',
      cards: commanderCards,
      commanders: [commander(['R', 'G'])],
    })
    expect(commanderStatus.issues.find((issue) => issue.kind === 'duplicates')).toBeUndefined()

    // Les formats 4-copies n'ont plus de règles du tout (`noRules`) : le
    // non-signalement des terrains y est trivialement vrai.
    const modernCards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Lightning Bolt', qty: 4 }),
      basicLand('Mountain', 56),
    ]
    const modernStatus = evaluateDeck({ format: 'modern', deckState: 'assemble', cards: modernCards, commanders: [] })
    expect(modernStatus.issues).toEqual([])
  })

  // Un deck sans format retourne `noFormat`, quelle que
  // soit sa composition.
  it('returns noFormat regardless of composition when no format is set', () => {
    const messyCards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Banned Card', qty: 99, legalities: { commander: 'banned' } }),
    ]

    const status = evaluateDeck({ format: null, deckState: 'plan', cards: messyCards, commanders: [] })

    expect(status).toEqual({ kind: 'noFormat', label: 'No format set', issues: [] })
  })

  // Un deck `built` affiche « N cards missing » plutôt
  // que « N short » pour une pénurie, et prend le statut `built` quand il
  // n'a aucun problème.
  it('labels a shortfall as "cards missing" for a built deck', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'The Ur-Dragon', qty: 1, colorIdentity: ['W', 'U', 'B', 'R', 'G'] }),
      basicLand('Forest', 95),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'built',
      cards,
      commanders: [commander(['W', 'U', 'B', 'R', 'G'])],
    })

    expect(status.kind).toBe('needsWork')
    expect(status.label).toBe('4 cards missing')
  })

  it('reaches kind "built" (not "legal") for a built Commander deck with no issues', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      basicLand('Mountain', 99),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'built',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status).toEqual({ kind: 'built', label: 'Legal for Commander', issues: [] })
  })

  it('returns noRules even for a built non-Commander deck', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Lightning Bolt', qty: 4 }),
      basicLand('Mountain', 56),
    ]

    const status = evaluateDeck({ format: 'modern', deckState: 'built', cards, commanders: [] })

    expect(status).toEqual({ kind: 'noRules', label: 'Modern', issues: [] })
  })

  it('flags a missing commander in Commander format', () => {
    const cards: DeckEvaluationCard[] = [basicLand('Plains', 99)]

    const status = evaluateDeck({ format: 'commander', deckState: 'plan', cards, commanders: [] })

    expect(status.issues).toContainEqual({ kind: 'no_commander', count: 1 })
  })

  it('reports a dismantled deck as dismantled rather than short or without format', () => {
    for (const format of ['commander', null] as const) {
      const status = evaluateDeck({ format, deckState: 'dismantled', cards: [], commanders: [] })

      expect(status).toEqual({ kind: 'dismantled', label: 'Dismantled', issues: [] })
    }
  })

  it('flags a banned card using the catalogue legality field', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      card({
        cardId: 'a',
        name: 'Balance',
        qty: 1,
        colorIdentity: [],
        legalities: { ...LEGAL_EVERYWHERE, commander: 'banned' },
      }),
      basicLand('Mountain', 98),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'assemble',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status.issues).toContainEqual({ kind: 'banned', count: 1, cardNames: ['Balance'] })
  })

  it('runs no copy check for a 4-copy format — noRules, never duplicates', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Ponder', qty: 5 }),
      basicLand('Island', 55),
    ]

    const status = evaluateDeck({ format: 'legacy', deckState: 'plan', cards, commanders: [] })

    expect(status).toEqual({ kind: 'noRules', label: 'Legacy', issues: [] })
  })

  it('aggregates multiple holdings of the same card (different finish/condition) into one total', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'same-card', name: 'Sol Ring', qty: 1 }),
      card({ cardId: 'same-card', name: 'Sol Ring', qty: 1 }),
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      basicLand('Mountain', 97),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'plan',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status.issues).toContainEqual({ kind: 'duplicates', count: 1, cardNames: ['Sol Ring'] })
  })

  // `size` est un plancher pour les six formats à 60
  // cartes — un 61e carte reste légal, jamais `over`.
  it('never flags a 61-card Modern deck as over — noRules applies', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'a', name: 'Lightning Bolt', qty: 4 }),
      card({ cardId: 'b', name: 'Ragavan, Nimble Pilferer', qty: 4 }),
      basicLand('Mountain', 53),
    ]

    const status = evaluateDeck({ format: 'modern', deckState: 'assemble', cards, commanders: [] })

    expect(status).toEqual({ kind: 'noRules', label: 'Modern', issues: [] })
  })

  // `over` ne se déclenche que pour un format à
  // taille exacte — un Commander de 101 cartes n'est pas légal en tournoi.
  it('flags a 101-card Commander deck as over', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      basicLand('Mountain', 100),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'plan',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status.issues).toContainEqual({ kind: 'over', count: 1 })
  })

  it('flags a card that is not legal for the format using the catalogue legality field', () => {
    const cards: DeckEvaluationCard[] = [
      card({ cardId: 'commander', name: 'Krenko, Mob Boss', qty: 1, colorIdentity: ['R'] }),
      card({
        cardId: 'a',
        name: 'Channel',
        qty: 1,
        colorIdentity: [],
        legalities: { ...LEGAL_EVERYWHERE, commander: 'not_legal' },
      }),
      basicLand('Mountain', 98),
    ]

    const status = evaluateDeck({
      format: 'commander',
      deckState: 'assemble',
      cards,
      commanders: [commander(['R'])],
    })

    expect(status.issues).toContainEqual({ kind: 'not_legal', count: 1, cardNames: ['Channel'] })
  })

  describe('two commanders', () => {
    const PARTNER = 'Partner (You can have two commanders if both have partner.)'
    const thrasios = commander(['G', 'U'], { name: 'Thrasios, Triton Hero', oracleText: PARTNER })
    const tymna = commander(['W', 'B'], { name: 'Tymna the Weaver', oracleText: PARTNER })
    const krenko = commander(['R'], { name: 'Krenko, Mob Boss' })

    function partnerDeck(extra: DeckEvaluationCard[]): DeckEvaluationCard[] {
      return [
        card({ cardId: 'thrasios', name: 'Thrasios, Triton Hero', colorIdentity: ['G', 'U'] }),
        card({ cardId: 'tymna', name: 'Tymna the Weaver', colorIdentity: ['W', 'B'] }),
        ...extra,
      ]
    }

    it('accepts cards from either partner and counts both commanders in the 100', () => {
      const status = evaluateDeck({
        format: 'commander',
        deckState: 'plan',
        cards: partnerDeck([
          card({ cardId: 'swords', name: 'Swords to Plowshares', colorIdentity: ['W'] }),
          card({ cardId: 'growth', name: 'Sylvan Library', colorIdentity: ['G'] }),
          basicLand('Plains', 96),
        ]),
        commanders: [thrasios, tymna],
      })

      expect(status.kind).toBe('legal')
    })

    it('still flags a card outside both identities', () => {
      const status = evaluateDeck({
        format: 'commander',
        deckState: 'plan',
        cards: partnerDeck([card({ cardId: 'bolt', name: 'Lightning Bolt', colorIdentity: ['R'] }), basicLand('Plains', 97)]),
        commanders: [thrasios, tymna],
      })

      expect(status.issues).toEqual([{ kind: 'colour_identity', count: 1, cardNames: ['Lightning Bolt'] }])
    })

    it('reports an illegal pair as a legality issue', () => {
      const status = evaluateDeck({
        format: 'commander',
        deckState: 'plan',
        cards: [
          card({ cardId: 'thrasios', name: 'Thrasios, Triton Hero', colorIdentity: ['G', 'U'] }),
          card({ cardId: 'krenko', name: 'Krenko, Mob Boss', colorIdentity: ['R'] }),
          basicLand('Island', 98),
        ],
        commanders: [thrasios, krenko],
      })

      expect(status.kind).toBe('needsWork')
      expect(status.issues).toContainEqual({
        kind: 'commander_pair',
        count: 2,
        cardNames: ['Thrasios, Triton Hero', 'Krenko, Mob Boss'],
      })
      expect(status.label).toBe('Invalid commander pair')
    })
  })
})
