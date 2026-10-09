import { describe, expect, it } from 'vitest'

import { parseList } from '@/lib/lists/parse-list'

describe('parseList — CSV exports', () => {
  it('reads a ManaBox export by header name, quoted fields included', () => {
    const csv = [
      'Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Signed,Condition,Language,Proxy,Purchase price currency,Added',
      'Wilhelt,deck,Aetherspouts,MIC,Midnight Hunt Commander,97,normal,rare,1,63667,b5cb6da6-d43b-4ad1-bb77-9eeb6d15240c,0.33,false,false,false,near_mint,en,false,CHF,2023-01-04T17:29:06.059Z',
      'Trade,binder,"Kozilek, Butcher of Truth","PLST","The List, Promos",ROE-6,foil,mythic,2,1,2,3,false,false,false,lightly_played,fr,false,CHF,2023-01-04T17:29:06.059Z',
      'Trade,binder,Sol Ring,CMM,Commander Masters,410,etched,uncommon,3,1,2,3,false,false,false,near_mint,en,false,CHF,2023-01-04T17:29:06.059Z',
    ].join('\r\n')

    const { lines, ignored } = parseList(csv)

    expect(ignored).toEqual([])
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      name: 'Aetherspouts',
      qty: 1,
      setCode: 'mic',
      collectorNumber: '97',
      finish: 'nonfoil',
      condition: 'nm',
      language: 'en',
      zone: null,
    })
    expect(lines[1]).toMatchObject({
      name: 'Kozilek, Butcher of Truth',
      qty: 2,
      setCode: 'plst',
      collectorNumber: 'ROE-6',
      finish: 'foil',
      condition: 'lp',
      language: 'fr',
    })
    expect(lines[2]).toMatchObject({ name: 'Sol Ring', qty: 3, finish: 'etched' })
  })

  it('reads a Moxfield collection export', () => {
    const csv = [
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"',
      '"4","0","Lightning Bolt","2x2","NM","English","","","2024-01-01 00:00:00.000000","117","False","False",""',
      '"1","0","Brainstorm","sta","LP","Japanese","foil","","2024-01-01 00:00:00.000000","13","False","False",""',
    ].join('\n')

    const { lines } = parseList(csv)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      name: 'Lightning Bolt',
      qty: 4,
      setCode: '2x2',
      collectorNumber: '117',
      finish: null,
      condition: 'nm',
      language: 'en',
    })
    expect(lines[1]).toMatchObject({ finish: 'foil', condition: 'lp', language: 'ja' })
  })

  it('ignores a Deckbox edition column holding a full set name', () => {
    const csv = [
      'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed',
      '2,0,Counterspell,Masters 25,50,Good (Lightly Played),English,,',
    ].join('\n')

    const { lines } = parseList(csv)

    expect(lines[0]).toMatchObject({
      name: 'Counterspell',
      qty: 2,
      setCode: null,
      collectorNumber: '50',
      condition: 'lp',
    })
  })

  it('reports rows without a name or a quantity instead of guessing', () => {
    const csv = ['Name,Quantity', 'Lightning Bolt,4', ',3', 'Brainstorm,abc', ''].join('\n')

    const { lines, ignored } = parseList(csv)

    expect(lines.map((line) => line.name)).toEqual(['Lightning Bolt'])
    expect(ignored).toEqual([',3', 'Brainstorm,abc'])
  })

  it('keeps reading plain decklists as before', () => {
    const { lines } = parseList('4 Lightning Bolt (2X2) 117\nSideboard\n2x Pyroblast')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ name: 'Lightning Bolt', setCode: '2x2', collectorNumber: '117' })
    expect(lines[0]!.finish).toBeUndefined()
    expect(lines[1]).toMatchObject({ name: 'Pyroblast', qty: 2, zone: 'side' })
  })
})
