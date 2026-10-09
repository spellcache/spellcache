// Aller-retour URL ⇄ `ViewState` et tolérance à l'invalide.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  countActiveFilters,
  describeActiveFilters,
  EMPTY_FILTERS,
  parseViewState,
  toSearchParams,
  type HoldingFilters,
  type ViewState,
} from '@/lib/view-state/parse'

describe('lib/view-state/parse', () => {
  it('produces empty search params for the default view state', () => {
    const defaultState = parseViewState(new URLSearchParams())
    expect(toSearchParams(defaultState).toString()).toBe('')
  })

  it('round-trips through parse -> serialize -> parse -> serialize identically', () => {
    const raw = new URLSearchParams({
      q: 'lightning bolt',
      colors: 'R,U',
      color_match: 'exactly',
      types: 'Creature,Instant',
      rarities: 'rare,mythic',
      finishes: 'foil',
      conditions: 'nm,lp',
      set: 'ktk',
      price_min: '500',
      price_max: '2000',
      sort: 'price',
      dir: 'high',
      group: 'set',
      density: 'grid',
    })

    const first = toSearchParams(parseViewState(raw))
    const second = toSearchParams(parseViewState(first))

    expect(second.toString()).toBe(first.toString())
    expect(first.get('q')).toBe('lightning bolt')
    expect(first.get('colors')).toBe('R,U')
    expect(first.get('sort')).toBe('price')
    expect(first.get('dir')).toBe('high')
    expect(first.get('group')).toBe('set')
    expect(first.get('density')).toBe('grid')
  })

  it('omits default values from the serialized URL', () => {
    const state: ViewState = {
      query: '',
      filters: EMPTY_FILTERS,
      sort: { key: 'name', dir: 'low' },
      groupBy: null,
      density: null,
    }

    expect(toSearchParams(state).toString()).toBe('')
  })

  it('falls back to defaults on corrupted sort/dir/price params without throwing', () => {
    const raw = new URLSearchParams({
      sort: 'banane',
      dir: 'sideways',
      price_min: 'abc',
      price_max: 'nope',
      group: 'nonsense',
      density: 'huge',
    })

    expect(() => parseViewState(raw)).not.toThrow()
    const state = parseViewState(raw)

    expect(state.sort).toEqual({ key: 'name', dir: 'low' })
    expect(state.filters.priceMinMinor).toBeNull()
    expect(state.filters.priceMaxMinor).toBeNull()
    expect(state.groupBy).toBeNull()
    expect(state.density).toBeNull()
  })

  it('drops unknown values from enum lists without throwing', () => {
    const raw = new URLSearchParams({
      colors: 'R,X,U,R',
      finishes: 'foil,holographic',
      conditions: 'nm,broken',
    })

    const state = parseViewState(raw)
    expect(state.filters.colors).toEqual(['R', 'U'])
    expect(state.filters.finishes).toEqual(['foil'])
    expect(state.filters.conditions).toEqual(['nm'])
  })

  it('falls back to null on a malformed binder id rather than throwing', () => {
    const raw = new URLSearchParams({ binder: 'not-a-uuid' })
    expect(() => parseViewState(raw)).not.toThrow()
    expect(parseViewState(raw).filters.binderId).toBeNull()
  })

  it('accepts a well-formed binder id', () => {
    const id = randomUUID()
    const raw = new URLSearchParams({ binder: id })
    expect(parseViewState(raw).filters.binderId).toBe(id)
  })

  it('keeps Mono only and Multicolour only mutually exclusive when both are set in a hand-crafted URL', () => {
    const raw = new URLSearchParams({ multicolour_only: '1', mono_only: '1' })
    const state = parseViewState(raw)
    expect(state.filters.multicolourOnly).toBe(true)
    expect(state.filters.monoOnly).toBe(false)
  })

  it('normalizes an explicit group=none to the default null groupBy', () => {
    const raw = new URLSearchParams({ group: 'none' })
    const state = parseViewState(raw)
    expect(state.groupBy).toBeNull()
    expect(toSearchParams(state).has('group')).toBe(false)
  })

  it('counts each selected value once, ignoring an inert colorMatch with no colors selected', () => {
    const noop: HoldingFilters = { ...EMPTY_FILTERS, colorMatch: 'exactly' }
    expect(countActiveFilters(noop)).toBe(0)

    const active: HoldingFilters = {
      ...EMPTY_FILTERS,
      colors: ['R', 'U'],
      types: ['Creature'],
      finishes: ['foil'],
      setCode: 'ktk',
      priceMinMinor: 100,
    }
    expect(countActiveFilters(active)).toBe(6)
  })

  it('describes no chip for filters that are not filtering', () => {
    expect(describeActiveFilters({ ...EMPTY_FILTERS, colorMatch: 'exactly' }, 'usd')).toEqual([])
  })

  // Une puce couleurs unique
  // (les lettres concaténées dans l'ordre WUBRGC, jamais une par couleur),
  // une puce prix unique `min – max`, et les bascules épellent « only » une
  // fois actives.
  it('yields one removable chip per active criterion, colours and price collapsed into a single chip each', () => {
    const active: HoldingFilters = {
      ...EMPTY_FILTERS,
      colors: ['R', 'U'],
      monoOnly: true,
      types: ['Creature'],
      rarities: ['mythic'],
      finishes: ['foil'],
      conditions: ['nm'],
      setCode: 'ktk',
      priceMinMinor: 100,
    }

    const chips = describeActiveFilters(active, 'usd')
    expect(chips.map((chip) => chip.label)).toEqual([
      'UR',
      'Mono only',
      'Creature',
      'Mythic',
      'Foil only',
      'NM',
      'KTK',
      '$1.00 – ∞',
    ])
  })

  it('prefixes the colour chip with the active colour match mode, never on the default "including"', () => {
    const including = describeActiveFilters({ ...EMPTY_FILTERS, colors: ['W'] }, 'usd')
    expect(including.find((chip) => chip.key === 'colors')?.label).toBe('W')

    const exactly = describeActiveFilters(
      { ...EMPTY_FILTERS, colors: ['W'], colorMatch: 'exactly' },
      'usd',
    )
    expect(exactly.find((chip) => chip.key === 'colors')?.label).toBe('Exactly W')

    const atMost = describeActiveFilters(
      { ...EMPTY_FILTERS, colors: ['W'], colorMatch: 'atMost' },
      'usd',
    )
    expect(atMost.find((chip) => chip.key === 'colors')?.label).toBe('At most W')
  })

  // La puce `Binder` (voir le commentaire de tête de `listHoldings`,
  // `holdings-data.ts`) porte le nom réel du binder (ou de la racine, « No binder ») plutôt qu'un libellé
  // générique « In binder » — `binders` est le troisième paramètre optionnel
  // ajouté à `describeActiveFilters`, `[]` par défaut pour ne rien changer
  // aux appels à deux arguments ci-dessus.
  it('labels the binder chip with the matching binder name, falling back to a generic label when unknown', () => {
    const binderId = randomUUID()
    const rootId = randomUUID()
    const binders = [
      { id: binderId, name: 'Modern staples' },
      { id: rootId, name: 'No binder' },
    ]

    const named = describeActiveFilters({ ...EMPTY_FILTERS, binderId }, 'usd', binders)
    expect(named.find((chip) => chip.key === 'binder')?.label).toBe('Modern staples')

    const loose = describeActiveFilters({ ...EMPTY_FILTERS, binderId: rootId }, 'usd', binders)
    expect(loose.find((chip) => chip.key === 'binder')?.label).toBe('No binder')

    const unknown = describeActiveFilters({ ...EMPTY_FILTERS, binderId: randomUUID() }, 'usd', binders)
    expect(unknown.find((chip) => chip.key === 'binder')?.label).toBe('Binder')

    const withoutList = describeActiveFilters({ ...EMPTY_FILTERS, binderId }, 'usd')
    expect(withoutList.find((chip) => chip.key === 'binder')?.label).toBe('Binder')
  })

  it('shows an infinity sign for whichever price bound is missing', () => {
    const minOnly = describeActiveFilters({ ...EMPTY_FILTERS, priceMinMinor: 500 }, 'usd')
    expect(minOnly.find((chip) => chip.key === 'price')?.label).toBe('$5.00 – ∞')

    const maxOnly = describeActiveFilters({ ...EMPTY_FILTERS, priceMaxMinor: 500 }, 'usd')
    expect(maxOnly.find((chip) => chip.key === 'price')?.label).toBe('∞ – $5.00')
  })

  it('drops exactly one criterion per chip, leaving the rest untouched', () => {
    const active: HoldingFilters = {
      ...EMPTY_FILTERS,
      colors: ['R', 'U'],
      rarities: ['rare', 'mythic'],
      setCode: 'ktk',
    }

    // La puce couleurs efface les deux couleurs à la fois (une seule puce,
    // un seul critère) : le décompte tombe de deux, pas d'un.
    for (const chip of describeActiveFilters(active, 'usd')) {
      const expectedDrop = chip.key === 'colors' ? 2 : 1
      expect(countActiveFilters(chip.next)).toBe(countActiveFilters(active) - expectedDrop)
    }

    const colours = describeActiveFilters(active, 'usd').find((chip) => chip.key === 'colors')
    expect(colours?.next.colors).toEqual([])
    expect(colours?.next.rarities).toEqual(['rare', 'mythic'])
    expect(colours?.next.setCode).toBe('ktk')
  })

  it('leaves the source filters untouched when a chip is applied', () => {
    const active: HoldingFilters = { ...EMPTY_FILTERS, colors: ['R'], setCode: 'ktk' }
    describeActiveFilters(active, 'usd').forEach((chip) => chip.next)
    expect(active.colors).toEqual(['R'])
    expect(active.setCode).toBe('ktk')
  })
})
