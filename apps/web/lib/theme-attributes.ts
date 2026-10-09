// Partie du thème importable côté client (aucun `import { db }`, même raison
// que `lib/price-source.ts`) : la forme des attributs de `<html>` et leur
// application immédiate quand Settings change l'accent, le fond ou le
// mode clair/sombre, sans attendre un nouveau rendu serveur.
import type { AccentColor, ColorScheme } from '@spellcache/db/schema'
import { themeColorsFor } from '@/lib/pwa'

export interface ThemeAttributes {
  'data-accent'?: AccentColor
  'data-pure-black'?: ''
  'data-scheme'?: ColorScheme
}

// Les défauts du bloc `@theme` (or, fond normal, sombre) ne posent aucun
// attribut.
export function themeAttributes(
  accentColor: AccentColor,
  pureBlack: boolean,
  colorScheme: ColorScheme,
): ThemeAttributes {
  return {
    ...(accentColor !== 'gold' && { 'data-accent': accentColor }),
    ...(pureBlack && { 'data-pure-black': '' }),
    ...(colorScheme !== 'dark' && { 'data-scheme': colorScheme }),
  }
}

export function applyAccentColor(accentColor: AccentColor): void {
  const root = document.documentElement
  if (accentColor === 'gold') delete root.dataset.accent
  else root.dataset.accent = accentColor
}

export function applyPureBlack(pureBlack: boolean): void {
  document.documentElement.toggleAttribute('data-pure-black', pureBlack)
}

export function applyColorScheme(colorScheme: ColorScheme): void {
  const root = document.documentElement
  if (colorScheme === 'dark') delete root.dataset.scheme
  else root.dataset.scheme = colorScheme

  // La barre de statut suit aussi, sans attendre un nouveau rendu serveur.
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
  for (const { color, media } of themeColorsFor(colorScheme)) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = color
    if (media) meta.media = media
    document.head.append(meta)
  }
}
