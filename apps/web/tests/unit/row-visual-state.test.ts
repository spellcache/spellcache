// Régression : la coche d'une ligne ne parle que de la sélection groupée,
// jamais de la ligne courante du panneau d'aperçu. Le compteur `N selected`
// de l'en-tête de sélection et le nombre de lignes cochées doivent coïncider :
// c'est là-dessus que l'ancienne écriture mentait, juste avant une
// suppression groupée.
//
// Le test rejoue **la séquence exacte** de `tests/e2e/desktop.spec.ts`
// (« shift-click takes a range and ctrl-click toggles one row ») : clic
// simple sur la ligne 0 (qui remplit le panneau), `Cancel`, puis
// `Ctrl`+clic sur les lignes 1 et 2. Playwright ne pouvait l'attraper : il
// n'assertait que le texte du compteur, jamais le nombre de coches.
import { describe, expect, it } from 'vitest'

import { rowVisualState } from '@/components/selection/row-visual-state'

const ROWS = ['h0', 'h1', 'h2', 'h3']

function paint(state: {
  selectionActive: boolean
  allMatching: boolean
  selectedIds: Set<string>
  currentHoldingId: string | null
}) {
  const rows = ROWS.map((holdingId) => ({ holdingId, ...rowVisualState({ holdingId, ...state }) }))
  return {
    ticked: rows.filter((row) => row.selected).map((row) => row.holdingId),
    highlighted: rows.filter((row) => row.selected || row.current).map((row) => row.holdingId),
  }
}

describe('rowVisualState', () => {
  it('highlights the pane row without ticking it while no selection is active', () => {
    const painted = paint({
      selectionActive: false,
      allMatching: false,
      selectedIds: new Set(),
      currentHoldingId: 'h0',
    })
    expect(painted.ticked).toEqual([])
    expect(painted.highlighted).toEqual(['h0'])
  })

  it('keeps the tick count equal to the selection counter after Cancel then two Ctrl+clicks', () => {
    // 1. Clic simple sur la ligne 0 : elle remplit le panneau.
    let currentHoldingId: string | null = 'h0'

    // 2. `Cancel` — `selection.clear()`. La ligne courante du panneau reste
    //    `h0` : c'est précisément ce que l'ancienne écriture transformait en
    //    coche fantôme.
    // 3. `Ctrl`+clic sur la ligne 1 : « 1 selected ».
    let painted = paint({
      selectionActive: true,
      allMatching: false,
      selectedIds: new Set(['h1']),
      currentHoldingId,
    })
    expect(painted.ticked).toEqual(['h1'])
    expect(painted.ticked).toHaveLength(1)
    // La surbrillance elle non plus ne déborde pas : `h0` ne se distingue
    // plus d'une ligne quelconque tant que la sélection parle.
    expect(painted.highlighted).toEqual(['h1'])

    // 4. `Ctrl`+clic sur la ligne 2 : « 2 selected », deux coches, pas trois.
    painted = paint({
      selectionActive: true,
      allMatching: false,
      selectedIds: new Set(['h1', 'h2']),
      currentHoldingId,
    })
    expect(painted.ticked).toEqual(['h1', 'h2'])
    expect(painted.ticked).toHaveLength(2)

    // 5. Sortie de sélection : la ligne courante retrouve sa surbrillance,
    //    toujours sans coche.
    currentHoldingId = 'h0'
    painted = paint({
      selectionActive: false,
      allMatching: false,
      selectedIds: new Set(),
      currentHoldingId,
    })
    expect(painted.ticked).toEqual([])
    expect(painted.highlighted).toEqual(['h0'])
  })

  it('ticks every row after Select all, current row included, and only once', () => {
    const painted = paint({
      selectionActive: true,
      allMatching: true,
      selectedIds: new Set(),
      currentHoldingId: 'h2',
    })
    expect(painted.ticked).toEqual(ROWS)
    expect(painted.highlighted).toEqual(ROWS)
  })

  it('ticks the current row when it genuinely belongs to the selection', () => {
    const painted = paint({
      selectionActive: true,
      allMatching: false,
      selectedIds: new Set(['h0']),
      currentHoldingId: 'h0',
    })
    expect(painted.ticked).toEqual(['h0'])
  })
})
