// Couleur de chrome native (onglet, barre de statut). Distincte des tokens
// d'interface : c'est la couleur de la tuile de l'icône d'app, pas une
// couleur de thème applicative — elle n'a donc pas sa place dans le bloc
// `@theme` de app/globals.css.
export const APP_THEME_COLOR = '#0E1016'
// Variante claire : sans elle, la barre de statut Android reste presque noire
// au-dessus de l'interface claire. Même valeur que le fond clair
// (`--color-bg`).
export const APP_THEME_COLOR_LIGHT = '#F3F2F6'

type Scheme = 'dark' | 'light' | 'system'

// Une entrée par `<meta name="theme-color">` ; en mode `system`, la media
// query laisse le navigateur suivre l'OS.
export function themeColorsFor(scheme: Scheme): { color: string; media?: string }[] {
  if (scheme === 'dark') return [{ color: APP_THEME_COLOR }]
  if (scheme === 'light') return [{ color: APP_THEME_COLOR_LIGHT }]
  return [
    { media: '(prefers-color-scheme: light)', color: APP_THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: APP_THEME_COLOR },
  ]
}

export function colorSchemeFor(scheme: Scheme): 'dark' | 'light' | 'light dark' {
  if (scheme === 'system') return 'light dark'
  return scheme
}
