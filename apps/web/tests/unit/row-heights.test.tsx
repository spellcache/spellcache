// Mesure réelle des hauteurs de ligne et des zones cliquables (sur dix lignes
// consécutives dont une au nom très long et une avec badge FOIL ; zone
// cliquable vérifiée par sa boîte englobante) — rend les composants réels
// (`react-dom/server`) contre la feuille Tailwind compilée du projet
// (`tests/utils/tailwind-css.ts`) dans le Chromium fourni par
// `@playwright/test`, puis lit `getBoundingClientRect()`. Un calcul à la main
// (padding + vignette + bordure) a précédemment produit un écart de 13.5px
// sur `CardRow` à cause d'un
// gonflement de `line-height` invisible à l'arithmétique — cette mesure ne
// se laisse pas tromper de la même façon.
//
// `tests/unit/**/*.test.ts` (vitest.config.ts, environnement `node`) : ce
// fichier ne dépend pas de jsdom (le rendu JSX passe par
// `react-dom/server`, sans DOM), seulement du Chromium déjà provisionné pour
// `tests/e2e/` (`@playwright/test`, déjà une devDependency).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type Page } from '@playwright/test'
import { HeartPulse } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CardEditControls } from '@/components/cards/card-edit-controls'
import { DeckCard } from '@/components/decks/deck-card'
import { PreviewPane } from '@/components/desktop/preview-pane'
import type { CardPreview } from '@/components/desktop/preview-pane-data'
import { Sidebar } from '@/components/desktop/sidebar'
import { CardRow } from '@/components/cards/card-row'
import { CompactRow } from '@/components/cards/compact-row'
import { GridTile, GridTileShelf } from '@/components/cards/grid-tile'
import { MiniTile } from '@/components/collection/mini-tile'
import { SlotRow } from '@/components/decks/slot-row'
import { LifeTracker } from '@/app/(app)/tools/life/life-tracker'
import { AppTile } from '@/components/tools/app-tile'
import { LifePad } from '@/components/tools/life-pad'
import { PlannedToolRow } from '@/components/settings/planned-tool-row'
import { StylePicker } from '@/components/settings/style-picker'
import { LifeGameScreen } from '@/components/tools/life-game'
import { Switch } from '@/components/ui/switch'

import type { HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

import { compileTailwindCss } from '../utils/tailwind-css'

const NAMES = [
  'Ponder',
  'Rhystic Study',
  'The Absolutely Longest Card Name In The Entire Multiverse Of Magic Cards Ever Printed',
  'Cyclonic Rift',
  'Sol Ring',
  'Demonic Tutor',
  'Mana Crypt',
  'Lightning Bolt',
  'Counterspell',
  'Birds of Paradise',
]

const FAKE_THUMB = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='

let browser: Browser
let css: string

beforeAll(async () => {
  browser = await chromium.launch()
  css = await compileTailwindCss()
}, 60_000)

afterAll(async () => {
  await browser.close()
})

async function pageWithBody(bodyHtml: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 420, height: 1600 } })
  await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${bodyHtml}</body></html>`)
  return page
}

describe('CompactRow height and touch targets', () => {
  it('measures exactly 58px over ten consecutive rows, including a long name and a FOIL row', async () => {
    const rowsHtml = NAMES.map((name, i) =>
      renderToStaticMarkup(
        <CompactRow
          holdingId={`h${i}`}
          thumbUrl={FAKE_THUMB}
          name={name}
          manaCost="{2}{W}{U}"
          setCode="pcy"
          collectorNumber="45"
          condition="nm"
          isFoil={i === 2}
          qty={i + 1}
          priceLabel="$12.34"
          onQtyChange={() => {}}
          onOpen={() => {}}
        />,
      ),
    )
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">${rowsHtml
        .map((html) => `<div class="row">${html}</div>`)
        .join('')}</div>`,
    )

    const heights = await page
      .locator('.row > div')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights).toHaveLength(10)
    for (const height of heights) expect(height).toBe(58)

    // Boîte englobante de la zone cliquable des boutons `+`/`−`, pas leur
    // taille visuelle de 22px.
    const touchBoxes = await page
      .locator('.row')
      .first()
      .locator('button[aria-label]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        }),
      )
    expect(touchBoxes).toHaveLength(2)
    for (const box of touchBoxes) {
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }

    await page.close()
  })
})

// `SlotRow` mirrors `CompactRow`'s proven 58px formula (padding 7px/10px,
// thumbnail 30x42, `gap-10`) — measured, not assumed identical, same
// discipline as the rest of this file.
describe('SlotRow', () => {
  it('measures exactly 58px over ten consecutive rows, owned and missing alike', async () => {
    const rowsHtml = NAMES.map((name, i) =>
      renderToStaticMarkup(
        <SlotRow
          thumbUrl={FAKE_THUMB}
          name={name}
          manaCost="{2}{W}{U}"
          setLine={`PCY #${45 + i} · owned ×1`}
          need={i + 1}
          state={i % 2 === 0 ? 'owned' : 'missing'}
          priceLabel="$12.34"
        />,
      ),
    )
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">${rowsHtml
        .map((html) => `<div class="row">${html}</div>`)
        .join('')}</div>`,
    )

    const heights = await page
      .locator('.row > div')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights).toHaveLength(10)
    for (const height of heights) expect(height).toBe(58)

    await page.close()
  })

  // Distingue visuellement `owned` de `missing` — bordure et couleur de
  // statut, pas seulement le libellé.
  it('renders a distinct border and status colour for owned vs missing', async () => {
    const ownedHtml = renderToStaticMarkup(
      <SlotRow
        thumbUrl={FAKE_THUMB}
        name="Doubling Season"
        manaCost="{5}{G}"
        setLine="RVR #170 · owned ×1"
        need={1}
        state="owned"
        priceLabel="$42.00"
      />,
    )
    const missingHtml = renderToStaticMarkup(
      <SlotRow
        thumbUrl={FAKE_THUMB}
        name="Wrath of God"
        manaCost="{2}{W}{W}"
        setLine="DMR #34 · not owned"
        need={1}
        state="missing"
        priceLabel="$8.90"
      />,
    )
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">
         <div class="owned">${ownedHtml}</div>
         <div class="missing">${missingHtml}</div>
       </div>`,
    )

    const ownedBorder = await page
      .locator('.owned > div')
      .first()
      .evaluate((node) => getComputedStyle(node).borderColor)
    const missingBorder = await page
      .locator('.missing > div')
      .first()
      .evaluate((node) => getComputedStyle(node).borderColor)
    expect(ownedBorder).not.toBe(missingBorder)

    await page.close()
  })
})

// La ligne `rows` n'a plus de hauteur forcée ni de compensation
// d'interligne : comme le design validé, elle vaut bordure 2px + padding 10px×2 +
// la plus haute de ses deux colonnes — la vignette 61px ou la colonne de
// texte. Avec Inter, cette colonne mesure ~57px, donc la vignette l'emporte
// et la ligne vaut 83px (`ROW_HEIGHT.rows`). Ce banc-là ne charge aucune
// police (la feuille compilée pointe `var(--font-inter)`, indéfinie hors de
// Next), ses métriques de repli donnent une colonne un peu plus haute : la
// mesure est donc écrite en formule plutôt qu'en constante, sinon elle
// n'affirmerait que le repli du banc.
describe('CardRow (ROW_HEIGHT.rows contract)', () => {
  it('adds up to border + padding + tallest column over ten consecutive rows, thumbnail restored to 44x61', async () => {
    const rowsHtml = NAMES.map((name, i) =>
      renderToStaticMarkup(
        <CardRow
          thumbUrl={FAKE_THUMB}
          name={name}
          manaCost="{2}{W}{U}"
          setCode="pcy"
          collectorNumber="45"
          condition="nm"
          isFoil={i === 2}
          qty={i + 1}
          priceLabel="$12.34"
          onOpen={() => {}}
        />,
      ),
    )
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">${rowsHtml
        .map((html) => `<div class="row">${html}</div>`)
        .join('')}</div>`,
    )

    const measured = await page.locator('.row > button').evaluateAll((nodes) =>
      nodes.map((node) => {
        const column = node.children[1] as HTMLElement
        return {
          height: node.getBoundingClientRect().height,
          column: column.getBoundingClientRect().height,
        }
      }),
    )
    expect(measured).toHaveLength(10)
    for (const { height, column } of measured) {
      expect(height).toBe(2 + 20 + Math.max(61, column))
    }
    // Toutes identiques : c'est ce que le virtualiseur suppose, quel que
    // soit le nom de la carte ou la présence du badge FOIL.
    expect(new Set(measured.map((row) => row.height)).size).toBe(1)

    const thumbBox = await page
      .locator('.row')
      .first()
      .locator('img')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(thumbBox).toEqual({ width: 44, height: 61 })

    await page.close()
  })
})

// Régression : la hauteur de `GridTile` dépendait du ratio
// intrinsèque du SVG de set (`width`/`height` posés en attributs HTML,
// battus par `img { height: auto }` du preflight Tailwind) au lieu d'être
// forcée en CSS — le pied gonflait de 21 à 26px selon le set, et la tuile de
// 230.1875 à 235.1875px à largeur fixe, alors que le virtualiseur ne calcule
// qu'une seule hauteur par largeur (`components/cards/virtual-list.tsx`).
// Ces `viewBox` reproduisent les ratios réels de quatre sets Scryfall : `lea`
// carré (1024×1024), `pcy` presque carré mais pas tout à fait (896×1024),
// `mh2` très large (17×11) et `neo` large modéré (195×95) — un seul set carré
// suffit à cacher le défaut.
const SET_ICON_VIEWBOXES: Record<string, string> = {
  lea: '0 0 1024 1024',
  pcy: '0 0 896 1024',
  mh2: '0 0 17 11',
  neo: '0 0 195 95',
}

async function pageWithGridTile(tileWidth: number, setCode: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 1600 } })
  // Intercepte l'icône de set (URL du catalogue, au format de Scryfall) pour
  // lui faire porter un `viewBox` choisi plutôt que de dépendre d'un accès
  // réseau réel pendant les tests.
  await page.route('https://svgs.scryfall.io/sets/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SET_ICON_VIEWBOXES[setCode]}"><rect width="100%" height="100%"/></svg>`,
    })
  })
  const html = renderToStaticMarkup(
    <GridTile
      thumbUrl={FAKE_THUMB}
      setCode={setCode}
      setIconUri={`https://svgs.scryfall.io/sets/${setCode}.svg?1700000000`}
      collectorNumber="45"
      isFoil={false}
      qty={1}
      priceLabel="$1.00"
      onOpen={() => {}}
    />,
  )
  await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
    <div style="width:${tileWidth}px">${html}</div>
  </body></html>`)
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))
  return page
}

describe('GridTile (grid tile height, one measurement per width regardless of set icon ratio)', () => {
  for (const tileWidth of [120, 150]) {
    it(`measures the same tile height at ${tileWidth}px wide across set icons of differing viewBox ratios`, async () => {
      const heights: Record<string, number> = {}
      for (const setCode of Object.keys(SET_ICON_VIEWBOXES)) {
        const page = await pageWithGridTile(tileWidth, setCode)
        heights[setCode] = await page
          .locator('button')
          .first()
          .evaluate((node) => node.getBoundingClientRect().height)
        await page.close()
      }
      const distinctHeights = new Set(Object.values(heights))
      expect(distinctHeights.size).toBe(1)
    })
  }
})

// Régression : `VirtualList` bascule la sélection quelle que soit
// la densité (`SelectableItem` enveloppe toutes les rangées,
// `components/cards/virtual-list.tsx`), mais seul `CompactRow` recevait
// `selectable`/`selected` avant ce correctif — les densités `rows`/`grid`
// entraient en sélection sans qu'aucune ligne ne le montre. Ce
// bloc mesure que `selectable`/`selected` ne changent la géométrie d'aucune
// des trois densités — la case ronde 18px de `CompactRow`/`CardRow`
// s'ajoute au flux (thumbnail 61px/54px reste le facteur dimensionnant, très
// au-dessus des 18px de la case), celle de `GridTile` est en surimpression
// `absolute`, jamais dans le flux qui détermine `GRID_FOOTER_HEIGHT` (même
// contrainte que le pied de tuile, `mf-grid-tile.tsx`).
describe('selection state leaves row/tile height untouched', () => {
  it('CompactRow stays 58px selectable and selected, with an 18x18 circle', async () => {
    const html = renderToStaticMarkup(
      <CompactRow
        holdingId="h0"
        thumbUrl={FAKE_THUMB}
        name="Ponder"
        manaCost="{U}"
        setCode="thb"
        collectorNumber="59"
        condition="nm"
        isFoil={false}
        qty={2}
        priceLabel="$0.60"
        onQtyChange={() => {}}
        onOpen={() => {}}
        selectable
        selected
      />,
    )
    const page = await pageWithBody(`<div style="width:390px">${html}</div>`)

    const height = await page
      .locator('div[role="button"]')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)
    expect(height).toBe(58)

    const circle = await page
      .locator('span[aria-hidden="true"]')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(circle).toEqual({ width: 18, height: 18 })

    await page.close()
  })

  it('CardRow keeps its height selectable and selected', async () => {
    const html = renderToStaticMarkup(
      <CardRow
        thumbUrl={FAKE_THUMB}
        name="Ponder"
        manaCost="{U}"
        setCode="thb"
        collectorNumber="59"
        condition="nm"
        isFoil={false}
        qty={2}
        priceLabel="$0.60"
        onOpen={() => {}}
        selectable
        selected
      />,
    )
    const page = await pageWithBody(`<div style="width:390px">${html}</div>`)

    const height = await page.locator('button').first().evaluate((node) => {
      const column = node.children[2] as HTMLElement
      return {
        row: node.getBoundingClientRect().height,
        column: column.getBoundingClientRect().height,
      }
    })
    expect(height.row).toBe(2 + 20 + Math.max(61, height.column))

    const circle = await page
      .locator('span[aria-hidden="true"]')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(circle).toEqual({ width: 18, height: 18 })

    await page.close()
  })

  it('GridTile keeps the same formula height selectable and selected, at 150px wide', async () => {
    const plainPage = await pageWithGridTile(150, 'lea')
    const plainHeight = await plainPage
      .locator('button')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)
    await plainPage.close()

    const page = await browser.newPage({ viewport: { width: 800, height: 1600 } })
    await page.route('https://svgs.scryfall.io/sets/**', async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SET_ICON_VIEWBOXES.lea}"><rect width="100%" height="100%"/></svg>`,
      })
    })
    const html = renderToStaticMarkup(
      <GridTile
        thumbUrl={FAKE_THUMB}
        setCode="lea"
        setIconUri="https://svgs.scryfall.io/sets/lea.svg?1700000000"
        collectorNumber="45"
        isFoil={false}
        qty={1}
        priceLabel="$1.00"
        onOpen={() => {}}
        selectable
        selected
      />,
    )
    await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
      <div style="width:150px">${html}</div>
    </body></html>`)
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))

    const height = await page.locator('button').first().evaluate((node) => node.getBoundingClientRect().height)
    expect(height).toBe(plainHeight)

    const circle = await page
      .locator('span[aria-hidden="true"]')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(circle).toEqual({ width: 18, height: 18 })

    await page.close()
  })
})

// Régression : la ligne **courante** du panneau d'aperçu et une ligne
// **sélectionnée** sont deux états distincts. Le design validé dessine la
// ligne courante surlignée mais non sélectionnable : fond `#161d2e` et
// bordure `rgba(61,123,255,0.55)`, aucune case donc aucune coche. Ce bloc
// mesure les deux traitements sur le rendu compilé, et compte les coches :
// une ligne `current` n'en porte jamais, quelle que soit la densité.
describe('current pane row is highlighted but never ticked', () => {
  const SELECTED_BG = 'rgb(34, 28, 18)'
  const SELECTED_BORDER = 'rgba(232, 180, 74, 0.55)'

  function compactRow(props: { selectable?: boolean; selected?: boolean; current?: boolean }) {
    return renderToStaticMarkup(
      <CompactRow
        holdingId="h0"
        thumbUrl={FAKE_THUMB}
        name="Ponder"
        manaCost="{U}"
        setCode="thb"
        collectorNumber="59"
        condition="nm"
        isFoil={false}
        qty={1}
        priceLabel="$0.60"
        onQtyChange={() => {}}
        onOpen={() => {}}
        {...props}
      />,
    )
  }

  it('paints a current row with the design background and border, and no tick', async () => {
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">
         <div class="row">${compactRow({ current: true })}</div>
         <div class="row">${compactRow({})}</div>
       </div>`,
    )

    const styles = await page.locator('.row > div').evaluateAll((nodes) =>
      nodes.map((node) => {
        const computed = getComputedStyle(node)
        return { background: computed.backgroundColor, border: computed.borderTopColor }
      }),
    )
    expect(styles[0]).toEqual({ background: SELECTED_BG, border: SELECTED_BORDER })
    expect(styles[1]?.background).not.toBe(SELECTED_BG)

    // Aucune case ronde n'est rendue hors sélection : donc aucune coche.
    // Sélecteur d'enfant direct — `ManaCost` rend lui aussi des `span`
    // `aria-hidden`, plus bas dans la ligne.
    expect(await page.locator('.row > div > span[aria-hidden="true"]').count()).toBe(0)
    await page.close()
  })

  it('ticks the selected row only — one tick for one selected row among three', async () => {
    const page = await pageWithBody(
      `<div style="width:390px;display:flex;flex-direction:column;gap:6px">
         <div class="row">${compactRow({ selectable: true, selected: true })}</div>
         <div class="row">${compactRow({ selectable: true, current: true })}</div>
         <div class="row">${compactRow({ selectable: true })}</div>
       </div>`,
    )

    // Trois cases rondes, une seule coche — le compteur `N selected` et le
    // nombre de coches disent la même chose.
    expect(await page.locator('.row > div > span[aria-hidden="true"]').count()).toBe(3)
    expect(await page.locator('.row > div > span[aria-hidden="true"] svg').count()).toBe(1)

    const heights = await page
      .locator('.row > div')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    for (const height of heights) expect(height).toBe(58)

    await page.close()
  })
})

// Mesure réelle des tuiles d'illustration pure de l'accueil Shelves : même
// patron que les blocs ci-dessus, le rendu compilé plutôt qu'un calcul à la
// main (`--spacing: initial` — un pas non déclaré émettrait
// silencieusement 0 classe).
describe('MiniTile', () => {
  it('measures exactly 76x106, whatever the underlying image ratio', async () => {
    const html = renderToStaticMarkup(
      <MiniTile artUrl={FAKE_THUMB} name="Doubling Season" onOpen={() => {}} />,
    )
    // Devenue un `<button>` : `.slot > button` doit atteindre la seule racine
    // rendue, exactement comme `.slot > button` le fait pour
    // `GridTileShelf` ci-dessous — même piège que ce bloc avant que la
    // tuile ne devienne interactive (un wrapper `<div>` capturé par
    // `.first()` mesurerait la largeur du conteneur de test, pas de la
    // tuile).
    const page = await pageWithBody(`<span class="slot" style="display:flex;gap:8px">${html}</span>`)
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))

    const box = await page
      .locator('.slot > button')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(box).toEqual({ width: 76, height: 106 })

    await page.close()
  })

  // Régression : `loading` n'était posé sur aucune image
  // de l'écran Shelves. `lazy` pilote l'attribut réellement rendu, dans les
  // deux sens — pas seulement sa présence par défaut.
  it('wires the loading attribute from the lazy prop, eager by default', async () => {
    const eagerHtml = renderToStaticMarkup(<MiniTile artUrl={FAKE_THUMB} name="Ponder" onOpen={() => {}} />)
    const lazyHtml = renderToStaticMarkup(
      <MiniTile artUrl={FAKE_THUMB} name="Ponder" onOpen={() => {}} lazy />,
    )
    expect(eagerHtml).toContain('loading="eager"')
    expect(lazyHtml).toContain('loading="lazy"')
  })

  // Régression : la tuile `Recently added`
  // était un `<div>` inerte — ni `onClick`, ni `role`, ni `tabindex`, aucun
  // élément interactif, contrairement aux 8 tuiles visuellement identiques
  // de chaque étagère en dessous. Même garantie que
  // `GridTileShelf`ci-dessous : un vrai `<button type="button">` est
  // nativement atteignable au clavier (`Tab`, `Enter`/`Espace`) sans
  // `tabindex` ni `role` ajoutés à la main, et répond au clic.
  it('is a real button — keyboard-reachable and clickable, not a bare div', async () => {
    const html = renderToStaticMarkup(<MiniTile artUrl={FAKE_THUMB} name="Ponder" onOpen={() => {}} />)
    expect(html).toMatch(/^<button type="button"/)
    expect(html).not.toMatch(/^<div/)

    const page = await pageWithBody(`<span class="slot" style="display:flex;gap:8px">${html}</span>`)
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))

    let clicked = false
    await page.exposeFunction('__onMiniTileOpen', () => {
      clicked = true
    })
    await page.locator('.slot > button').first().evaluate((node) => {
      node.addEventListener('click', () => (window as unknown as { __onMiniTileOpen: () => void }).__onMiniTileOpen())
    })
    await page.locator('.slot > button').first().focus()
    const isFocused = await page
      .locator('.slot > button')
      .first()
      .evaluate((node) => node === document.activeElement)
    expect(isFocused).toBe(true)

    await page.locator('.slot > button').first().click()
    expect(clicked).toBe(true)

    await page.close()
  })
})

describe('GridTileShelf (fixed tile width, scroll-snap, tap target)', () => {
  it('measures 66px wide with a 5/7 height derived from --aspect-card, and carries scroll-snap-align: start', async () => {
    const html = renderToStaticMarkup(
      <GridTileShelf artUrl={FAKE_THUMB} name="Rhystic Study" onOpen={() => {}} />,
    )
    // Devenue un `<button>` :
    // `.slot > button` doit atteindre la seule racine rendue, exactement
    // comme `.slot > div` le faisait avant que la tuile ne devienne
    // interactive — même piège que `MiniTile` ci-dessus.
    const page = await pageWithBody(`<span class="slot" style="display:flex;gap:8px">${html}</span>`)
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))

    const box = await page
      .locator('.slot > button')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    // 66 * (7 / 5) = 92.4 — `--aspect-card`, pas une hauteur en dur.
    // Chromium arrondit `aspect-ratio` au sous-pixel (92.390625 mesuré) :
    // `toBeCloseTo` plutôt qu'une égalité stricte, comme le ratio lui-même
    // l'exige (cette hauteur n'a jamais été fixée en dur non plus). Confirme
    // que devenir un `<button>` (reset universel `*` du preflight Tailwind,
    // `margin/padding/border: 0`) n'a pas gonflé la boîte — même garantie
    // que `GridTile`, déjà un `<button>`, ci-dessus.
    expect(box.width).toBe(66)
    expect(box.height).toBeCloseTo(92.4, 0)

    const snapAlign = await page
      .locator('.slot > button')
      .first()
      .evaluate((node) => getComputedStyle(node).scrollSnapAlign)
    expect(snapAlign).toBe('start')

    await page.close()
  })

  // Régression : les tuiles d'étagère étaient des `<div>`
  // inertes — ni `onClick`, ni `role`, ni `tabindex`, aucun élément
  // interactif. Un vrai `<button type="button">` est nativement atteignable
  // au clavier (`Tab`, `Enter`/`Espace`) sans `tabindex` ni `role` ajoutés à
  // la main, et répond au clic.
  it('is a real button — keyboard-reachable and clickable, not a bare div', async () => {
    const html = renderToStaticMarkup(
      <GridTileShelf artUrl={FAKE_THUMB} name="Rhystic Study" onOpen={() => {}} />,
    )
    expect(html).toMatch(/^<button type="button"/)
    expect(html).not.toMatch(/^<div/)

    const page = await pageWithBody(`<span class="slot" style="display:flex;gap:8px">${html}</span>`)
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete))

    let clicked = false
    await page.exposeFunction('__onTileOpen', () => {
      clicked = true
    })
    await page.locator('.slot > button').first().evaluate((node) => {
      node.addEventListener('click', () => (window as unknown as { __onTileOpen: () => void }).__onTileOpen())
    })
    await page.locator('.slot > button').first().focus()
    const isFocused = await page
      .locator('.slot > button')
      .first()
      .evaluate((node) => node === document.activeElement)
    expect(isFocused).toBe(true)

    await page.locator('.slot > button').first().click()
    expect(clicked).toBe(true)

    await page.close()
  })

  // Régression : mêmes garanties que `MiniTile`
  // ci-dessus pour la piste d'étagère.
  it('wires the loading attribute from the lazy prop, eager by default', async () => {
    const eagerHtml = renderToStaticMarkup(
      <GridTileShelf artUrl={FAKE_THUMB} name="Ponder" onOpen={() => {}} />,
    )
    const lazyHtml = renderToStaticMarkup(
      <GridTileShelf artUrl={FAKE_THUMB} name="Ponder" onOpen={() => {}} lazy />,
    )
    expect(eagerHtml).toContain('loading="eager"')
    expect(lazyHtml).toContain('loading="lazy"')
  })
})

// Régression : masquer la barre de défilement doit rester compatible
// clavier. `.scrollbar-hide` (`app/globals.css`) retire la
// barre visible sans retirer `overflow-x`/le défilement lui-même — vérifié
// via la valeur calculée `scrollbar-width`, pas seulement la présence de la
// classe dans le DOM.
describe('Shelf track (no visible scrollbar, x-proximity snap)', () => {
  it('applies scroll-snap-type: x and scrollbar-width: none to the track', async () => {
    const page = await pageWithBody(
      `<div class="scrollbar-hide flex snap-x snap-proximity gap-8 overflow-x-auto" style="width:200px" tabindex="0"></div>`,
    )
    const style = await page.locator('div').first().evaluate((node) => {
      const computed = getComputedStyle(node)
      return { scrollSnapType: computed.scrollSnapType, scrollbarWidth: computed.scrollbarWidth }
    })
    // Chromium sérialise `scroll-snap-type: x proximity` en `x` seul :
    // `proximity` est la stricte valeur par défaut de l'axe quand elle est
    // omise (spec CSS Scroll Snap), le calculé l'omet donc à la sérialisation
    // — vérifié empiriquement contre le Chromium fourni par `@playwright/
    // test`, pas supposé. `snap-x`/`snap-proximity` (Tailwind 4, statiques,
    // hors `@theme`) posent malgré tout la bonne valeur : `mandatory`
    // sérialiserait `x mandatory`, jamais `x` seul.
    expect(style.scrollSnapType).toBe('x')
    expect(style.scrollbarWidth).toBe('none')

    await page.close()
  })
})

// Régression potentielle : les interrupteurs mesurent 44×26 px avec une
// poignée de 20px — mesurée, pas calculée à la main, même piège que le reste
// de ce fichier (un `line-height` de preflight avait gonflé une boîte de
// 13.5px à l'arithmétique invisible).
describe('Switch (44×26 track, 20px handle)', () => {
  it('measures a 44×26 track and a 20×20 handle, on and off', async () => {
    const offHtml = renderToStaticMarkup(<Switch checked={false} onChange={() => {}} label="Prices on card art" />)
    const onHtml = renderToStaticMarkup(<Switch checked onChange={() => {}} label="Prices on card art" />)

    const page = await pageWithBody(
      `<div style="display:flex;flex-direction:column;gap:8px">
         <span class="off">${offHtml}</span>
         <span class="on">${onHtml}</span>
       </div>`,
    )

    const offBox = await page.locator('.off > button').first().evaluate((node) => {
      const track = node.getBoundingClientRect()
      const knob = node.firstElementChild!.getBoundingClientRect()
      return { track: { width: track.width, height: track.height }, knob: { width: knob.width, height: knob.height } }
    })
    const onBox = await page.locator('.on > button').first().evaluate((node) => {
      const track = node.getBoundingClientRect()
      const knob = node.firstElementChild!.getBoundingClientRect()
      return { track: { width: track.width, height: track.height }, knob: { width: knob.width, height: knob.height } }
    })

    expect(offBox.track).toEqual({ width: 44, height: 26 })
    expect(offBox.knob).toEqual({ width: 20, height: 20 })
    expect(onBox.track).toEqual({ width: 44, height: 26 })
    expect(onBox.knob).toEqual({ width: 20, height: 20 })

    // La poignée bascule bord à bord de la piste selon `checked` (poignée à
    // gauche à l'état inactif, à droite à l'état actif) — vérifié
    // par la position réelle de la poignée dans la piste, pas seulement par
    // la classe `justify-*` posée.
    const offKnobLeft = await page
      .locator('.off > button')
      .first()
      .evaluate((node) => node.firstElementChild!.getBoundingClientRect().left - node.getBoundingClientRect().left)
    const onKnobLeft = await page
      .locator('.on > button')
      .first()
      .evaluate((node) => node.firstElementChild!.getBoundingClientRect().left - node.getBoundingClientRect().left)
    expect(offKnobLeft).toBeCloseTo(3, 0)
    expect(onKnobLeft).toBeCloseTo(21, 0)

    await page.close()
  })

  it('is a real switch — role="switch" with aria-checked reflecting state', () => {
    const offHtml = renderToStaticMarkup(<Switch checked={false} onChange={() => {}} label="Prices on card art" />)
    const onHtml = renderToStaticMarkup(<Switch checked onChange={() => {}} label="Prices on card art" />)
    expect(offHtml).toContain('role="switch"')
    expect(offHtml).toContain('aria-checked="false"')
    expect(onHtml).toContain('aria-checked="true"')
  })
})

// Régression potentielle : le sélecteur `Decks home` réutilise le composant
// `StylePicker`, et les deux lignes produisent un balisage identique au
// libellé et à la valeur près. Rendu statique comparé après avoir effacé les
// deux seules variables autorisées à différer — pas un rendu visuel, une
// comparaison de structure DOM.
describe('StylePicker (identical markup across both rows)', () => {
  function normalize(html: string, label: string, hint: string): string {
    return html.split(label).join('__LABEL__').split(hint).join('__HINT__')
  }

  it('renders identical markup for Collection home and Decks home at the same value', () => {
    const collectionHtml = renderToStaticMarkup(
      <StylePicker
        label="Collection home"
        hint="How the Collection tab lists your binders"
        value="compact"
        onChange={() => {}}
      />,
    )
    const decksHtml = renderToStaticMarkup(
      <StylePicker
        label="Decks home"
        hint="How the Decks tab lists your decks"
        value="compact"
        onChange={() => {}}
      />,
    )

    expect(
      normalize(collectionHtml, 'Collection home', 'How the Collection tab lists your binders'),
    ).toBe(normalize(decksHtml, 'Decks home', 'How the Decks tab lists your decks'))
  })

  it('is a group of two accessible radio buttons, not a <select>', () => {
    const html = renderToStaticMarkup(
      <StylePicker label="Collection home" hint="hint" value="shelves" onChange={() => {}} />,
    )
    expect(html).toContain('role="radiogroup"')
    expect((html.match(/role="radio"/g) ?? []).length).toBe(2)
    expect(html).not.toContain('<select')
    // `value="shelves"` : le second bouton (Shelves) porte `aria-checked="true"`,
    // le premier (Compact) `aria-checked="false"` — la sélection suit bien la
    // prop, pas un état interne.
    expect(html).toMatch(/aria-checked="false"[\s\S]*aria-checked="true"/)
  })
})

// Régression : le suffixe `· N available` était concaténé dans la
// sous-ligne sans `truncate` / `whitespace-nowrap`, contrairement au nom de
// carte juste au-dessus qui le porte déjà — un numéro de collection composite
// (bulk Scryfall réel, ex. `PLST #DMR-34`) combiné au suffixe cassait la
// hauteur fixe de 58px (docs/development.md, anti-pattern sur une liste virtualisée).
// Mesuré, pas calculé.
describe('CompactRow with a reserved `available` suffix', () => {
  it('measures exactly 58px even with a composite collector number and a long `available` suffix', async () => {
    const rowsHtml = [
      // Numéro de collection composite réel (bulk Scryfall, `The List` /
      // Secret Lair) — c'est précisément ce cas qui faisait déborder la
      // ligne avant correction : `PLST #DMR-34 · NM · 3 available` mesurait
      // 70.25px à 358px de large.
      { setCode: 'plst', collectorNumber: 'DMR-34', qty: 4, available: 3 },
      { setCode: 'pcy', collectorNumber: '45', qty: 2, available: 1 },
      { setCode: 'lea', collectorNumber: '233', qty: 10, available: 0 },
    ].map((row, i) =>
      renderToStaticMarkup(
        <CompactRow
          holdingId={`h${i}`}
          thumbUrl={FAKE_THUMB}
          name={NAMES[i]!}
          manaCost="{2}{W}{U}"
          setCode={row.setCode}
          collectorNumber={row.collectorNumber}
          condition="nm"
          isFoil={false}
          qty={row.qty}
          available={row.available}
          priceLabel="$12.34"
          onQtyChange={() => {}}
          onOpen={() => {}}
        />,
      ),
    )
    const page = await pageWithBody(
      `<div style="width:358px;display:flex;flex-direction:column;gap:6px">${rowsHtml
        .map((html) => `<div class="row">${html}</div>`)
        .join('')}</div>`,
    )

    const heights = await page
      .locator('.row > div')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights).toHaveLength(3)
    for (const height of heights) expect(height).toBe(58)

    await page.close()
  })
})

// Régression : mesuré contre la feuille compilée dans le Chromium fourni
// par Playwright — la structure ci-dessous reproduit au caractère près les
// classes réelles de `components/ui/sheet.tsx` (`Dialog.Content`,
// `max-h-sheet-assemble`) et du conteneur défilant ajouté à
// `app/(app)/decks/[id]/assemble-sheet.tsx` (`flex min-h-0 flex-1 flex-col
// overflow-y-auto`, pied hors de ce conteneur).
describe('Assemble sheet scroll container', () => {
  function assembleSheetHtml(missingCount: number): string {
    const rowsHtml = Array.from({ length: missingCount }, (_, i) =>
      renderToStaticMarkup(
        <SlotRow
          thumbUrl={FAKE_THUMB}
          name={NAMES[i % NAMES.length]!}
          manaCost="{2}{W}{U}"
          setLine={`DMR #${34 + i} · not owned`}
          need={1}
          state="missing"
          priceLabel="$8.90"
          checkable
          checked={false}
        />,
      ),
    ).join('')

    // Mêmes classes que `Dialog.Content` (`sheet.tsx`) — `position:fixed`
    // n'est valable qu'à l'intérieur d'un document réel, d'où
    // `pageWithBody` plutôt qu'un fragment isolé.
    return `
      <div class="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-card bg-surface-3 px-16 pb-20 pt-16 outline-none max-h-sheet-assemble">
        <div class="mb-16 flex items-center gap-10">
          <div class="min-w-0 flex-1 text-title-sheet font-extrabold tracking-sheet-title text-text">Assemble deck</div>
        </div>
        <div class="scroll-region flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div class="flex flex-col gap-7">${rowsHtml}</div>
        </div>
        <button type="button" class="primary-button flex w-full items-center justify-center gap-8 rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent">
          Assemble with the 0 owned
        </button>
      </div>
    `
  }

  it('keeps the primary button on screen at 23 missing rows, where the un-scrolled layout put it ~960px off screen', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${css}</style></head><body>${assembleSheetHtml(23)}</body></html>`,
    )

    const scrollRegion = await page.locator('.scroll-region').evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }))
    // La liste déborde bien du conteneur défilant (23 lignes à 58px + le
    // reste de la feuille dépassent largement les 812px de
    // `--max-height-sheet-assemble`) — c'est ce débordement que
    // `overflow-y-auto` doit absorber, pas laisser grandir tout le panneau.
    expect(scrollRegion.scrollHeight).toBeGreaterThan(scrollRegion.clientHeight)

    const buttonBox = await page.locator('.primary-button').evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    })
    // Avant correction, mesuré à y≈1801.5 pour un document de 812px — plus de
    // 960px hors écran. Après correction, le bouton reste dans les 844px du
    // viewport sans qu'aucun scroll de document ne soit nécessaire.
    expect(buttonBox.bottom).toBeLessThanOrEqual(844)
    expect(buttonBox.top).toBeGreaterThanOrEqual(0)

    // Le document lui-même ne défile pas — seul `.scroll-region` grandit en
    // interne (`flex:1;min-height:0;overflow:hidden` sur la liste, pied hors
    // de cette boîte).
    const bodyScrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    )
    expect(bodyScrollable).toBe(false)

    await page.close()
  })

  it('still shows the primary button under the ~8-row threshold, without needing internal scroll', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${css}</style></head><body>${assembleSheetHtml(2)}</body></html>`,
    )

    const buttonBox = await page.locator('.primary-button').evaluate((node) => node.getBoundingClientRect())
    expect(buttonBox.bottom).toBeLessThanOrEqual(844)

    await page.close()
  })
})

// La carte de deck de la vue étagères de l'onglet `Decks` : deux mesures
// (152px de large, rayon 18, illustration de 92px de haut à `opacity: .9`)
// et une variante (un deck sans illustration rend le bloc `#101319` avec le
// glyphe `#2f353f`, ou le dégradé d'identité). Mesurées dans Chromium
// contre la feuille compilée, jamais déduites de la liste de classes : le
// preflight Tailwind pose `img { height: auto }`, qui écraserait une hauteur
// posée en attribut HTML, et `line-height: 1.5`, qui gonfle une colonne de
// texte au-delà d'une hauteur déclarée.
describe('DeckCard', () => {
  const ART_DECK = {
    id: 'deck-art',
    name: 'Atraxa Superfriends',
    artUrl: FAKE_THUMB,
    coverGradient: null,
    colorIdentity: ['W', 'U', 'B', 'G'],
    priceMinor: 68_400,
    status: { kind: 'needsWork' as const, label: '36 short', issues: [] },
    formatRaw: 'commander',
    cardCount: 64,
  }
  const GRADIENT_DECK = {
    id: 'deck-gradient',
    name: 'Mono-red burn',
    artUrl: null,
    coverGradient: null,
    colorIdentity: ['R'],
    priceMinor: 14_000,
    status: { kind: 'legal' as const, label: 'Legal for Modern', issues: [] },
    formatRaw: 'modern',
    cardCount: 60,
  }
  const GLYPH_DECK = {
    id: 'deck-glyph',
    name: 'Draft leftovers',
    artUrl: null,
    coverGradient: null,
    colorIdentity: [],
    status: { kind: 'noFormat' as const, label: 'No format set', issues: [] },
    priceMinor: 840,
    formatRaw: null,
    cardCount: 4,
  }

  async function pageWithCards() {
    const html = [ART_DECK, GRADIENT_DECK, GLYPH_DECK]
      .map((deck) => renderToStaticMarkup(<DeckCard deck={deck} currency="usd" />))
      .join('')
    return pageWithBody(`<div style="width:390px;display:flex;gap:10px">${html}</div>`)
  }

  it('measures 152px wide with an 18px radius on all three art variants', async () => {
    const page = await pageWithCards()

    const boxes = await page
      .locator('a[data-deck-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          radius: getComputedStyle(node).borderTopLeftRadius,
        })),
      )
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      expect(box.width).toBe(152)
      expect(box.radius).toBe('18px')
    }

    await page.close()
  })

  it('paints the commander art 92px high at opacity .9, and both fallbacks at the same height', async () => {
    const page = await pageWithCards()

    const art = await page
      .locator('a[data-deck-id="deck-art"] img')
      .first()
      .evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        opacity: getComputedStyle(node).opacity,
        objectFit: getComputedStyle(node).objectFit,
      }))
    expect(art.height).toBe(92)
    expect(art.opacity).toBe('0.9')
    expect(art.objectFit).toBe('cover')

    // Les deux replis occupent exactement la même bande de 92px : une carte
    // sans illustration ne doit pas raccourcir la piste (l'étagère `Unsorted`
    // utilise la même carte que les autres).
    for (const id of ['deck-gradient', 'deck-glyph']) {
      const bandHeight = await page
        .locator(`a[data-deck-id="${id}"] > div`)
        .first()
        .evaluate((node) => node.getBoundingClientRect().height)
      expect(bandHeight).toBe(92)
    }

    // Le repli sans format porte le bloc `#101319` et le glyphe `#2f353f`
    // (`--color-deck-card-art-fallback` / `--color-deck-card-glyph`).
    const glyphBand = await page
      .locator('a[data-deck-id="deck-glyph"] > div')
      .first()
      .evaluate((node) => ({
        background: getComputedStyle(node).backgroundColor,
        color: getComputedStyle(node).color,
      }))
    expect(glyphBand.background).toBe('rgb(16, 19, 25)')
    expect(glyphBand.color).toBe('rgb(47, 53, 63)')

    // Le repli avec format porte le dégradé d'identité, pas le bloc plein.
    const gradientBand = await page
      .locator('a[data-deck-id="deck-gradient"] > div')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundImage)
    expect(gradientBand).toContain('linear-gradient')

    await page.close()
  })

  it('keeps the three cards at one identical height, so a track never staggers', async () => {
    const page = await pageWithCards()

    const heights = await page
      .locator('a[data-deck-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights).toHaveLength(3)
    expect(new Set(heights).size).toBe(1)
    // Valeur relevée par cette même mesure et portée en jeton
    // `--height-deck-card` (app/globals.css), que la tuile pointillée
    // `New deck` consomme en `min-h-deck-card` pour qu'une étagère vide
    // garde la géométrie d'une étagère peuplée.
    expect(heights[0]).toBe(177)

    await page.close()
  })
})

// ---------------------------------------------------------------------------
// Outils de table. Les tuiles `AppTile`, les pastilles mono 17px/800 et
// 15px/800, la rotation des pavés (vérifiée par la transformation CSS
// appliquée) et l'anneau, la lueur et `opacity: 0.45` exacts sont
// mesurés dans Chromium contre la feuille compilée, jamais déduits
// d'une liste de classes — une classe dont le jeton n'existe pas n'émet
// aucune CSS et n'asserte rien (docs/development.md, `--spacing: initial`).
// ---------------------------------------------------------------------------

// Les deux piles de polices sont déclarées en clair dans `@theme`
// (app/globals.css) et ne dépendent plus d'une variable posée par le layout :
// la feuille compilée suffit, ce banc n'a rien à injecter. Ce qui est vérifié
// reste le câblage du jeton — qu'un prix rende bien en `font-mono` et pas en
// police héritée — jamais le fichier de police, qu'aucun des deux ne charge.
const FONT_VARS = ''

const APP_TILES = [
  {
    name: 'Life tracker',
    state: 'on' as const,
    href: '/tools/life',
    description: '2–6 players, starting life per format, and a die roll to pick who goes first.',
  },
  {
    name: 'Trading mode',
    state: 'off' as const,
    tagLabel: 'PLANNED',
    description:
      'Two piles — yours and theirs — with the running value gap and a one-tap swap into both collections.',
  },
  {
    name: 'Card scanner',
    state: 'off' as const,
    tagLabel: 'PLANNED',
    description: 'Point the camera at a card to identify it and add it to a binder or list.',
  },
  {
    name: 'AI assistant',
    state: 'off' as const,
    tagLabel: 'PLANNED',
    description:
      'Ask about your own collection — what to buy next, what a deck is missing, what to trade away.',
  },
]

describe('AppTile', () => {
  async function pageWithTiles() {
    const html = APP_TILES.map((tile) =>
      renderToStaticMarkup(
        <AppTile
          name={tile.name}
          state={tile.state}
          href={tile.href}
          tagLabel={tile.tagLabel}
          icon={<HeartPulse width={21} height={21} strokeWidth={1.75} />}
          description={tile.description}
        />,
      ),
    ).join('')
    // Même largeur utile que l'écran : 390px de device moins `px-16`.
    return pageWithBody(
      `${FONT_VARS}<div id="list" style="width:358px;display:flex;flex-direction:column;gap:11px">${html}</div>`,
    )
  }

  it('keeps the design radius on all four tiles', async () => {
    const page = await pageWithTiles()

    const boxes = await page
      .locator('#list > *')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).borderTopLeftRadius))
    expect(boxes).toHaveLength(4)
    for (const radius of boxes) {
      expect(radius).toBe('20px')
    }

    await page.close()
  })

  // Hauteur automatique, sans `h-app-tile` fixe : le premier design bornait
  // les quatre tuiles à 132px, ce qui tronquait sans
  // ellipse une description plus longue que les autres. La boîte suit
  // désormais son contenu — deux descriptions de longueur très différente
  // ne mesurent donc plus la même hauteur.
  it('lets a tile grow past 132px instead of truncating a long description', async () => {
    const short = renderToStaticMarkup(
      <AppTile
        name="Short"
        state="off"
        icon={<HeartPulse width={21} height={21} strokeWidth={1.75} />}
        description="One line."
      />,
    )
    const long = renderToStaticMarkup(
      <AppTile
        name="Long"
        state="off"
        icon={<HeartPulse width={21} height={21} strokeWidth={1.75} />}
        description={'A very long description that keeps going and going and going and going and going and going and going and going and going, on purpose, well past what a single line could ever hold.'}
      />,
    )
    const page = await pageWithBody(
      `${FONT_VARS}<div id="list" style="width:358px;display:flex;flex-direction:column;gap:11px">${short}${long}</div>`,
    )

    const heights = await page
      .locator('#list > *')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights).toHaveLength(2)
    expect(heights[1]).toBeGreaterThan(heights[0] ?? 0)
    // Ni l'une ni l'autre n'est bornée à l'ancienne hauteur fixe.
    expect(heights[1]).toBeGreaterThan(132)

    await page.close()
  })

  it('renders one active tile and three inert ones, with the states of the design', async () => {
    const page = await pageWithTiles()

    // Seule `Life tracker` est navigable ; les trois autres n'ont aucun
    // écran et sont rendues inertes.
    expect(await page.locator('#list > a[href="/tools/life"]').count()).toBe(1)
    const inert = await page
      .locator('#list > button')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLButtonElement).disabled))
    expect(inert).toEqual([true, true, true])

    const tiles = await page.locator('#list > *').evaluateAll((nodes) =>
      nodes.map((node) => {
        const tag = node.querySelectorAll('span > span > span')[1]
        return {
          opacity: getComputedStyle(node).opacity,
          border: getComputedStyle(node).borderTopColor,
          tag: tag?.textContent ?? '',
          tagColor: tag ? getComputedStyle(tag).color : '',
        }
      }),
    )

    // `on` : pleine opacité, bordure accent, `ENABLED` en `--color-accent-text`.
    expect(tiles[0]).toMatchObject({ opacity: '1', tag: 'ENABLED' })
    expect(tiles[0]?.border).toBe('rgba(232, 180, 74, 0.35)')
    expect(tiles[0]?.tagColor).toBe('rgb(240, 192, 96)')

    // `off` avec `tagLabel="PLANNED"` : gris (`--color-text-3`), jamais
    // ambré — il n'existe plus de troisième état intermédiaire : l'ambre
    // signale un problème réparable, l'employer pour « à venir » l'affaiblirait.
    // Les trois tuiles sans écran (`Trading mode`, `Card scanner`, `AI
    // assistant`) partagent donc le même traitement.
    for (const tile of [tiles[1], tiles[2], tiles[3]]) {
      expect(tile).toMatchObject({ opacity: '0.72', tag: 'PLANNED' })
      expect(tile?.tagColor).toBe('rgb(78, 75, 90)')
    }

    await page.close()
  })
})

describe('Life tracker setup', () => {
  async function pageWithSetup() {
    // `renderToStaticMarkup` n'exécute aucun `useEffect` : l'écran rend donc
    // `DEFAULT_LIFE_SETUP` (4 joueurs, 40 points), exactement la
    // présélection du design validé.
    return pageWithBody(
      `${FONT_VARS}<div id="setup" style="width:390px">${renderToStaticMarkup(<LifeTracker />)}</div>`,
    )
  }

  it('renders five player pills in mono 17px/800 and three life pills in mono 15px/800', async () => {
    const page = await pageWithSetup()

    const pills = await page
      .locator('#setup button[aria-pressed]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node)
          return {
            label: node.textContent ?? '',
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontFamily: style.fontFamily,
            background: style.backgroundColor,
            color: style.color,
          }
        }),
      )

    // Cinq pastilles de joueurs (2-6) puis trois de vie de départ (20/40/30).
    expect(pills.map((pill) => pill.label)).toEqual(['2', '3', '4', '5', '6', '20', '40', '30'])

    for (const pill of pills.slice(0, 5)) {
      expect(pill.fontSize).toBe('17px')
      expect(pill.fontWeight).toBe('800')
      expect(pill.fontFamily).toContain('Geist Mono')
    }
    for (const pill of pills.slice(5)) {
      expect(pill.fontSize).toBe('15px')
      expect(pill.fontWeight).toBe('800')
      expect(pill.fontFamily).toContain('Geist Mono')
    }

    // L'active est teintée (`accent-bg`/`accent-text`), pas en plein accent,
    // les autres sur la surface sombre.
    expect(pills[2]?.background).toBe('rgb(34, 28, 18)')
    expect(pills[2]?.color).toBe('rgb(240, 192, 96)')
    expect(pills[0]?.background).toBe('rgb(23, 21, 30)')
    expect(pills[6]?.background).toBe('rgb(34, 28, 18)')

    await page.close()
  })

  it('offers an Other field, the two switches and the Start game button', async () => {
    const page = await pageWithSetup()

    const other = page.locator('#setup input[aria-label="Other starting life"]')
    expect(await other.count()).toBe(1)
    expect(await other.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Geist Mono')

    expect(await page.locator('#setup [role="switch"]').count()).toBe(2)
    expect(await page.locator('#setup button', { hasText: 'Start game' }).count()).toBe(1)

    await page.close()
  })
})

describe('Life tracker grid', () => {
  function gameFor(players: 2 | 3 | 4 | 5 | 6, firstPlayer: number | null) {
    return {
      setup: { players, startingLife: 40, rollForFirst: true, keepAwake: false },
      life: Array.from({ length: players }, (_, seat) => 40 - seat),
      firstPlayer,
      startedAt: 0,
    }
  }

  async function pageWithGrid(firstPlayer: number | null, rollOverlayOnMount: boolean) {
    return pageWithBody(
      `${FONT_VARS}${renderToStaticMarkup(
        <LifeGameScreen
          game={gameFor(4, firstPlayer)}
          rollOverlayOnMount={rollOverlayOnMount}
          onChange={() => {}}
          onExit={() => {}}
        />,
      )}`,
    )
  }

  it('lays four seats out 2x2 full screen and rotates the top pair by 180 degrees', async () => {
    const page = await pageWithGrid(null, false)

    const seats = await page.locator('[data-seat]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const pad = node.firstElementChild as HTMLElement
        const rect = node.getBoundingClientRect()
        const padStyle = getComputedStyle(pad)
        return {
          seat: node.getAttribute('data-seat'),
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          // Tailwind 4 émet `rotate: 180deg` (propriété `rotate`), pas un
          // `transform` — les deux sont relevés pour que l'assertion ne
          // dépende pas de la forme choisie par la version installée.
          rotate: padStyle.rotate,
          transform: padStyle.transform,
        }
      }),
    )

    expect(seats.map((s) => s.seat)).toEqual(['0', '1', '2', '3'])

    // Deux colonnes, deux rangées : les sièges 0/1 partagent une ligne, 2/3
    // l'autre, et les deux colonnes ont la même largeur.
    expect(seats[0]?.top).toBe(seats[1]?.top)
    expect(seats[2]?.top).toBe(seats[3]?.top)
    expect(seats[2]?.top).toBeGreaterThan(seats[0]?.top ?? 0)
    expect(seats[0]?.left).toBeLessThan(seats[1]?.left ?? 0)
    expect(seats[0]?.width).toBe(seats[1]?.width)

    // Plein écran : la grille occupe les 420×1600 du viewport de la page de
    // test, sans la réserve de 96px de la barre d'onglets.
    const rootBox = await page
      .locator('div.fixed')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    expect(rootBox.width).toBe(420)
    expect(rootBox.height).toBe(1600)

    // Les deux pavés du haut sont retournés, les deux du bas non.
    const flipped = (s: { rotate: string; transform: string }) =>
      s.rotate === '180deg' || s.transform === 'matrix(-1, 0, 0, -1, 0, 0)'
    expect(seats.slice(0, 2).every(flipped)).toBe(true)
    expect(seats.slice(2).some(flipped)).toBe(false)

    await page.close()
  })

  it('leaves the button order untouched on a flipped pad, so + lands at the bottom of its box', async () => {
    const page = await pageWithGrid(null, false)

    const buttons = await page.locator('[data-seat]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect()
        const read = (label: string) => {
          const rect = node.querySelector(`button[aria-label="${label}"]`)!.getBoundingClientRect()
          return rect.top + rect.height / 2 < box.top + box.height / 2 ? 'upper' : 'lower'
        }
        return {
          seat: node.getAttribute('data-seat'),
          gain: read('Gain one life'),
          lose: read('Lose one life'),
        }
      }),
    )

    // Sièges du haut (retournés) : `+` tombe dans la moitié basse de la
    // boîte écran — donc en haut pour le joueur assis en face, qui lit le
    // pavé à l'endroit. Sièges du bas : l'inverse. « Corriger » l'ordre des
    // boutons ferait taper le mauvais au joueur d'en face.
    expect(buttons.slice(0, 2)).toEqual([
      { seat: '0', gain: 'lower', lose: 'upper' },
      { seat: '1', gain: 'lower', lose: 'upper' },
    ])
    expect(buttons.slice(2)).toEqual([
      { seat: '2', gain: 'upper', lose: 'lower' },
      { seat: '3', gain: 'upper', lose: 'lower' },
    ])

    await page.close()
  })

  it('renders the same markup flipped and unflipped, apart from the rotation itself', () => {
    const unflipped = renderToStaticMarkup(
      <LifePad life={40} tint="var(--color-seat-1)" onAdjust={() => {}} />,
    )
    const flipped = renderToStaticMarkup(
      <LifePad life={40} tint="var(--color-seat-1)" flip onAdjust={() => {}} />,
    )

    expect(flipped).not.toBe(unflipped)
    expect(flipped).toContain('rotate-180')
    // Le seul écart est la classe de rotation : ni l'ordre des boutons, ni
    // leur `aria-label` ne changent avec `flip`.
    expect(flipped.replace('rotate-180', '')).toBe(unflipped)
  })

  // Le tirage ouvre un voile bloquant plein écran (`FirstPlayerOverlay`),
  // pas une surbrillance temporaire : il nomme le siège tiré et
  // n'offre que deux issues, `Roll again` et `Play`.
  it('opens a blocking overlay naming the drawn seat, with Roll again and Play', async () => {
    const page = await pageWithGrid(2, true)

    const overlay = page.locator('div.fixed.inset-0.z-50')
    expect(await overlay.count()).toBe(1)

    const overlayText = (await overlay.textContent()) ?? ''
    // Siège 2 (0-indexé) affiché « 3 », `SEAT_NAMES[2]` = « Top-left seat ».
    expect(overlayText).toContain('3')
    expect(overlayText).toContain('Top-left seat starts')

    const buttons = await overlay.locator('button').allTextContents()
    expect(buttons).toEqual(['Roll again', 'Play'])

    await page.close()
  })

  it('keeps the small crown and shows no overlay once the roll has settled', async () => {
    const page = await pageWithGrid(2, false)

    expect(await page.locator('div.fixed.inset-0.z-50').count()).toBe(0)
    // Le siège tiré garde sa petite couronne.
    expect(await page.locator('[data-seat="2"] svg.lucide-crown').count()).toBe(1)
    expect(await page.locator('[data-seat="0"] svg.lucide-crown').count()).toBe(0)

    await page.close()
  })
})

describe('Settings Tools group, inert rows', () => {
  it('greys the three planned rows to 0.6 and mounts no control in them', async () => {
    // Sans sous-titre et badge uniforme « PLANNED », sans « Soon » : les
    // trois lignes prévues se lisent désormais toutes de la même façon.
    const rows = [{ label: 'Trading mode' }, { label: 'Card scanner' }, { label: 'AI assistant' }]
    const html = rows
      .map((row) =>
        renderToStaticMarkup(
          <PlannedToolRow
            icon={<HeartPulse width={18} height={18} strokeWidth={1.75} />}
            label={row.label}
          />,
        ),
      )
      .join('')
    const page = await pageWithBody(`${FONT_VARS}<div id="tools" style="width:358px">${html}</div>`)

    const opacities = await page
      .locator('#tools > div')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity))
    expect(opacities).toEqual(['0.6', '0.6', '0.6'])

    // Aucun contrôle actif : ni bouton, ni interrupteur, ni champ — un
    // interrupteur désactivé en resterait un.
    expect(await page.locator('#tools button, #tools [role="switch"], #tools input, #tools select').count()).toBe(0)

    // Le badge reprend la puce du design validé (11px, 0.04em, surface 2).
    const badge = await page
      .locator('#tools span', { hasText: 'PLANNED' })
      .last()
      .evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          fontSize: style.fontSize,
          letterSpacing: style.letterSpacing,
          background: style.backgroundColor,
        }
      })
    expect(badge.fontSize).toBe('11px')
    expect(badge.letterSpacing).toBe('0.44px')
    expect(badge.background).toBe('rgb(23, 21, 30)')

    await page.close()
  })
})

// ── Desktop ────────────────────────────────────────────────────────────
//
// Le layout desktop est fixé au pixel : 236px de
// barre latérale, `AppLogo` 34px, 26px d'indentation, `Settings` collé en
// bas, 426px de panneau, image `normal` de 150px au ratio 5/7, prix 26px en
// mono, vignettes 46×64. Ils sont **mesurés** ici contre la feuille
// compilée, pas déduits d'une liste de classes : une classe absente du
// thème n'émet aucune CSS et n'assert donc rien (docs/development.md, `--spacing:
// initial`).
const SIDEBAR_TREE = {
  username: 'alexm',
  collection: {
    id: 'root-1',
    name: 'All collection',
    children: [
      { id: 'b1', name: 'Commander staples', kind: 'binder' as const },
      { id: 'b2', name: 'Trade binder', kind: 'binder' as const },
    ],
  },
  deckFolders: [{ id: 'f1', name: 'Commander' }],
  toolsEnabled: true,
}

async function desktopPage(bodyHtml: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(
    `<!DOCTYPE html><html><head><style>${css}</style>${FONT_VARS}</head><body style="margin:0">${bodyHtml}</body></html>`,
  )
  return page
}

// Pas de `MainHeader` : l'écran de container garde le
// même en-tête à toutes les largeurs — l'accès au `···` desktop est couvert
// par le test de point de montage unique de `desktop-shell.test.ts`.

describe('desktop sidebar', () => {
  // Le design validé dessine
  // quatre rangées dans le sous-arbre de `Collection` : `All collection`,
  // `Decks`, puis les binders. `Decks` y est une **entrée unique** vers
  // l'écran des decks, pas la liste des decks.
  it('renders the four subtree rows of the design, Decks included', async () => {
    const page = await desktopPage(
      `<div style="display:flex">${renderToStaticMarkup(
        <Sidebar tree={SIDEBAR_TREE} activeId="collection" />,
      )}</div>`,
      1440,
    )

    const subtree = page
      .locator('nav > div')
      .filter({ has: page.locator('a[href="/container/root-1"]') })
    const rows = await subtree.locator('> a').evaluateAll((nodes) =>
      nodes.map((node) => ({ text: node.textContent, href: node.getAttribute('href') })),
    )
    expect(rows).toEqual([
      { text: 'All collection', href: '/container/root-1' },
      { text: 'Decks', href: '/decks' },
      { text: 'Commander staples', href: '/container/b1' },
      { text: 'Trade binder', href: '/container/b2' },
    ])

    await page.close()
  })

  it('measures 236px wide, a 34px AppLogo, a 26px subtree indent and Settings pinned to the bottom', async () => {
    const page = await desktopPage(
      `<div style="display:flex">${renderToStaticMarkup(
        <Sidebar tree={SIDEBAR_TREE} activeId="collection" />,
      )}</div>`,
      1440,
    )

    const nav = await page.locator('nav').boundingBox()
    expect(nav?.width).toBe(236)

    // `AppLogo` 34px — la marque, pas un carré de dégradé : le SVG porte
    // `role="img"` et sa boîte fait 34×34. Le preflight Tailwind pose
    // `height: auto` sur `img`/`video`, **pas** sur `svg` : les attributs
    // `width`/`height` tiennent donc ici, ce que cette mesure vérifie
    // plutôt que de le supposer.
    const icon = await page.locator('nav svg[role="img"]').boundingBox()
    expect(icon?.width).toBe(34)
    expect(icon?.height).toBe(34)

    // Indentation de 26px : la rangée de premier niveau `Collection` et
    // l'enfant `All collection`, bord gauche contre bord gauche.
    const collectionRow = await page
      .locator('nav > div')
      .filter({ has: page.locator('a[href="/collection"]') })
      .boundingBox()
    const child = await page.locator('a[href="/container/root-1"]').boundingBox()
    expect(collectionRow && child && child.x - collectionRow.x).toBe(26)

    // `Settings` collé en bas : la rangée s'arrête exactement sur le
    // padding bas de 24px de la barre (`padding:30px 12px 24px`). Une
    // mesure, pas un `mt-auto` lu dans la
    // liste de classes — `mt-auto` sans `flex-direction: column` ne pousse
    // rien.
    const settingsRow = await page
      .locator('nav div')
      .filter({ has: page.locator('a[href="/settings"]') })
      .last()
      .boundingBox()
    expect(
      nav && settingsRow && Math.round(nav.y + nav.height - (settingsRow.y + settingsRow.height)),
    ).toBe(24)

    // Tailles de police du design validé : 14.5px au premier niveau, 13.5px
    // dans le sous-arbre.
    expect(
      await page.locator('a[href="/collection"]').evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14.5px')
    expect(
      await page
        .locator('a[href="/container/root-1"]')
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('13.5px')

    // Entrée active en accent (`#e8b44a`).
    expect(
      await page
        .locator('nav > div')
        .filter({ has: page.locator('a[href="/collection"]') })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(232, 180, 74)')

    await page.close()
  })

  // Aucun repli manuel : un sous-arbre suit strictement l'onglet actif, jamais un choix mémorisé — ici
  // `activeId="settings"` n'allume ni `Collection` ni `Decks`, les deux
  // sous-arbres doivent donc être absents du DOM.
  it('drops a subtree from the DOM once its tab is no longer active', async () => {
    const page = await desktopPage(
      `<div style="display:flex">${renderToStaticMarkup(
        <Sidebar tree={SIDEBAR_TREE} activeId="settings" />,
      )}</div>`,
      1440,
    )

    expect(await page.locator('a[href="/container/root-1"]').count()).toBe(0)
    expect(await page.locator('a[href="/container/b1"]').count()).toBe(0)
    expect(await page.locator('a[href="/decks/folders/f1"]').count()).toBe(0)
    // Les entrées de premier niveau restent, elles.
    expect(await page.locator('a[href="/decks"]').count()).toBe(1)

    await page.close()
  })
})

const PREVIEW: CardPreview = {
  cardId: 'card-1',
  name: 'Rhystic Study',
  manaCost: '{2}{U}',
  typeLine: 'Enchantment',
  setCode: 'pcy',
  setName: 'Prophecy',
  setIconUri: null,
  collectorNumber: '45',
  rarity: 'common',
  oracleText:
    'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
  artist: 'Terese Nielsen',
  imageUrl: FAKE_THUMB,
  zoomImageUrl: null,
  priceMinor: 3490,
  holding: { holdingId: 'h1', qty: 1, finish: 'nonfoil', condition: 'nm' },
  inCollection: [{ containerId: 'root-1', containerName: 'Commander staples', qty: 1 }],
  builtDeckCount: 0,
  otherPrintings: [
    { cardId: 'p1', setCode: 'c19', thumbUrl: FAKE_THUMB, priceMinor: 3200 },
    { cardId: 'p2', setCode: 'jmp', thumbUrl: FAKE_THUMB, priceMinor: 2900 },
    { cardId: 'p3', setCode: '2xm', thumbUrl: FAKE_THUMB, priceMinor: 3100 },
  ],
}

const PREVIEW_HOLDING: HoldingRow = {
  holdingId: 'h1',
  cardId: 'card-1',
  name: 'Rhystic Study',
  manaCost: '{2}{U}',
  setCode: 'pcy',
  setName: 'Prophecy',
  setIconUri: null,
  collectorNumber: '45',
  rarity: 'common',
  finish: 'nonfoil',
  condition: 'nm',
  qty: 1,
  available: 1,
  priceMinor: 3490,
  thumbUrl: FAKE_THUMB,
  groupLabel: null,
  binderName: null,
}

function previewPaneMarkup(): string {
  return renderToStaticMarkup(
    <PreviewPane
      preview={PREVIEW}
      holding={PREVIEW_HOLDING}
      priceLabel="$34.90"
      onQtyChange={() => {}}
      onConditionChange={() => {}}
      onFoilChange={() => {}}
      onAddToDeck={() => {}}
      onMoveToBinder={() => {}}
      onDelete={() => {}}
    />,
  )
}

describe('desktop preview pane', () => {
  it('measures 426px wide, a 150px normal image at 5/7, a 30px mono price and three 52x73 thumbnails', async () => {
    const page = await desktopPage(
      `<div style="display:flex;height:900px">${previewPaneMarkup()}</div>`,
      1440,
    )

    const pane = await page.getByTestId('preview-pane').boundingBox()
    expect(pane?.width).toBe(426)

    // Image `normal` : 150px de large, ratio 5/7 — le cadre est contraint
    // en CSS (`w-detail-image`, `aspect-card`), jamais par un attribut
    // `width=`/`height=` que le preflight (`img { height: auto }`)
    // écraserait.
    const image = await page.locator('[data-testid="preview-pane"] img').first().boundingBox()
    expect(image?.width).toBe(150)
    expect(image && Math.round((image.height / image.width) * 100) / 100).toBe(1.4)

    // Prix 30px en mono.
    const price = await page.getByText('$34.90').evaluate((el) => {
      const style = getComputedStyle(el)
      return { fontSize: style.fontSize, fontFamily: style.fontFamily }
    })
    expect(price.fontSize).toBe('30px')
    expect(price.fontFamily).toContain('Geist Mono')

    // Vignettes `Other printings` : 52×73 chacune, plafonnées à six par la
    // donnée.
    const thumbs = page.locator('[data-testid="preview-pane"] img.rounded-printing-tile')
    expect(await thumbs.count()).toBe(3)
    for (let i = 0; i < 3; i += 1) {
      const box = await thumbs.nth(i).boundingBox()
      expect(box?.width).toBe(52)
      expect(box?.height).toBe(73)
    }

    await page.close()
  })

  // Trois boutons égaux et libellés — `Add to deck`, `Move to binder`, `Remove`. Les vignettes
  // `Other printings` ne sont pas des boutons du tout : aucune navigation
  // vers une autre impression n'existe.
  it('offers Add to deck, Move to binder and Remove as live buttons, and inert printings', async () => {
    const page = await desktopPage(
      `<div style="display:flex;height:900px">${previewPaneMarkup()}</div>`,
      1440,
    )
    const pane = page.getByTestId('preview-pane')

    // `expect` est celui de vitest, pas celui de Playwright : on lit l'état
    // et on l'assère, plutôt que d'utiliser les matchers de locator.
    expect(await pane.getByRole('button', { name: 'Add to deck' }).isEnabled()).toBe(true)
    expect(await pane.getByRole('button', { name: 'Move to binder' }).isEnabled()).toBe(true)
    expect(await pane.getByRole('button', { name: 'Remove' }).isEnabled()).toBe(true)

    // Les impressions restent inertes ; seule la grande image est un bouton
    // (agrandissement, ZoomableCardImage).
    expect(await pane.locator('button:has(img):not([aria-label^="Enlarge"])').count()).toBe(0)
    expect(await pane.locator('button[aria-label^="Enlarge"]').count()).toBe(1)

    await page.close()
  })

  it('stays out of sight below 1280px and shows above it, by CSS alone', async () => {
    // Le panneau porte `hidden pane:flex` : à 1024px il ne s'affiche pas,
    // à 1280px si — sans qu'aucun JavaScript ne s'exécute dans cette page.
    // C'est ce qui rend la première peinture correcte à toutes les largeurs,
    // l'élagage du DOM venant seulement après
    // hydratation (`components/desktop/use-min-width.ts`).
    const narrow = await desktopPage(`<div style="display:flex">${previewPaneMarkup()}</div>`, 1024)
    expect(
      await narrow.getByTestId('preview-pane').evaluate((el) => getComputedStyle(el).display),
    ).toBe('none')
    await narrow.close()

    const wide = await desktopPage(`<div style="display:flex">${previewPaneMarkup()}</div>`, 1280)
    expect(
      await wide.getByTestId('preview-pane').evaluate((el) => getComputedStyle(el).display),
    ).toBe('flex')
    await wide.close()
  })

  it('renders the same edit controls as the mobile card sheet, from one shared component', () => {
    // Deux implémentations parallèles mobile/desktop divergent en quelques
    // semaines. Le panneau monte littéralement le
    // balisage de `CardEditControls` — comparé ici au rendu du composant
    // partagé lui-même, il échouerait si le panneau reposait un jour sa
    // propre copie.
    const shared = renderToStaticMarkup(
      <CardEditControls
        holdingId="h1"
        qty={1}
        condition="nm"
        finish="nonfoil"
        onQtyChange={() => {}}
        onConditionChange={() => {}}
        onFoilChange={() => {}}
      />,
    )
    expect(previewPaneMarkup()).toContain(shared)

    // `CardSheet` se rend dans un portail Radix : `react-dom/server` n'en
    // produit rien, la même comparaison de balisage y est impossible. Le
    // garde-fou porte donc sur la source : les écrans qui éditent réellement
    // une ligne importent le composant partagé, et aucun ne réénumère les
    // conditions — c'est le signal d'une seconde implémentation.
    //
    // `card-sheet.tsx` est la feuille de détail en LECTURE SEULE — elle ne
    // monte pas `CardEditControls` du tout (aucune condition à énumérer nulle
    // part dans cette feuille-là, au sens strict le plus fort de cette même
    // garantie). L'édition vit dans `edit-card-sheet.tsx`/`edit-list-card-sheet.tsx`, qui
    // reprennent le contrôle partagé au même titre que le panneau desktop.
    const sheetSource = readFileSync(join(process.cwd(), 'components/cards/card-sheet.tsx'), 'utf-8')
    expect(sheetSource).not.toContain('<CardEditControls')
    expect(sheetSource).not.toContain('Lightly played')

    const editSources = [
      readFileSync(join(process.cwd(), 'components/cards/edit-card-sheet.tsx'), 'utf-8'),
      readFileSync(join(process.cwd(), 'components/cards/edit-list-card-sheet.tsx'), 'utf-8'),
      readFileSync(join(process.cwd(), 'components/desktop/preview-pane.tsx'), 'utf-8'),
    ]
    for (const source of editSources) {
      expect(source).toContain('<CardEditControls')
      expect(source).not.toContain('Lightly played')
    }
  })

  it('opens Filters through one inner component on both shells', () => {
    // Un seul modèle d'overlay — la `Sheet` partagée,
    // bottom sheet sous 900px et modale centrée au-delà (le popover ancré a
    // été retiré). `ResponsiveSheet` ne rend donc `{children}` qu'une fois,
    // et `FiltersSheet` ne monte qu'un seul `ResponsiveSheet`.
    const responsive = readFileSync(join(process.cwd(), 'components/ui/responsive-sheet.tsx'), 'utf-8')
    expect(responsive.match(/\{children\}/g)).toHaveLength(1)
    // Le seuil ne vit plus ici : la bascule bottom-sheet/modale est portée
    // par les variantes `desktop:` de la `Sheet` partagée (CSS), jamais par
    // un littéral local.
    expect(responsive).not.toMatch(/min-width:\s*\d/)

    for (const file of ['components/command-bar/filters-sheet.tsx', 'components/command-bar/sort-sheet.tsx']) {
      const source = readFileSync(join(process.cwd(), file), 'utf-8')
      expect(source.match(/<ResponsiveSheet/g)).toHaveLength(1)
      // Et ne rouvre pas sa propre coquille à côté : un `Popover.Root` ou
      // un `Sheet` monté ici serait justement une seconde implémentation.
      expect(source).not.toContain('react-popover')
      expect(source).not.toContain("from '@/components/ui/sheet'")
    }
  })
})
