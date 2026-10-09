// Transformations pures du cache de holdings : annuler les requêtes en vol…
// puis écrire le cache, rollback dans `onError`.
// Extraites de `container-view.tsx` pour rester vérifiables sans moteur de
// rendu React (`tests/integration/quantities.test.ts`, un vrai `QueryClient`
// TanStack Query en environnement Node, sans DOM) — le composant les
// consomme telles quelles dans `onMutate`.
import type { InfiniteData } from '@tanstack/react-query'

import type { Condition, Finish } from '@spellcache/db/schema'

import type { HoldingPage } from './holdings-data'

type HoldingsData = InfiniteData<HoldingPage | { error: 'invalid_cursor' }>

// Valeur absolue, jamais un delta. `qty <= 0` retire la ligne, exactement le
// contrat de `setQuantityAction`/`setHoldingQuantity`.
export function applyQuantityOptimistic(
  data: HoldingsData | undefined,
  holdingId: string,
  qty: number,
): HoldingsData | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) =>
      'error' in page
        ? page
        : {
            ...page,
            items:
              qty <= 0
                ? page.items.filter((item) => item.holdingId !== holdingId)
                : page.items.map((item) => (item.holdingId === holdingId ? { ...item, qty } : item)),
          },
    ),
  }
}

// Cible d'une action groupée côté client (même forme que `BulkTarget`,
// réduite aux champs qu'un optimiste peut exploiter) :
// `holdingIds` présent ⇒ sélection explicite, connue au pixel ; absent ⇒
// « Select all » (`matching`), dont l'optimiste ne peut recenser que ce qui
// est déjà chargé dans ce cache — mais tout ce qui y figure correspond déjà
// à la vue filtrée courante par construction (`holdingsQuery`), donc « tout
// ce qui est chargé » est le bon sous-ensemble à traiter en attendant la
// réponse serveur.
interface BulkOptimisticTarget {
  holdingIds?: string[]
}

// Suppression groupée (docs/development.md « mises à jour
// optimistes sur toutes les quantités, avec retour arrière en cas d'échec ») :
// même patron `cancelQueries` → `setQueryData` → rollback que les mutations
// unitaires ci-dessus, pour que les lignes supprimées disparaissent
// immédiatement plutôt que de persister jusqu'au prochain `invalidateQueries`.
export function applyBulkDeleteOptimistic(
  data: HoldingsData | undefined,
  target: BulkOptimisticTarget,
): HoldingsData | undefined {
  if (!data) return data
  const ids = target.holdingIds ? new Set(target.holdingIds) : null
  return {
    ...data,
    pages: data.pages.map((page) =>
      'error' in page ? page : { ...page, items: ids ? page.items.filter((item) => !ids.has(item.holdingId)) : [] },
    ),
  }
}

export interface BulkEditOptimisticPatch {
  qty?: number
  condition?: Condition
  finish?: Finish
  targetContainerId?: string
}

// Édition groupée (même patron ci-dessus). `targetContainerId` (Move/Add to
// deck) déplace la ligne hors de ce container : dans *cette*
// vue, l'effet optimiste correct est une disparition, pas une mise à jour de
// champs — la ligne réapparaît, à jour, dans la vue du container de
// destination au prochain chargement.
export function applyBulkEditOptimistic(
  data: HoldingsData | undefined,
  target: BulkOptimisticTarget,
  patch: BulkEditOptimisticPatch,
): HoldingsData | undefined {
  if (!data) return data
  if (patch.targetContainerId) return applyBulkDeleteOptimistic(data, target)

  const ids = target.holdingIds ? new Set(target.holdingIds) : null
  return {
    ...data,
    pages: data.pages.map((page) =>
      'error' in page
        ? page
        : {
            ...page,
            items: page.items.map((item) =>
              !ids || ids.has(item.holdingId)
                ? {
                    ...item,
                    ...(patch.qty !== undefined && { qty: patch.qty }),
                    ...(patch.condition !== undefined && { condition: patch.condition }),
                    ...(patch.finish !== undefined && { finish: patch.finish }),
                  }
                : item,
            ),
          },
    ),
  }
}

export function applyPatchOptimistic(
  data: HoldingsData | undefined,
  holdingId: string,
  patch: { condition?: Condition; finish?: Finish },
): HoldingsData | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) =>
      'error' in page
        ? page
        : {
            ...page,
            items: page.items.map((item) =>
              item.holdingId === holdingId
                ? {
                    ...item,
                    condition: patch.condition ?? item.condition,
                    finish: patch.finish ?? item.finish,
                  }
                : item,
            ),
          },
    ),
  }
}
