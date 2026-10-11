// Ligne de binder en dégradé : sa bordure est transparente (même hauteur que
// la ligne nue), donc le dégradé doit partir de la boîte de bordure. Partant
// de la boîte de padding, il se répétait sous la bordure et un liseré de son
// palier clair apparaissait au bord droit.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BinderRow } from '@/components/collection/binder-row'

const binder = {
  id: '9877fe26-c846-434f-81c6-3731a8bd4e56',
  name: 'Old school',
  cardCount: 376,
  valueMinor: 48626,
  coverArtUrl: null,
  coverGradient: 'grey' as const,
  coverIntensity: 0.7,
}

describe('BinderRow', () => {
  it('draws a gradient row from the border box, under its transparent border', () => {
    for (const kind of ['binder', 'list'] as const) {
      const html = renderToStaticMarkup(
        <BinderRow binder={binder} currency="eur" binderBackdrops kind={kind} />,
      )
      expect(html).toContain('linear-gradient')
      expect(html).toMatch(/class="[^"]*\bborder-transparent\b[^"]*\bbg-origin-border\b/)
    }
  })
})
