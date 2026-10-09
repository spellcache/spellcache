// Options `useMutation` extraites de `container-view.tsx` (cancelQueries puis
// setQueryData, rollback dans onError). Extraites en fonctions pures — même patron que
// `optimistic.ts` — pour rester exerçables sans moteur de rendu React :
// `tests/integration/quantities.test.ts` construit ces options avec une
// Server Action mockée (jamais le vrai `setQuantityAction`/`undoAction`) et
// rejoue `onMutate` → `mutationFn` → `onSuccess`/`onError` dans l'ordre où
// TanStack Query les invoque, sans jsdom (aucun disponible dans ce projet,
// voir le commentaire d'en-tête de `quantities.test.ts`).
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import type { Condition, Finish } from '@spellcache/db/schema'
import type { BulkTarget } from '@/lib/containers/bulk'

import { applyBulkDeleteOptimistic, applyBulkEditOptimistic, applyPatchOptimistic, applyQuantityOptimistic } from './optimistic'
import type { BulkActionResult } from './bulk-actions'
import type { HoldingPage, HoldingRow } from './holdings-data'

export type SetQuantityResult =
  | { ok: true; qty: number; removed: boolean; undoToken?: string }
  | { ok: false; error: string }

export type UpdateHoldingResult = { ok: true; holdingId: string } | { ok: false; error: string }

export type UndoResult = { ok: true } | { ok: false; error: 'expired' }

type HoldingsData = InfiniteData<HoldingPage | { error: 'invalid_cursor' }>

interface MutationContext {
  previous: HoldingsData | undefined
}

function rollback(queryClient: QueryClient, holdingsKey: QueryKey, previous: HoldingsData | undefined) {
  if (previous) queryClient.setQueryData(holdingsKey, previous)
}

// `+`/`−`/suppression d'une ligne. La valeur envoyée est toujours absolue,
// jamais un delta.
export function createQuantityMutationOptions(deps: {
  queryClient: QueryClient
  holdingsKey: QueryKey
  headerKey: QueryKey
  setQuantityAction: (input: { holdingId: string; qty: number }) => Promise<SetQuantityResult>
  getHolding: (holdingId: string) => HoldingRow | undefined
  onRemoved: (undoToken: string, message: string) => void
  onFailure: (message: string) => void
  onRemovedWhileOpen: (holdingId: string) => void
}) {
  return {
    mutationFn: (vars: { holdingId: string; qty: number }) => deps.setQuantityAction(vars),
    onMutate: async (vars: { holdingId: string; qty: number }): Promise<MutationContext> => {
      // Annule les requêtes en vol sur cette clé avant d'écrire le cache,
      // sinon une réponse tardive écrase la valeur optimiste.
      await deps.queryClient.cancelQueries({ queryKey: deps.holdingsKey })
      const previous = deps.queryClient.getQueryData<HoldingsData>(deps.holdingsKey)

      deps.queryClient.setQueryData(deps.holdingsKey, (old: HoldingsData | undefined) =>
        applyQuantityOptimistic(old, vars.holdingId, vars.qty),
      )

      return { previous }
    },
    onSuccess: (
      result: SetQuantityResult,
      vars: { holdingId: string; qty: number },
      context: MutationContext | undefined,
    ) => {
      if (!result.ok) {
        rollback(deps.queryClient, deps.holdingsKey, context?.previous)
        deps.onFailure('Could not update quantity. Try again.')
        return
      }
      // Le total et la valeur de l'en-tête sont relus après mutation, sans
      // rechargement complet de la page.
      void deps.queryClient.invalidateQueries({ queryKey: deps.headerKey })
      if (result.removed && result.undoToken) {
        // Message exact : le nom
        // de la carte seul, jamais la quantité retirée — même toast qu'une
        // suppression groupée d'une seule ligne (`bulkResultMessage`,
        // `container-view.tsx`) ne s'en distingue que par « card »/« cards ».
        const holding = deps.getHolding(vars.holdingId)
        const label = holding ? `${holding.name} removed` : 'Card removed'
        deps.onRemoved(result.undoToken, label)
      }
      if (result.removed || vars.qty <= 0) {
        deps.onRemovedWhileOpen(vars.holdingId)
      }
    },
    onError: (
      _error: unknown,
      _vars: { holdingId: string; qty: number },
      context: MutationContext | undefined,
    ) => {
      rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onFailure('Could not update quantity. Try again.')
    },
  }
}

// Condition et foil depuis la feuille de détail. Relit toujours la vérité
// serveur au succès : `updateHolding` peut fusionner la ligne dans une autre
// qui partage déjà la nouvelle clé condition/finish et renvoyer un
// `holdingId` différent — sans invalidation, la ligne optimiste resterait
// affichée sous l'ancien id (ligne fantôme, quantité non fusionnée) et le
// bandeau de valeur du header resterait périmé après un changement de foil.
export function createPatchMutationOptions(deps: {
  queryClient: QueryClient
  holdingsKey: QueryKey
  headerKey: QueryKey
  updateHoldingAction: (input: {
    holdingId: string
    condition?: Condition
    finish?: Finish
  }) => Promise<UpdateHoldingResult>
  onFailure: (message: string) => void
  onMerged: (fromHoldingId: string, toHoldingId: string) => void
}) {
  return {
    mutationFn: (vars: { holdingId: string; condition?: Condition; finish?: Finish }) =>
      deps.updateHoldingAction(vars),
    onMutate: async (vars: {
      holdingId: string
      condition?: Condition
      finish?: Finish
    }): Promise<MutationContext> => {
      await deps.queryClient.cancelQueries({ queryKey: deps.holdingsKey })
      const previous = deps.queryClient.getQueryData<HoldingsData>(deps.holdingsKey)

      deps.queryClient.setQueryData(deps.holdingsKey, (old: HoldingsData | undefined) =>
        applyPatchOptimistic(old, vars.holdingId, { condition: vars.condition, finish: vars.finish }),
      )

      return { previous }
    },
    onSuccess: (
      result: UpdateHoldingResult,
      vars: { holdingId: string; condition?: Condition; finish?: Finish },
      context: MutationContext | undefined,
    ) => {
      if (!result.ok) {
        rollback(deps.queryClient, deps.holdingsKey, context?.previous)
        deps.onFailure('Could not update the card. Try again.')
        return
      }
      void deps.queryClient.invalidateQueries({ queryKey: deps.holdingsKey })
      void deps.queryClient.invalidateQueries({ queryKey: deps.headerKey })
      if (result.holdingId !== vars.holdingId) {
        deps.onMerged(vars.holdingId, result.holdingId)
      }
    },
    onError: (
      _error: unknown,
      _vars: { holdingId: string; condition?: Condition; finish?: Finish },
      context: MutationContext | undefined,
    ) => {
      rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onFailure('Could not update the card. Try again.')
    },
  }
}

// Restauration d'une suppression : rejoue le jeton contre `undoAction` — ne
// reconstruit jamais la ligne côté client, l'invalidation recharge la vraie
// ligne serveur.
export function createUndoHandler(deps: {
  queryClient: QueryClient
  holdingsKey: QueryKey
  headerKey: QueryKey
  undoAction: (input: { undoToken: string }) => Promise<UndoResult>
  onExpired: (message: string) => void
}) {
  return async (undoToken: string): Promise<UndoResult> => {
    const result = await deps.undoAction({ undoToken })
    if (result.ok) {
      void deps.queryClient.invalidateQueries({ queryKey: deps.holdingsKey })
      void deps.queryClient.invalidateQueries({ queryKey: deps.headerKey })
    } else {
      deps.onExpired('This action can no longer be undone.')
    }
    return result
  }
}

// Suppression groupée (docs/development.md « mises à
// jour optimistes sur toutes les quantités, avec retour arrière en cas
// d'échec ») — même patron `cancelQueries` → `setQueryData` → rollback que
// les mutations unitaires ci-dessus. Un simple `invalidateQueries` après la
// réponse serveur laisserait les lignes supprimées affichées (et une édition
// groupée montrerait encore les anciennes valeurs) jusqu'au round-trip
// complet.
export function createBulkDeleteMutationOptions(deps: {
  queryClient: QueryClient
  holdingsKey: QueryKey
  headerKey: QueryKey
  bulkDeleteAction: (input: { target: BulkTarget }) => Promise<BulkActionResult>
  onResult: (result: BulkActionResult) => void
}) {
  return {
    mutationFn: (target: BulkTarget) => deps.bulkDeleteAction({ target }),
    onMutate: async (target: BulkTarget): Promise<MutationContext> => {
      await deps.queryClient.cancelQueries({ queryKey: deps.holdingsKey })
      const previous = deps.queryClient.getQueryData<HoldingsData>(deps.holdingsKey)
      deps.queryClient.setQueryData(deps.holdingsKey, (old: HoldingsData | undefined) =>
        applyBulkDeleteOptimistic(old, target),
      )
      return { previous }
    },
    onSuccess: (result: BulkActionResult, _target: BulkTarget, context: MutationContext | undefined) => {
      if (!result.ok) rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onResult(result)
      void deps.queryClient.invalidateQueries({ queryKey: deps.headerKey })
      if (result.ok) void deps.queryClient.invalidateQueries({ queryKey: deps.holdingsKey })
    },
    onError: (_error: unknown, _target: BulkTarget, context: MutationContext | undefined) => {
      rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onResult({ ok: false, error: 'failed' })
    },
  }
}

// Édition groupée — même patron. `edit` est envoyé tel quel à
// `bulkEditAction` (`BulkEdit`) et à
// `applyBulkEditOptimistic` : les champs laissés vides ne sont optimistement
// pas touchés, exactement le contrat de `BulkEditSheet`.
export function createBulkEditMutationOptions(deps: {
  queryClient: QueryClient
  holdingsKey: QueryKey
  headerKey: QueryKey
  bulkEditAction: (input: {
    target: BulkTarget
    edit: {
      qty?: number
      condition?: Condition
      finish?: Finish
      targetContainerId?: string
      language?: string
    }
  }) => Promise<BulkActionResult>
  onResult: (result: BulkActionResult) => void
}) {
  type Vars = {
    target: BulkTarget
    edit: {
      qty?: number
      condition?: Condition
      finish?: Finish
      targetContainerId?: string
      language?: string
    }
  }
  return {
    mutationFn: (vars: Vars) => deps.bulkEditAction(vars),
    onMutate: async (vars: Vars): Promise<MutationContext> => {
      await deps.queryClient.cancelQueries({ queryKey: deps.holdingsKey })
      const previous = deps.queryClient.getQueryData<HoldingsData>(deps.holdingsKey)
      deps.queryClient.setQueryData(deps.holdingsKey, (old: HoldingsData | undefined) =>
        applyBulkEditOptimistic(old, vars.target, vars.edit),
      )
      return { previous }
    },
    onSuccess: (result: BulkActionResult, _vars: Vars, context: MutationContext | undefined) => {
      if (!result.ok) rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onResult(result)
      void deps.queryClient.invalidateQueries({ queryKey: deps.headerKey })
      if (result.ok) void deps.queryClient.invalidateQueries({ queryKey: deps.holdingsKey })
    },
    onError: (_error: unknown, _vars: Vars, context: MutationContext | undefined) => {
      rollback(deps.queryClient, deps.holdingsKey, context?.previous)
      deps.onResult({ ok: false, error: 'failed' })
    },
  }
}
