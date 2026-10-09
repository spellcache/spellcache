'use client'

// Contexte de sélection éphémère (la persister — URL, localStorage —
// contredirait le design). Monté une seule fois, à la racine de
// `app/(app)/layout.tsx` (la barre d'onglets doit disparaître du DOM
// pendant la sélection — décision qui n'a de sens qu'au même niveau que
// `TabBar`, pas depuis l'écran de container qui est son descendant) : tout
// composant sous ce niveau peut lire/écrire la sélection avec `useSelection`,
// et le layout lui-même ne consomme que `active` pour décider quoi rendre en
// bas d'écran — jamais `holdingId`/`containerId`, qui restent un détail de
// l'écran de container.
//
// Sort de sélection sur trois déclencheurs :
// `clear()` explicite, `Échap` (écouteur clavier ici, actif seulement tant
// que `active`), et la navigation (`usePathname()` — un changement de route
// vide la sélection, jamais republiée après un retour arrière).
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useBackToClose } from '@/components/ui/use-back-to-close'

export interface SelectionState {
  active: boolean
  ids: ReadonlySet<string>
  // `true` après « Select all » : la vue entière est visée, y compris les
  // lignes non encore chargées — `ids` continue de porter
  // les lignes explicitement basculées avant cet appel, mais l'écran de
  // container doit lire `allMatching` en priorité pour l'affichage et
  // l'action groupée.
  allMatching: boolean
  toggle(id: string): void
  enter(id: string): void
  clear(): void
  selectAllMatching(): void
  // Plage contiguë entre l'ancre et la ligne cliquée (`Shift`+clic) — une
  // seule écriture d'état pour toute la plage,
  // jamais une boucle de `toggle` : `toggle` est un basculement, rejouer
  // 40 fois de suite désélectionnerait tout ce qui était déjà pris.
  // L'ancre elle-même vit dans la liste (`components/cards/virtual-list.tsx`),
  // qui seule connaît l'ordre affiché.
  selectRange(ids: readonly string[]): void
}

const SelectionContext = createContext<SelectionState | null>(null)

// `ids` et `allMatching` vivent dans un seul `useState` — pas deux états
// séparés synchronisés par un `setX` imbriqué dans
// l'updater d'un autre `setY` : un updater qui a un effet de bord sur un
// *autre* état n'est plus pur, et React StrictMode double-invoque chaque
// updater fonctionnel pour détecter exactement ça — `toggle` rejouerait
// alors `setIds` deux fois et s'annulerait lui-même. `toggle` ci-dessous ne
// fait qu'un seul appel de `setState`, avec un updater qui ne lit et ne
// modifie que sa propre valeur précédente : double-invoqué ou non, il
// produit le même résultat.
interface SelectionIds {
  ids: ReadonlySet<string>
  allMatching: boolean
}

const EMPTY_SELECTION_IDS: SelectionIds = { ids: new Set(), allMatching: false }

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectionIds, setSelectionIds] = useState<SelectionIds>(EMPTY_SELECTION_IDS)
  const [active, setActive] = useState(false)
  const pathname = usePathname()
  const previousPathnameRef = useRef(pathname)

  const clear = useCallback(() => {
    setActive(false)
    setSelectionIds(EMPTY_SELECTION_IDS)
  }, [])

  // Retour Android : quitte la sélection plutôt que l'écran.
  useBackToClose(active, clear)

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return
    previousPathnameRef.current = pathname
    clear()
  }, [pathname, clear])

  useEffect(() => {
    if (!active) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Une feuille Radix ouverte (`Dialog.Content`, `role="dialog"` —
      // `components/ui/sheet.tsx`) intercepte déjà `Échap` pour se refermer
      // elle-même, mais son `DismissableLayer` ne stoppe pas la propagation
      // de l'évènement natif jusqu'à ce `document.addEventListener` : sans
      // cette garde, `Échap` fermerait la
      // feuille *et* viderait la sélection en même temps, forçant
      // une reconstruction complète pour rouvrir `Edit`. Écouté en phase de
      // capture pour lire le DOM avant que Radix ne démonte la feuille —
      // tant qu'un dialogue est présent, on lui laisse gérer sa propre
      // fermeture ; un second `Échap`, sans dialogue ouvert, videra la
      // sélection normalement.
      if (document.querySelector('[role="dialog"]')) return
      clear()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [active, clear])

  const enter = useCallback((id: string) => {
    setActive(true)
    setSelectionIds({ ids: new Set([id]), allMatching: false })
  }, [])

  const toggle = useCallback((id: string) => {
    // Un seul `setState`, lu et calculé uniquement à partir de sa propre
    // valeur précédente (`current`) — un tap juste après « Select all » ne
    // peut pas exprimer « tout sauf celle-ci » (`BulkTarget` porte
    // `holdingIds` ou `matching`, jamais les deux,
    // et aucune liste d'exclusion). Redémarrer la sélection sur cette seule
    // ligne est le seul état qui reste cohérent avec ce qui est affiché à
    // l'écran — garder les ids de présélection antérieurs à `allMatching`
    // ferait silencieusement chuter le compteur du total filtré à quelques
    // ids alors que chaque ligne continuerait de s'afficher sélectionnée
    // (`selected = allMatching || ids.has(id)`).
    setSelectionIds((current) => {
      if (current.allMatching) {
        return { ids: new Set([id]), allMatching: false }
      }
      const next = new Set(current.ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ids: next, allMatching: false }
    })
  }, [])

  const selectRange = useCallback((ids: readonly string[]) => {
    setActive(true)
    setSelectionIds({ ids: new Set(ids), allMatching: false })
  }, [])

  const selectAllMatching = useCallback(() => {
    setActive(true)
    // Toute présélection individuelle antérieure (entrée par appui long,
    // puis quelques bascules avant « Select all ») devient sans objet dès
    // que la vue entière est visée — la vider évite qu'elle ne resurgisse
    // comme reliquat lors du prochain `toggle` (voir ci-dessus).
    setSelectionIds({ ids: new Set(), allMatching: true })
  }, [])

  const value = useMemo<SelectionState>(
    () => ({
      active,
      ids: selectionIds.ids,
      allMatching: selectionIds.allMatching,
      toggle,
      enter,
      clear,
      selectAllMatching,
      selectRange,
    }),
    [active, selectionIds, toggle, enter, clear, selectAllMatching, selectRange],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionState {
  const context = useContext(SelectionContext)
  if (!context) throw new Error('useSelection must be used within a SelectionProvider.')
  return context
}
