// `lib/preferences.ts` : validation
// Zod du patch partiel, valeurs par défaut alignées sur les colonnes
// `users` (`packages/db/migrations/0004_dark_george_stacy.sql`), et les
// deux fonctions dérivées `currencyOf`/`marketLabelOf` — la seule paire de
// contrôles de Settings qui doit toujours refléter la même valeur sous-
// jacente (aucun état local séparé).
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  currencyOf,
  marketLabelOf,
  preferencesSchema,
} from '@/lib/preferences'

describe('DEFAULT_PREFERENCES', () => {
  // `toolLifeTracker` rejoint le lot avec les outils de table
  // (`packages/db/migrations/0012_orange_ender_wiggin.sql`, `DEFAULT false NOT
  // NULL`) : un compte créé avant la colonne lit donc la même valeur ici et
  // en base — l'onglet Tools reste absent tant qu'il n'a rien allumé.
  it('matches the column defaults of packages/db/migrations/0004 and 0012', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      collectionStyle: 'compact',
      density: 'compact',
      previewPane: true,
      pricesOnArt: true,
      binderBackdrops: true,
      priceSource: 'cardmarket_eur',
      toolLifeTracker: false,
      // `packages/db/migrations/0001_tool_playtest.sql`, même `DEFAULT false`.
      toolPlaytest: false,
      // `'[]'::jsonb` en base (`packages/db/migrations/0013_awesome_mathemanic.sql`)
      // — « tout déplié », l'arbre du design validé. Un compte créé avant la
      // colonne lit donc la même chose ici et en base.
      sidebarCollapsed: [],
      accentColor: 'gold',
      pureBlack: false,
      colorScheme: 'dark',
    })
  })
})

describe('preferencesSchema', () => {
  it('accepts a single-field patch', () => {
    const result = preferencesSchema.safeParse({ collectionStyle: 'shelves' })
    expect(result).toEqual({ success: true, data: { collectionStyle: 'shelves' } })
  })

  it('accepts an empty patch', () => {
    expect(preferencesSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a value outside the enum', () => {
    expect(preferencesSchema.safeParse({ collectionStyle: 'grid' }).success).toBe(false)
    expect(preferencesSchema.safeParse({ density: 'huge' }).success).toBe(false)
    expect(preferencesSchema.safeParse({ priceSource: 'usd' }).success).toBe(false)
  })

  it('rejects a sidebar node key outside the closed enum', () => {
    expect(preferencesSchema.safeParse({ sidebarCollapsed: ['collection'] })).toEqual({
      success: true,
      data: { sidebarCollapsed: ['collection'] },
    })
    expect(preferencesSchema.safeParse({ sidebarCollapsed: ['binders'] }).success).toBe(false)
    expect(preferencesSchema.safeParse({ sidebarCollapsed: 'collection' }).success).toBe(false)
  })

  it('rejects a boolean field carrying a non-boolean value', () => {
    expect(preferencesSchema.safeParse({ previewPane: 'yes' }).success).toBe(false)
    expect(preferencesSchema.safeParse({ toolLifeTracker: 'on' }).success).toBe(false)
  })

  it('accepts the life tracker tool flag as a plain boolean patch', () => {
    expect(preferencesSchema.safeParse({ toolLifeTracker: true })).toEqual({
      success: true,
      data: { toolLifeTracker: true },
    })
  })

  it('accepts the playtest tool flag as a plain boolean patch', () => {
    expect(preferencesSchema.safeParse({ toolPlaytest: true })).toEqual({
      success: true,
      data: { toolPlaytest: true },
    })
    expect(preferencesSchema.safeParse({ toolPlaytest: 'on' }).success).toBe(false)
  })

  it('rejects an unknown key', () => {
    expect(preferencesSchema.safeParse({ nickname: 'alexm' }).success).toBe(false)
  })
})

describe('currencyOf / marketLabelOf', () => {
  it('tcgplayer_usd resolves to usd / TCGplayer market', () => {
    expect(currencyOf({ priceSource: 'tcgplayer_usd' })).toBe('usd')
    expect(marketLabelOf({ priceSource: 'tcgplayer_usd' })).toBe('TCGplayer market')
  })

  it('cardmarket_eur resolves to eur / Cardmarket trend', () => {
    expect(currencyOf({ priceSource: 'cardmarket_eur' })).toBe('eur')
    expect(marketLabelOf({ priceSource: 'cardmarket_eur' })).toBe('Cardmarket trend')
  })
})
