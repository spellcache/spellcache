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

describe('parseList — other exporters and file quirks', () => {
  it('reads a TCGplayer export, preferring Set Code over the full Set name', () => {
    const csv = [
      'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU',
      '3,Arcane Signet,Arcane Signet,Commander 2021,236,C21,Normal,Near Mint,English,Common,1,2',
      '1,Smothering Tithe,Smothering Tithe,Ravnica Allegiance,22,RNA,Foil,Lightly Played,German,Rare,3,4',
    ].join('\n')

    const { lines, ignored } = parseList(csv)

    expect(ignored).toEqual([])
    expect(lines[0]).toMatchObject({
      name: 'Arcane Signet',
      qty: 3,
      setCode: 'c21',
      collectorNumber: '236',
      finish: 'nonfoil',
      condition: 'nm',
      language: 'en',
    })
    expect(lines[1]).toMatchObject({ setCode: 'rna', finish: 'foil', condition: 'lp', language: 'de' })
  })

  it('reads a Deckbox export row by row, with a foil column and an empty set code', () => {
    const csv = [
      'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless,My Price',
      '1,0,Brainstorm,Mercadian Masques,61,Near Mint,Japanese,foil,,,,,,,$1.00',
      '4,0,Swords to Plowshares,Ice Age,54,Heavily Played,English,,,,,,,,$2.00',
    ].join('\n')

    const { lines } = parseList(csv)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ name: 'Brainstorm', setCode: null, finish: 'foil', condition: 'nm', language: 'ja' })
    expect(lines[1]).toMatchObject({ name: 'Swords to Plowshares', qty: 4, finish: null, condition: 'hp' })
  })

  it('reads a file saved with a UTF-8 byte order mark', () => {
    const csv = '\uFEFFName,Quantity,Set code,Collector number\nSol Ring,1,c21,263\n'

    const { lines } = parseList(csv)

    expect(lines).toEqual([expect.objectContaining({ name: 'Sol Ring', qty: 1, setCode: 'c21', collectorNumber: '263' })])
  })

  // Excel sur un poste suisse, français ou allemand enregistre un « CSV » avec
  // `;` pour séparateur : l'analyseur ne découpe que sur `,`, le fichier
  // entier passe donc pour une decklist illisible.
  it.fails('reads a CSV saved by Excel with a semicolon separator', () => {
    const csv = ['Name;Quantity;Set code;Collector number;Foil', 'Sol Ring;2;c21;263;normal', '"Kozilek, Butcher of Truth";1;roe;6;foil'].join('\r\n')

    const { lines } = parseList(csv)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ name: 'Sol Ring', qty: 2, setCode: 'c21', finish: 'nonfoil' })
    expect(lines[1]).toMatchObject({ name: 'Kozilek, Butcher of Truth', qty: 1, finish: 'foil' })
  })

  // Dragon Shield (et tout export destiné à Excel) ouvre le fichier par une
  // ligne d'indice `sep=,` : l'en-tête réel n'est que la deuxième ligne.
  it.fails('skips an Excel sep= hint line before the header', () => {
    const csv = [
      'sep=,',
      'Folder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number,Condition,Printing,Language',
      'Main,2,0,Sol Ring,C21,Commander 2021,263,NearMint,Normal,English',
    ].join('\n')

    const { lines } = parseList(csv)

    expect(lines).toEqual([expect.objectContaining({ name: 'Sol Ring', qty: 2, setCode: 'c21', collectorNumber: '263' })])
  })

  it('keeps double-faced names whole and reads a quoted field spanning a line break', () => {
    const csv = [
      'Name,Quantity,Set code,Collector number,Notes',
      'Delver of Secrets // Insectile Aberration,4,isd,51,',
      '"Fire // Ice",2,mh2,290,"bought at\nthe GP"',
    ].join('\n')

    const { lines, ignored } = parseList(csv)

    expect(ignored).toEqual([])
    expect(lines.map((line) => [line.name, line.qty])).toEqual([
      ['Delver of Secrets // Insectile Aberration', 4],
      ['Fire // Ice', 2],
    ])
  })

  it('ignores a zero or empty quantity, and leaves an unknown condition or language to the sheet defaults', () => {
    const csv = [
      'Name,Quantity,Condition,Language,Foil',
      'Island,0,near_mint,en,',
      'Forest,,near_mint,en,',
      'Plains,3,Played-ish,Klingon,maybe',
    ].join('\n')

    const { lines, ignored } = parseList(csv)

    expect(ignored).toEqual(['Island,0,near_mint,en,', 'Forest,,near_mint,en,'])
    expect(lines).toEqual([
      expect.objectContaining({ name: 'Plains', qty: 3, condition: null, language: null, finish: null }),
    ])
  })
})
