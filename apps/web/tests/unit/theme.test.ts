import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BREAKPOINTS } from '@/lib/breakpoints'

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf-8')

function tokenValue(name: string): string | undefined {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`))
  return match?.[1]?.trim()
}

describe('app/globals.css design tokens', () => {
  it('exposes --color-accent at #e8b44a', () => {
    expect(tokenValue('--color-accent')).toBe('#e8b44a')
  })

  it('exposes --color-surface-1 at light-dark(#ffffff, #14121a)', () => {
    expect(tokenValue('--color-surface-1')).toBe('light-dark(#ffffff, #14121a)')
  })

  it('exposes --radius-row at 18px', () => {
    expect(tokenValue('--radius-row')).toBe('18px')
  })
})

// Les points de bascule sont déclarés une fois et utilisés partout : trois
// valeurs codées en dur dans trois composants sont la façon classique de
// casser le responsive. Deux
// représentations sont inévitables — une media query CSS ne peut pas lire
// une constante TypeScript, et `matchMedia` ne peut pas lire un token
// `@theme`. Ce test est le lien : il échoue si l'une bouge sans l'autre,
// et il échouerait aussi si l'un des deux tokens disparaissait de
// `globals.css` (`tokenValue` rendrait `undefined`, jamais égal à `768px`).
describe('les points de bascule CSS et TypeScript sont la même valeur', () => {
  it('aligns --breakpoint-desktop on BREAKPOINTS.mobile', () => {
    expect(tokenValue('--breakpoint-desktop')).toBe(`${BREAKPOINTS.mobile}px`)
  })

  it('aligns --breakpoint-pane on BREAKPOINTS.previewPane', () => {
    expect(tokenValue('--breakpoint-pane')).toBe(`${BREAKPOINTS.previewPane}px`)
  })

  it('aligns --breakpoint-tablet on BREAKPOINTS.tablet', () => {
    expect(tokenValue('--breakpoint-tablet')).toBe(`${BREAKPOINTS.tablet}px`)
  })
})
