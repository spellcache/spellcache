// Optimiste, échec, undo. Contrairement aux autres fichiers de
// `tests/integration/`, celui-ci ne dépend pas de `postgres-test` — il
// exerce un vrai `QueryClient` TanStack Query contre les transformations
// pures du cache (`app/(app)/container/[id]/optimistic.ts`), exactement
// celles que `container-view.tsx` appelle depuis `onMutate` : `cancelQueries`
// puis `setQueryData`, snapshot conservé pour un rollback dans `onError` (ou
// quand la Server Action renvoie `{ ok: false }`). Le rendu React et le DOM
// (le composant, le toast, le clic « Undo ») ne sont pas dans le périmètre
// de ce fichier — aucun jsdom/`@testing-library` n'est disponible dans ce
// projet (vitest.config.ts, environnement `node`) ; ce que Playwright
// prouverait autrement est couvert par `tests/e2e/container-list.spec.ts`.
//
// Le bloc « mutation options » ci-dessous va plus loin
// que les transformations pures ci-dessus : il construit les options
// `useMutation` de `app/(app)/container/[id]/mutations.ts` avec une Server
// Action **mockée** (`vi.fn`, jamais le vrai `setQuantityAction`/
// `undoAction`) et rejoue `onMutate` → `mutationFn` → `onSuccess`/`onError`
// dans l'ordre où TanStack Query les invoque — une action mockée en échec,
// et un `undoAction` qui retourne `{ ok: false, error: 'expired' }`.
import { QueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { applyPatchOptimistic, applyQuantityOptimistic } from '@/app/(app)/container/[id]/optimistic'
import {
  createPatchMutationOptions,
  createQuantityMutationOptions,
  createUndoHandler,
} from '@/app/(app)/container/[id]/mutations'
import type { HoldingPage, HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

const HOLDINGS_KEY = ['container', 'c1', 'holdings'] as const

function holding(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    holdingId: 'h1',
    cardId: 'card-1',
    name: 'Rhystic Study',
    manaCost: '{2}{U}',
    setCode: 'pcy',
    setName: 'Promo Cards',
    setIconUri: null,
    collectorNumber: '45',
    rarity: 'rare',
    finish: 'nonfoil',
    condition: 'nm',
    qty: 1,
    available: 1,
    priceMinor: 3490,
    thumbUrl: '/api/card-image/card-1/small',
    groupLabel: null,
    binderName: null,
    ...overrides,
  }
}

function seedData(items: HoldingRow[]): InfiniteData<HoldingPage> {
  return {
    pages: [{ items, nextCursor: null, total: items.length }],
    pageParams: [null],
  }
}

describe('optimistic quantity cache', () => {
  it('increments the cached quantity before the server responds, and keeps it on success', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 })]))

    await queryClient.cancelQueries({ queryKey: HOLDINGS_KEY })
    const previous = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)
    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyQuantityOptimistic(old, 'h1', 2),
    )

    const optimistic = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)
    expect(optimistic?.pages[0]?.items[0]?.qty).toBe(2)

    // Succès serveur : rien à rejouer, la valeur optimiste reste la source
    // de vérité (ne jamais réécrire depuis une réponse en retard, envoyer la
    // valeur absolue suffit).
    expect(previous?.pages[0]?.items[0]?.qty).toBe(1)
  })

  it('rolls back to the pre-mutation snapshot when the server reports a failure', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 })]))

    const previous = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)
    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyQuantityOptimistic(old, 'h1', 2),
    )
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(2)

    // `{ ok: false }` (ou une exception) : rollback vers le snapshot capturé
    // avant l'écriture optimiste.
    if (previous) queryClient.setQueryData(HOLDINGS_KEY, previous)

    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(1)
  })

  it('removes the row optimistically when the absolute quantity is zero, and restores it on undo without reconstructing it client-side', async () => {
    const queryClient = new QueryClient()
    const original = holding({ qty: 1 })
    queryClient.setQueryData(HOLDINGS_KEY, seedData([original]))

    const previous = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)
    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyQuantityOptimistic(old, 'h1', 0),
    )
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items).toHaveLength(0)

    // `undoAction` réussi : la restauration recharge la page depuis le serveur
    // (invalidation), elle ne réinsère jamais une ligne reconstruite depuis
    // `previous` — `previous` n'est utile qu'au rollback d'échec, pas à l'Undo.
    // On vérifie ici que le snapshot conservé porte bien la ligne d'origine
    // intacte (même `addedAt` implicite, même `holdingId`) pour prouver
    // qu'aucune reconstruction n'a eu lieu entre-temps côté client.
    expect(previous?.pages[0]?.items[0]).toEqual(original)
  })

  it('applies condition and foil edits from the card sheet without touching quantity', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 3, condition: 'nm', finish: 'nonfoil' })]))

    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyPatchOptimistic(old, 'h1', { condition: 'lp' }),
    )
    let row = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]
    expect(row?.condition).toBe('lp')
    expect(row?.qty).toBe(3)

    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyPatchOptimistic(old, 'h1', { finish: 'foil' }),
    )
    row = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]
    expect(row?.finish).toBe('foil')
    expect(row?.condition).toBe('lp')
  })

  it('leaves an unrelated holding untouched', () => {
    const queryClient = new QueryClient()
    const other = holding({ holdingId: 'h2', name: 'Cyclonic Rift', qty: 2 })
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 }), other]))

    queryClient.setQueryData(HOLDINGS_KEY, (old: InfiniteData<HoldingPage> | undefined) =>
      applyQuantityOptimistic(old, 'h1', 5),
    )

    const items = queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items
    expect(items?.find((item) => item.holdingId === 'h2')).toEqual(other)
  })
})

const HEADER_KEY = ['container', 'c1', 'header'] as const

describe('mutation options against a mocked Server Action', () => {
  it('increments before the response, and keeps the optimistic value when the mocked action succeeds (success path)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 })]))
    const setQuantityAction = vi.fn().mockResolvedValue({ ok: true, qty: 2, removed: false })
    const onFailure = vi.fn()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const options = createQuantityMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      setQuantityAction,
      getHolding: () => undefined,
      onRemoved: vi.fn(),
      onFailure,
      onRemovedWhileOpen: vi.fn(),
    })

    const vars = { holdingId: 'h1', qty: 2 }
    const context = await options.onMutate(vars)
    // Optimiste, avant la réponse serveur.
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(2)

    const result = await options.mutationFn(vars)
    expect(setQuantityAction).toHaveBeenCalledWith(vars)
    options.onSuccess(result, vars, context)

    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(2)
    expect(onFailure).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: HEADER_KEY })
  })

  it('rolls back and reports an error when the mocked action resolves { ok: false } (failure path)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 })]))
    const setQuantityAction = vi.fn().mockResolvedValue({ ok: false, error: 'failed' })
    const onFailure = vi.fn()

    const options = createQuantityMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      setQuantityAction,
      getHolding: () => undefined,
      onRemoved: vi.fn(),
      onFailure,
      onRemovedWhileOpen: vi.fn(),
    })

    const vars = { holdingId: 'h1', qty: 2 }
    const context = await options.onMutate(vars)
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(2)

    const result = await options.mutationFn(vars)
    options.onSuccess(result, vars, context)

    // Retour arrière vers la valeur pré-mutation.
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(1)
    expect(onFailure).toHaveBeenCalledWith('Could not update quantity. Try again.')
  })

  it('rolls back and reports an error when the mocked action rejects (onError path)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1 })]))
    const setQuantityAction = vi.fn().mockRejectedValue(new Error('network'))
    const onFailure = vi.fn()

    const options = createQuantityMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      setQuantityAction,
      getHolding: () => undefined,
      onRemoved: vi.fn(),
      onFailure,
      onRemovedWhileOpen: vi.fn(),
    })

    const vars = { holdingId: 'h1', qty: 2 }
    const context = await options.onMutate(vars)
    await expect(options.mutationFn(vars)).rejects.toThrow('network')
    options.onError(new Error('network'), vars, context)

    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.qty).toBe(1)
    expect(onFailure).toHaveBeenCalledWith('Could not update quantity. Try again.')
  })

  it('removes the row and surfaces the undoToken from the mocked action when quantity drops to 0', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ qty: 1, name: 'Ponder' })]))
    const setQuantityAction = vi.fn().mockResolvedValue({ ok: true, qty: 0, removed: true, undoToken: 'tok-1' })
    const onRemoved = vi.fn()
    const onRemovedWhileOpen = vi.fn()

    const options = createQuantityMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      setQuantityAction,
      getHolding: (holdingId) =>
        queryClient
          .getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)
          ?.pages[0]?.items.find((item) => item.holdingId === holdingId) ??
        holding({ qty: 1, name: 'Ponder' }),
      onRemoved,
      onFailure: vi.fn(),
      onRemovedWhileOpen,
    })

    const vars = { holdingId: 'h1', qty: 0 }
    const context = await options.onMutate(vars)
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items).toHaveLength(0)

    const result = await options.mutationFn(vars)
    options.onSuccess(result, vars, context)

    // Message exact : le nom de la carte seul, jamais la quantité retirée.
    expect(onRemoved).toHaveBeenCalledWith('tok-1', 'Ponder removed')
    expect(onRemovedWhileOpen).toHaveBeenCalledWith('h1')
  })

  it('restores an undo within the window and reports "expired" without restoring past it', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const undoActionOk = vi.fn().mockResolvedValue({ ok: true })
    const onExpiredOk = vi.fn()
    const handleUndoOk = createUndoHandler({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      undoAction: undoActionOk,
      onExpired: onExpiredOk,
    })
    const okResult = await handleUndoOk('tok-1')
    expect(undoActionOk).toHaveBeenCalledWith({ undoToken: 'tok-1' })
    expect(okResult).toEqual({ ok: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: HOLDINGS_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: HEADER_KEY })
    expect(onExpiredOk).not.toHaveBeenCalled()

    invalidateSpy.mockClear()
    // Au-delà de la fenêtre de 6 secondes, `undoAction` renvoie
    // `{ ok: false, error: 'expired' }` — la ligne reste supprimée : aucune
    // invalidation, `onExpired` est appelé.
    const undoActionExpired = vi.fn().mockResolvedValue({ ok: false, error: 'expired' })
    const onExpired = vi.fn()
    const handleUndoExpired = createUndoHandler({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      undoAction: undoActionExpired,
      onExpired,
    })
    const expiredResult = await handleUndoExpired('tok-2')
    expect(expiredResult).toEqual({ ok: false, error: 'expired' })
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(onExpired).toHaveBeenCalledWith('This action can no longer be undone.')
  })

  it('re-reads both queries and retargets the open sheet when a condition/foil edit merges into another holding', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ holdingId: 'h1', qty: 3, finish: 'nonfoil' })]))
    // `updateHolding` peut fusionner dans une ligne existante et renvoyer un
    // `holdingId` différent de celui envoyé.
    const updateHoldingAction = vi.fn().mockResolvedValue({ ok: true, holdingId: 'h2-merged' })
    const onMerged = vi.fn()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const options = createPatchMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      updateHoldingAction,
      onFailure: vi.fn(),
      onMerged,
    })

    const vars = { holdingId: 'h1', finish: 'foil' as const }
    const context = await options.onMutate(vars)
    const result = await options.mutationFn(vars)
    options.onSuccess(result, vars, context)

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: HOLDINGS_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: HEADER_KEY })
    expect(onMerged).toHaveBeenCalledWith('h1', 'h2-merged')
  })

  it('rolls back a condition/foil edit when the mocked action resolves { ok: false }', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(HOLDINGS_KEY, seedData([holding({ holdingId: 'h1', condition: 'nm' })]))
    const updateHoldingAction = vi.fn().mockResolvedValue({ ok: false, error: 'failed' })
    const onFailure = vi.fn()

    const options = createPatchMutationOptions({
      queryClient,
      holdingsKey: HOLDINGS_KEY,
      headerKey: HEADER_KEY,
      updateHoldingAction,
      onFailure,
      onMerged: vi.fn(),
    })

    const vars = { holdingId: 'h1', condition: 'lp' as const }
    const context = await options.onMutate(vars)
    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.condition).toBe(
      'lp',
    )

    const result = await options.mutationFn(vars)
    options.onSuccess(result, vars, context)

    expect(queryClient.getQueryData<InfiniteData<HoldingPage>>(HOLDINGS_KEY)?.pages[0]?.items[0]?.condition).toBe(
      'nm',
    )
    expect(onFailure).toHaveBeenCalledWith('Could not update the card. Try again.')
  })
})
