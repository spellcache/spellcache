'use client'

// Lecture d'un point de bascule *pour le comportement seulement* — jamais
// pour la mise en page, qui est décidée par les variantes
// `desktop:`/`pane:` de la feuille compilée.
//
// Trois raisons de ne pas utiliser `useEffect` + `window.innerWidth` :
// le premier rendu serait faux puis corrigé (un saut visible), un écouteur `resize` se déclenche à chaque pixel, et deux
// composants finiraient par recopier le seuil. Ici : `useSyncExternalStore`
// au-dessus de `matchMedia`, abonné à l'évènement `change` de la requête
// elle-même, et le seuil vient toujours de `BREAKPOINTS`.
//
// **Le retour est tri-état, et c'est le cœur de la résolution du critère
// #1.** `null` = « pas encore hydraté, la question n'a pas de réponse côté
// serveur ». Un appelant qui doit garantir l'absence d'un élément du DOM
// sous 768px écrit donc `value !== false` pour décider de le *rendre* :
//
//   - rendu serveur et premier rendu client → `null` → l'élément est rendu,
//     et c'est la classe `hidden desktop:flex` qui décide s'il se voit. La
//     première peinture est donc correcte à toutes les largeurs, avant même
//     que JavaScript ne s'exécute — aucun saut.
//   - après hydratation → `true`/`false`. À 375px l'élément est démonté ;
//     comme le CSS le masquait déjà, ce démontage est visuellement un
//     non-évènement, mais le DOM, lui, n'en porte plus la moindre trace
//     (aucun élément de barre latérale dans le DOM).
//
// Les deux branches ne peuvent pas se contredire : elles interrogent le même
// nombre.
import { useCallback, useSyncExternalStore } from 'react'

import { minWidthQuery } from '@/lib/breakpoints'

export function useMinWidth(minWidth: number): boolean | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(minWidthQuery(minWidth))
      mql.addEventListener('change', onStoreChange)
      return () => mql.removeEventListener('change', onStoreChange)
    },
    [minWidth],
  )

  const getSnapshot = useCallback(
    () => window.matchMedia(minWidthQuery(minWidth)).matches,
    [minWidth],
  )

  // React appelle celui-ci pour le rendu serveur *et* pour le rendu
  // d'hydratation, ce qui garantit que les deux produisent le même HTML.
  const getServerSnapshot = useCallback(() => null, [])

  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, getServerSnapshot)
}
