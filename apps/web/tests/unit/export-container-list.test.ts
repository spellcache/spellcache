// `formatContainerList` : la grammaire de ligne de `formatDeckList`, plus
// les en-têtes de section que `parseList` sait relire. Ce fichier est le seul
// barrage exécutable de l'aller-retour tant que Postgres ne tourne pas —
// `tests/integration/import-list.test.ts` couvre le même comportement de bout
// en bout, mais se saute sans base éphémère.
import { describe, expect, it } from 'vitest'

import { formatContainerList } from '@/components/lists/export-sheet'
import { parseList } from '@/lib/lists/parse-list'
import type { ExportLine } from '@/app/(app)/container/[id]/sharing-actions'

function line(overrides: Partial<ExportLine> = {}): ExportLine {
  return {
    qty: 1,
    name: 'Lightning Bolt',
    setCode: '2x2',
    collectorNumber: '117',
    zone: 'main',
    isCommander: false,
    ...overrides,
  }
}

describe('formatContainerList', () => {
  it('n’émet aucun en-tête quand tout tient dans le mainboard', () => {
    const text = formatContainerList([line({ qty: 4 }), line({ name: 'Sol Ring', qty: 1 })])

    expect(text).toBe('4 Lightning Bolt (2X2) 117\n1 Sol Ring (2X2) 117')
  })

  it('émet Commander, Deck et Sideboard dans l’ordre de lecture d’un deck', () => {
    const text = formatContainerList([
      line({ name: 'Sol Ring', qty: 4 }),
      line({ name: 'Atraxa', zone: 'commander', isCommander: true }),
      line({ name: 'Pithing Needle', qty: 2, zone: 'side' }),
    ])

    expect(text).toBe(
      [
        'Commander',
        '1 Atraxa (2X2) 117',
        '',
        'Deck',
        '4 Sol Ring (2X2) 117',
        '',
        'Sideboard',
        '2 Pithing Needle (2X2) 117',
      ].join('\n'),
    )
  })

  it('classe en commandant une ligne dont seul `is_commander` est posé', () => {
    const text = formatContainerList([
      line({ name: 'Atraxa', zone: 'main', isCommander: true }),
      line({ name: 'Sol Ring' }),
    ])

    expect(text.split('\n').slice(0, 2)).toEqual(['Commander', '1 Atraxa (2X2) 117'])
  })

  it('produit un texte que `parseList` relit avec les mêmes zones', () => {
    const lines = [
      line({ name: 'Atraxa', zone: 'commander', isCommander: true }),
      line({ name: 'Sol Ring', qty: 4 }),
      line({ name: 'Pithing Needle', qty: 2, zone: 'side' }),
    ]

    const parsed = parseList(formatContainerList(lines))

    expect(parsed.ignored).toEqual([])
    expect(parsed.lines).toEqual([
      {
        raw: '1 Atraxa (2X2) 117',
        qty: 1,
        name: 'Atraxa',
        setCode: '2x2',
        collectorNumber: '117',
        zone: 'commander',
      },
      {
        raw: '4 Sol Ring (2X2) 117',
        qty: 4,
        name: 'Sol Ring',
        setCode: '2x2',
        collectorNumber: '117',
        zone: 'main',
      },
      {
        raw: '2 Pithing Needle (2X2) 117',
        qty: 2,
        name: 'Pithing Needle',
        setCode: '2x2',
        collectorNumber: '117',
        zone: 'side',
      },
    ])
  })

  it('reste vide sur une liste vide', () => {
    expect(formatContainerList([])).toBe('')
  })
})
