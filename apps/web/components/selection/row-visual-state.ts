// Deux états visuels distincts pour une même ligne de liste :
//
//  - `selected` — la ligne appartient à la sélection groupée. Elle
//    seule porte la coche blanche de la case ronde, et le compteur
//    `N selected` de l'en-tête de sélection compte exactement ces
//    lignes-là.
//  - `current` — la ligne dont le panneau d'aperçu desktop affiche la carte
//    (sélectionner une ligne le remplit). Le design la dessine
//    sélectionnée **sans** être sélectionnable : fond `#161d2e` et bordure
//    accent, mais aucune case donc aucune coche.
//
// Un premier passage confondait les deux (`selected={… || id ===
// selectedHoldingId}`) : la ligne courante du panneau restait cochée après
// `Cancel`, et `2 selected` s'affichait au-dessus de trois lignes cochées,
// juste avant une suppression groupée. Les deux états ne coexistent jamais :
// tant qu'une sélection est active, la ligne courante rend sa surbrillance à
// la sélection, seule à parler à ce moment-là — plutôt que d'inventer un
// troisième traitement absent du design (docs/development.md).
export interface RowVisualState {
  selected: boolean
  current: boolean
}

export function rowVisualState({
  holdingId,
  selectionActive,
  allMatching,
  selectedIds,
  currentHoldingId,
}: {
  holdingId: string
  selectionActive: boolean
  allMatching: boolean
  selectedIds: ReadonlySet<string>
  currentHoldingId: string | null
}): RowVisualState {
  const selected = allMatching || selectedIds.has(holdingId)
  return {
    selected,
    current: !selectionActive && holdingId === currentHoldingId,
  }
}
