// Vérifications de rendu de l'étagère de dossier, mesurées dans Chromium
// contre la feuille Tailwind compilée — même harnais que
// `tests/unit/row-heights.test.tsx` : les composants réels sont rendus par
// `react-dom/server`, jamais un balisage recopié à la main.
//
// Le rendu de `folder-shelf.tsx` ne doit contenir aucun formatage
// monétaire. C'est vérifié ici sur le rendu réel de l'en-tête, avec des
// cartes qui portent, elles, un prix — un test qui rendrait l'étagère sans
// carte passerait même si l'en-tête agrégeait une valeur.
import { chromium, type Browser, type Page } from '@playwright/test'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DeckCard } from '@/components/decks/deck-card'
import { FolderShelf } from '@/components/decks/folder-shelf'
import type { DeckCardData } from '@/app/(app)/decks/folders-data'

import { compileTailwindCss } from '../utils/tailwind-css'

let browser: Browser
let css: string

beforeAll(async () => {
  browser = await chromium.launch()
  css = await compileTailwindCss()
}, 60_000)

afterAll(async () => {
  await browser.close()
})

const DECKS: DeckCardData[] = [
  {
    id: 'deck-1',
    name: 'Atraxa Superfriends',
    artUrl: null,
    coverGradient: null,
    colorIdentity: ['W', 'U', 'B', 'G'],
    priceMinor: 68_400,
    status: { kind: 'needsWork', label: '36 short', issues: [] },
    formatRaw: 'commander',
    cardCount: 64,
  },
  {
    id: 'deck-2',
    name: 'Ur-Dragon Tribal',
    artUrl: null,
    coverGradient: null,
    colorIdentity: ['R'],
    priceMinor: 41_300,
    status: { kind: 'legal', label: 'Legal for Commander', issues: [] },
    formatRaw: 'commander',
    cardCount: 100,
  },
]

function shelfHtml(options: { name: string; unsorted: boolean; seeAllHref: string | null }): string {
  return renderToStaticMarkup(
    <FolderShelf
      name={options.name}
      deckCount={2}
      seeAllHref={options.seeAllHref}
      unsorted={options.unsorted}
      onNewDeck={() => {}}
    >
      {DECKS.map((deck) => (
        <DeckCard key={deck.id} deck={deck} currency="usd" />
      ))}
    </FolderShelf>,
  )
}

async function pageWithBody(bodyHtml: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${bodyHtml}</body></html>`)
  return page
}

describe('FolderShelf', () => {
  it('shows no monetary amount in the shelf header, while its cards do carry a price', async () => {
    const page = await pageWithBody(
      shelfHtml({ name: 'Commander', unsorted: false, seeAllHref: '/decks/folders/folder-1' }),
    )

    const headerText = await page.locator('[data-folder-header]').innerText()
    expect(headerText).not.toMatch(/[$€]/)
    // Le compteur de l'en-tête est un nombre de decks.
    expect(headerText).toContain('2')

    // La garde ne passe pas par vacuité : les cartes, elles, portent bien un
    // montant formaté.
    const trackText = await page.getByRole('group', { name: 'Commander decks' }).innerText()
    expect(trackText).toMatch(/\$684\.00/)

    await page.close()
  })

  it('hides See all when the href is null and keeps the Unsorted header in its own muted colour', async () => {
    const withFolder = await pageWithBody(
      shelfHtml({ name: 'Commander', unsorted: false, seeAllHref: '/decks/folders/folder-1' }),
    )
    // `expect` est celui de Vitest ici (pas celui de Playwright) : le
    // compte se lit sur le locator, il ne se matche pas.
    expect(await withFolder.getByRole('link', { name: 'See all' }).count()).toBe(1)
    const folderNameColour = await withFolder
      .locator('[data-folder-header] span')
      .first()
      .evaluate((node) => getComputedStyle(node).color)
    await withFolder.close()

    const unsorted = await pageWithBody(shelfHtml({ name: 'Unsorted', unsorted: true, seeAllHref: null }))
    expect(await unsorted.getByRole('link', { name: 'See all' }).count()).toBe(0)
    const unsortedColour = await unsorted
      .locator('[data-folder-header] span')
      .first()
      .evaluate((node) => getComputedStyle(node).color)

    // `--color-folder-unsorted` (#b3bccb), distinct de la couleur de titre
    // d'un dossier nommé.
    expect(unsortedColour).toBe('rgb(179, 188, 203)')
    expect(unsortedColour).not.toBe(folderNameColour)

    await unsorted.close()
  })

  // Aucun glisser-déposer sur l'onglet `Decks` : ni l'en-tête ni la tuile ne
  // retiennent le geste vertical, le navigateur le garde pour le défilement
  // de page. Mesuré sur le style calculé, dans Chromium, contre la feuille
  // compilée.
  it('leaves vertical scrolling to the browser on headers and tiles', async () => {
    for (const unsorted of [false, true]) {
      const page = await pageWithBody(
        shelfHtml({
          name: unsorted ? 'Unsorted' : 'Commander',
          unsorted,
          seeAllHref: unsorted ? null : '/decks/folders/folder-1',
        }),
      )
      const touchActions = await page
        .locator('[data-folder-header], a[data-deck-id]')
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).touchAction))
      expect(touchActions.length).toBeGreaterThan(1)
      for (const value of touchActions) expect(value).toBe('auto')
      await page.close()
    }
  })

  it('sizes the New deck tile like a deck card, so an empty shelf keeps the shelf geometry', async () => {
    const page = await pageWithBody(shelfHtml({ name: 'Commander', unsorted: false, seeAllHref: null }))

    const tile = await page
      .getByRole('button', { name: 'New deck' })
      .evaluate((node) => node.getBoundingClientRect())
    const card = await page
      .locator('a[data-deck-id]')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)

    expect(tile.width).toBe(152)
    // Étirée par la piste dans une étagère peuplée, jamais plus courte que
    // `--height-deck-card` dans une étagère vide.
    expect(tile.height).toBe(card)
    expect(tile.height).toBeGreaterThanOrEqual(177)

    await page.close()
  })
})
