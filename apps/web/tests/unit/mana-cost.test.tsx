// Parsing des coûts de mana en symboles. `tests/unit/**/*.test.tsx`
// (vitest.config.ts, environnement `node` — le rendu ci-dessous passe par
// `react-dom/server`, sans DOM/jsdom) : la logique de parsing est testée via
// `parseManaSymbols`, la fonction pure exportée séparément du composant
// `ManaCost` (components/cards/mana-cost.tsx). Le second bloc ci-dessous teste
// le composant lui-même (le rendu JSX en trois `<img>`) — d'où l'extension
// `.tsx`, celle qu'inclut `vitest.config.ts`.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ManaCost, parseManaSymbols } from '@/components/cards/mana-cost'

describe('parseManaSymbols', () => {
  it('extrait un symbole par paire d’accolades, dans l’ordre', () => {
    expect(parseManaSymbols('{2}{W}{U}')).toEqual(['2', 'W', 'U'])
  })

  it('met les symboles en majuscules', () => {
    expect(parseManaSymbols('{2}{w}{u}')).toEqual(['2', 'W', 'U'])
  })

  it('conserve tous les symboles, hybrides et phyrexians compris', () => {
    expect(parseManaSymbols('{2}{R/W}{R/P}{G}')).toEqual(['2', 'R/W', 'R/P', 'G'])
  })

  it('renvoie un tableau vide pour un coût null', () => {
    expect(parseManaSymbols(null)).toEqual([])
  })

  it('renvoie un tableau vide pour un coût vide', () => {
    expect(parseManaSymbols('')).toEqual([])
  })

  it('couvre les huit symboles génériques et les cinq couleurs plus incolore/X', () => {
    expect(parseManaSymbols('{0}{1}{2}{3}{4}{5}{6}{7}{W}{U}{B}{R}{G}{C}{X}')).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      'W',
      'U',
      'B',
      'R',
      'G',
      'C',
      'X',
    ])
  })
})

// Le composant lui-même : `ManaCost` rend {2}{W}{U} en trois <img> pointant
// /mana/2.svg, /mana/W.svg, /mana/U.svg en 12px, et ignore silencieusement un
// symbole inconnu au lieu de planter.
describe('ManaCost', () => {
  it('rend {2}{W}{U} en trois <img> à 12px, dans l’ordre, pointant public/mana/', () => {
    const html = renderToStaticMarkup(<ManaCost cost="{2}{W}{U}" size={12} />)
    const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((match) => match[1])
    expect(srcs).toEqual(['/mana/2.svg', '/mana/W.svg', '/mana/U.svg'])

    const widths = [...html.matchAll(/<img[^>]*width="([^"]+)"[^>]*>/g)].map((match) => match[1])
    const heights = [...html.matchAll(/<img[^>]*height="([^"]+)"[^>]*>/g)].map((match) => match[1])
    expect(widths).toEqual(['12', '12', '12'])
    expect(heights).toEqual(['12', '12', '12'])
  })

  it('rend les hybrides et phyrexians avec leurs assets vendorisés', () => {
    const html = renderToStaticMarkup(<ManaCost cost="{2}{R/W}{R/P}{G}" size={12} />)
    const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((match) => match[1])
    expect(srcs).toEqual(['/mana/2.svg', '/mana/RW.svg', '/mana/RP.svg', '/mana/G.svg'])
  })

  it('retombe sur une pastille lettrée pour un symbole non vendorisé', () => {
    const html = renderToStaticMarkup(<ManaCost cost="{2}{T}{G}" size={12} />)
    const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((match) => match[1])
    expect(srcs).toEqual(['/mana/2.svg', '/mana/G.svg'])
    expect(html).toContain('shadow-pip-outline')
    expect(html).toContain('>T<')
  })

  it('ne rend rien pour un coût null', () => {
    expect(renderToStaticMarkup(<ManaCost cost={null} size={12} />)).toBe('')
  })
})
