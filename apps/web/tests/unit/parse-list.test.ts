// Test unitaire : les quatre formats de liste, lignes parasites. Pur —
// `parseList` et `normalizeCardName` n'ouvrent
// aucune connexion, ils sont donc prouvables sans Postgres, contrairement à
// `resolveList` (couvert par `tests/integration/import-list.test.ts`).
import { describe, expect, it } from 'vitest'

import {
  NAME_TRANSLATE_FROM,
  NAME_TRANSLATE_TO,
  frontFaceOf,
  normalizeCardName,
} from '@/lib/lists/normalize-name'
import { parseList } from '@/lib/lists/parse-list'

describe('parseList — les quatre formats', () => {
  it('lit `4 Lightning Bolt`', () => {
    const { lines } = parseList('4 Lightning Bolt')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      qty: 4,
      name: 'Lightning Bolt',
      setCode: null,
      collectorNumber: null,
    })
  })

  it('lit `4 Lightning Bolt (2X2) 117`', () => {
    const { lines } = parseList('4 Lightning Bolt (2X2) 117')
    expect(lines[0]).toMatchObject({
      qty: 4,
      name: 'Lightning Bolt',
      // Replié sur la forme du catalogue (`cards.set_code` est en
      // minuscules) — sinon la résolution ne trouverait jamais
      // l'impression demandée.
      setCode: '2x2',
      collectorNumber: '117',
    })
  })

  it('lit `4x Lightning Bolt`', () => {
    const { lines } = parseList('4x Lightning Bolt')
    expect(lines[0]).toMatchObject({ qty: 4, name: 'Lightning Bolt', setCode: null })
  })

  it('lit `4x Lightning Bolt (2X2) 117`', () => {
    const { lines } = parseList('4x Lightning Bolt (2X2) 117')
    expect(lines[0]).toMatchObject({
      qty: 4,
      name: 'Lightning Bolt',
      setCode: '2x2',
      collectorNumber: '117',
    })
  })

  it('accepte un set sans numéro de collection', () => {
    const { lines } = parseList('1 Lightning Bolt (2X2)')
    expect(lines[0]).toMatchObject({
      qty: 1,
      name: 'Lightning Bolt',
      setCode: '2x2',
      collectorNumber: null,
    })
  })

  it('garde le `//` d’une carte double face dans le nom', () => {
    const { lines } = parseList('1 Fire // Ice (MH2) 290')
    expect(lines[0]).toMatchObject({
      qty: 1,
      name: 'Fire // Ice',
      setCode: 'mh2',
      collectorNumber: '290',
    })
  })

  it('lit une quantité à deux chiffres', () => {
    expect(parseList('10 Forest').lines[0]).toMatchObject({ qty: 10, name: 'Forest' })
  })
})

describe('parseList — lignes vides, sections et lignes parasites', () => {
  it('ne produit aucune ligne de carte pour une ligne vide ou un en-tête', () => {
    const { lines, ignored } = parseList('Deck\n\n\nSideboard\n')
    expect(lines).toHaveLength(0)
    // Les lignes vides ne sont pas listées comme ignorées : une chaîne vide
    // ne dirait rien à l'utilisateur.
    expect(ignored).toEqual([])
  })

  it('bascule la zone sur `side` puis `commander`', () => {
    const { lines } = parseList(
      ['Deck', '4 Lightning Bolt', 'Sideboard', '2 Pyroblast', 'Commander', '1 Krenko, Mob Boss'].join(
        '\n',
      ),
    )
    expect(lines.map((line) => [line.name, line.zone])).toEqual([
      ['Lightning Bolt', 'main'],
      ['Pyroblast', 'side'],
      ['Krenko, Mob Boss', 'commander'],
    ])
  })

  it('laisse `zone` à null tant qu’aucun en-tête n’a été rencontré', () => {
    expect(parseList('4 Lightning Bolt').lines[0]!.zone).toBeNull()
  })

  it('reconnaît `Sideboard:`, `// Sideboard` et `Sideboard (15)`', () => {
    for (const header of ['Sideboard:', '// Sideboard', 'Sideboard (15)']) {
      const { lines } = parseList(`${header}\n2 Pyroblast`)
      expect(lines[0]!.zone).toBe('side')
    }
  })

  it('range une ligne sans quantité dans `ignored`, jamais dans les cartes', () => {
    const { lines, ignored } = parseList('About\nName Mono Red\n4 Lightning Bolt')
    expect(lines.map((line) => line.name)).toEqual(['Lightning Bolt'])
    expect(ignored).toEqual(['About', 'Name Mono Red'])
  })

  it('conserve la ligne d’origine dans `raw`', () => {
    expect(parseList('  4 Lightning Bolt  ').lines[0]!.raw).toBe('  4 Lightning Bolt  ')
  })
})

describe('normalizeCardName', () => {
  it('replie la casse et les espaces', () => {
    expect(normalizeCardName('  LIGHTNING   Bolt ')).toBe('lightning bolt')
  })

  it('replie les accents', () => {
    expect(normalizeCardName('Márton Stromgald')).toBe('marton stromgald')
    expect(normalizeCardName('Lim-Dûl the Necromancer')).toBe('lim-dul the necromancer')
    expect(normalizeCardName('Jötun Grunt')).toBe('jotun grunt')
  })

  it('replie les cinq formes d’apostrophe sur la même chaîne', () => {
    const expected = 'gaeas cradle'
    expect(normalizeCardName("Gaea's Cradle")).toBe(expected)
    expect(normalizeCardName('Gaea’s Cradle')).toBe(expected)
    expect(normalizeCardName('Gaea‘s Cradle')).toBe(expected)
    expect(normalizeCardName('Gaea´s Cradle')).toBe(expected)
    expect(normalizeCardName('Gaeas Cradle')).toBe(expected)
  })

  it('replie le digramme Æ', () => {
    expect(normalizeCardName('Æther Vial')).toBe('aether vial')
    expect(normalizeCardName('aether vial')).toBe('aether vial')
  })

  it('donne la face avant d’une carte double face', () => {
    const full = normalizeCardName('Nicol Bolas, the Ravager // Nicol Bolas, the Arisen')
    expect(full).toBe('nicol bolas, the ravager // nicol bolas, the arisen')
    expect(frontFaceOf(full)).toBe('nicol bolas, the ravager')
    // Sans espace autour du `//` : même face avant, sinon une liste collée
    // depuis un export serré ne résoudrait pas.
    expect(frontFaceOf(normalizeCardName('Fire//Ice'))).toBe('fire')
    expect(frontFaceOf(normalizeCardName('Lightning Bolt'))).toBe('lightning bolt')
  })

  it('garde une table `translate` cohérente avec la sémantique Postgres', () => {
    // `translate(from, to)` remplace positionnellement et **supprime** les
    // caractères de `from` sans position dans `to` : `to` ne doit donc jamais
    // être plus long que `from`, sinon la queue de `to` serait morte, et
    // toute divergence de longueur ici change silencieusement le
    // comportement des deux implémentations à la fois.
    expect(NAME_TRANSLATE_TO.length).toBeLessThanOrEqual(NAME_TRANSLATE_FROM.length)
    expect(NAME_TRANSLATE_FROM.length - NAME_TRANSLATE_TO.length).toBe(5)
    expect(new Set(NAME_TRANSLATE_FROM).size).toBe(NAME_TRANSLATE_FROM.length)
  })
})
