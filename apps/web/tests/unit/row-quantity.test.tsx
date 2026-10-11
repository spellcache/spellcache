// Quantité des lignes de carte (binder, liste, deck) en lecture seule : un
// stepper en ligne se déclenchait au défilement d'un simple effleurement. Le
// compteur vit dans la feuille de la carte, jamais dans la ligne.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CardRow } from '@/components/cards/card-row'
import { CompactRow } from '@/components/cards/compact-row'
import { DeckCardRow } from '@/components/decks/deck-card-row'

const card = {
  thumbUrl: '/thumb.jpg',
  name: 'Aerial Caravan',
  manaCost: '{4}{U}{U}',
  setCode: 'mmq',
  collectorNumber: '58',
  condition: 'hp' as const,
  isFoil: false,
  qty: 3,
  priceLabel: '€0.40',
  onOpen: () => {},
}

const QUANTITY_BUTTON = /aria-label="(Decrease quantity|Increase quantity|One less [^"]*|One more [^"]*)"/

describe('card rows show a read-only quantity', () => {
  it('CompactRow', () => {
    const html = renderToStaticMarkup(<CompactRow {...card} />)
    expect(html).not.toMatch(QUANTITY_BUTTON)
    expect(html).toContain('×3')
  })

  it('CompactRow puts FOIL after the condition, off the name line', () => {
    const html = renderToStaticMarkup(<CompactRow {...card} isFoil available={1} />)
    const text = html.replace(/<[^>]+>/g, '')
    expect(text).toContain('MMQ #58 · HP · FOIL · 1 available')
    expect(text).not.toContain('Aerial CaravanFOIL')
  })

  it('CardRow', () => {
    const html = renderToStaticMarkup(<CardRow {...card} />)
    expect(html).not.toMatch(QUANTITY_BUTTON)
    expect(html).toContain('×3')
  })

  it('DeckCardRow keeps its zones and trash, without a counter', () => {
    const html = renderToStaticMarkup(
      <DeckCardRow
        thumbUrl={card.thumbUrl}
        name={card.name}
        manaCost={card.manaCost}
        setLine="MMQ #58"
        qty={3}
        zone="main"
        onZoneChange={() => {}}
        onRemove={() => {}}
        onOpen={() => {}}
      />,
    )
    expect(html).not.toMatch(QUANTITY_BUTTON)
    expect(html).toContain('×3')
    expect(html).toContain('aria-label="Remove Aerial Caravan"')
    expect(html).toContain('>Side</button>')
  })
})
