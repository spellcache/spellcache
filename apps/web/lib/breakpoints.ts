// Points de bascule de la mise en page — déclarés **une seule fois** : trois
// valeurs codées en dur dans trois composants sont la façon classique de
// casser le responsive.
//
// Ces deux nombres ont un jumeau CSS : `--breakpoint-desktop` et
// `--breakpoint-pane` dans le bloc `@theme` de `app/globals.css`, qui
// produisent les variantes Tailwind `desktop:` et `pane:`. La mise en page
// elle-même est choisie par CSS (choisir la disposition avec un `useEffect` sur
// `window.innerWidth` provoque un saut au premier rendu) ; le JavaScript ne lit
// ces valeurs que pour les *comportements* qui l'exigent — quel composant
// monter (feuille contre popover), et quel sous-arbre élaguer du DOM une fois
// hydraté. `tests/unit/theme.test.ts` échoue si les deux sources divergent d'un
// pixel. 900 (et non 768) : à 800px de large on reste sur la coquille mobile
// (barre d'onglets), pas la barre latérale. `tablet` (768, jumeau de
// `--breakpoint-tablet`) sépare un téléphone d'une tablette pour masquer les
// réglages sans effet sur téléphone.
export const BREAKPOINTS = { tablet: 768, mobile: 900, previewPane: 1280 } as const

export type BreakpointName = keyof typeof BREAKPOINTS

// Un seul endroit qui sait écrire la media query, pour que le JS interroge
// exactement le même seuil que la feuille compilée.
export function minWidthQuery(minWidth: number): string {
  return `(min-width: ${minWidth}px)`
}
