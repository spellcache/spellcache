// Test unitaire : les six dégradés
// nommés de `BINDER_GRADIENTS` existent et sont valides (chaque valeur porte
// bien deux couleurs hex exploitables par `binderRowBackground`/
// `binderBackdropGradient`), et le pire cas de contraste titre/fond de
// l'en-tête de binder illustré reste ≥ 4.5:1 (test automatisé de contraste).
import { describe, expect, it } from 'vitest'

import {
  BINDER_GRADIENTS,
  binderBackdropGradient,
  binderRowBackground,
  contrastRatio,
  isGradientKey,
  worstCaseTitleContrast,
  type GradientKey,
} from '@/lib/binders/gradients'

const KEYS: GradientKey[] = ['blue', 'green', 'red', 'grey', 'gold', 'purple']

describe('lib/binders/gradients — BINDER_GRADIENTS', () => {
  it('exposes exactly the six named gradient keys', () => {
    expect(Object.keys(BINDER_GRADIENTS).sort()).toEqual([...KEYS].sort())
  })

  it.each(KEYS)('key "%s" is a valid two-stop linear-gradient()', (key) => {
    const value = BINDER_GRADIENTS[key]
    expect(value).toMatch(/^linear-gradient\(160deg,#[0-9a-f]{6},#[0-9a-f]{6}\)$/)
  })

  it.each(KEYS)('isGradientKey accepts "%s"', (key) => {
    expect(isGradientKey(key)).toBe(true)
  })

  it('isGradientKey rejects an unknown or corrupted value', () => {
    expect(isGradientKey('teal')).toBe(false)
    expect(isGradientKey('')).toBe(false)
  })

  // `intensity = 1` (le défaut du paramètre) n'est jamais atteint en
  // production — `binder-row.tsx` passe toujours `binder.coverIntensity`
  // explicitement — donc l'intensité réellement
  // livrée par défaut (`containers.cover_intensity`) est exercée ici,
  // pas le défaut mort du paramètre.
  it.each(KEYS)('binderRowBackground("%s", 0.52) derives a well-formed row background', (key) => {
    expect(() => binderRowBackground(key, 0.52)).not.toThrow()
    expect(binderRowBackground(key, 0.52)).toContain('linear-gradient(100deg,')
  })

  it.each(KEYS)('binderBackdropGradient("%s") derives a header backdrop without throwing', (key) => {
    expect(() => binderBackdropGradient(key)).not.toThrow()
    // Les deux teintes de la clé, du haut vers le bas : le fond ne se
    // résout plus sur `#08090c` à mi-bande (il s'arrêtait net), c'est le
    // masque de `BACKDROP_FADE_MASK` qui le dissout.
    const [dark, light] = BINDER_GRADIENTS[key].match(/#[0-9a-f]{6}/gi)!
    expect(binderBackdropGradient(key)).toBe(`linear-gradient(180deg, ${dark}, ${light})`)
  })
})

// Régression : `binderRowBackground` est fragile — un correctif qui tient
// un anchor peut en casser un autre, et `not.toThrow()` +
// `toContain('linear-gradient(100deg,')` laissent passer n'importe quelle
// valeur de palier. Les deux anchors mesurés doivent tenir
// **simultanément**, avec une dégradation monotone entre eux.
const SURFACE_RGB = [18, 21, 28] // `#12151c`, `--color-surface-1`
const SCREEN_BG_RGB = [8, 9, 12] // `#08090c`, `--color-bg` — le fond réel
// derrière la ligne (aucun `bg-surface-1` posé sous elle, `binder-row.tsx`).

function parseRgbaStops(css: string): Array<{ r: number; g: number; b: number; a: number }> {
  return [...css.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)].map(([, r, g, b, a]) => ({
    r: Number(r),
    g: Number(g),
    b: Number(b),
    a: Number(a),
  }))
}

// Le composite réel qu'un navigateur produirait pour ce palier posé
// directement sur `#08090c` — la même opération que `getComputedStyle` +
// capture d'écran, sans dépendre de Playwright pour un test
// unitaire.
function compositeOverScreenBg(stop: { r: number; g: number; b: number; a: number }): [number, number, number] {
  const composite = (fg: number, bg: number) => stop.a * fg + (1 - stop.a) * bg
  return [
    composite(stop.r, SCREEN_BG_RGB[0]!),
    composite(stop.g, SCREEN_BG_RGB[1]!),
    composite(stop.b, SCREEN_BG_RGB[2]!),
  ]
}

describe('lib/binders/gradients — binderRowBackground (deux anchors tenus simultanément)', () => {
  it('anchor 1 — intensity = 1 reproduit au pixel les paliers verbatim du design validé (apparence "green")', () => {
    const stops = parseRgbaStops(binderRowBackground('green', 1))
    expect(stops).toHaveLength(3)
    // Design validé : `linear-gradient(100deg,
    // rgba(52,211,153,0.34) 0%, rgba(31,122,90,0.16) 46%, #12151c 100%)`.
    expect(stops[0]).toEqual({ r: 52, g: 211, b: 153, a: 0.34 })
    expect(stops[1]).toEqual({ r: 31, g: 122, b: 90, a: 0.16 })
    expect(stops[2]).toEqual({ r: 18, g: 21, b: 28, a: 1 })
  })

  it('anchor 2 — intensity = 0 rend chaque palier, une fois composé, identique à la surface None rgb(18,21,28)', () => {
    for (const key of KEYS) {
      const stops = parseRgbaStops(binderRowBackground(key, 0))
      expect(stops).toHaveLength(3)
      for (const stop of stops) {
        expect(compositeOverScreenBg(stop).map(Math.round)).toEqual(SURFACE_RGB)
      }
    }
  })

  it('dégrade de façon monotone entre les deux anchors, sans jamais dépasser la surface environnante, à l\'intensité livrée par défaut (0.52)', () => {
    const full = parseRgbaStops(binderRowBackground('green', 1)).map(compositeOverScreenBg)
    const mid = parseRgbaStops(binderRowBackground('green', 0.52)).map(compositeOverScreenBg)

    mid.forEach((midColor, stopIndex) => {
      const fullColor = full[stopIndex]!
      midColor.forEach((channel, c) => {
        const lo = Math.min(SURFACE_RGB[c]!, fullColor[c]!)
        const hi = Math.max(SURFACE_RGB[c]!, fullColor[c]!)
        expect(channel).toBeGreaterThanOrEqual(lo - 0.01)
        expect(channel).toBeLessThanOrEqual(hi + 0.01)
      })
    })
  })

  it('chaque canal de chaque palier varie de façon monotone quand intensity balaie 0 → 1', () => {
    const intensities = [0, 0.25, 0.52, 0.75, 1]
    const samples = intensities.map((intensity) =>
      parseRgbaStops(binderRowBackground('green', intensity)).map(compositeOverScreenBg),
    )
    for (let stopIndex = 0; stopIndex < 3; stopIndex += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const series = samples.map((sample) => sample[stopIndex]![channel]!)
        const nonDecreasing = series.every((value, i) => i === 0 || value >= series[i - 1]! - 0.01)
        const nonIncreasing = series.every((value, i) => i === 0 || value <= series[i - 1]! + 0.01)
        expect(nonDecreasing || nonIncreasing).toBe(true)
      }
    }
  })
})

describe('lib/binders/gradients — contrastRatio', () => {
  it('rates pure white on pure black as the maximum WCAG contrast (21:1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
  })

  it('rates a colour against itself as no contrast (1:1)', () => {
    expect(contrastRatio('#3d7bff', '#3d7bff')).toBeCloseTo(1, 5)
  })
})

describe('lib/binders/gradients — worstCaseTitleContrast', () => {
  it('stays >= 4.5:1 even at intensity = 1, against a light illustration and the six gradients', () => {
    expect(worstCaseTitleContrast()).toBeGreaterThanOrEqual(4.5)
  })
})
