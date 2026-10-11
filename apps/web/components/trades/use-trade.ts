'use client'

// État partagé d'un écran d'échange : l'échange lui-même (TanStack Query,
// relu toutes les 5 secondes tant qu'un échange entre comptes est ouvert —
// l'autre partie modifie ses lignes ou accepte de son côté), et l'exécution
// des écritures : une à la fois, message d'erreur lisible, relecture dans
// tous les cas.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  getTradeAction,
  type TradeActionError,
  type TradeActionResult,
} from '@/app/(app)/tools/trade/actions'
import type { TradeView } from '@/lib/trades/trades'

const POLL_MS = 5_000

export const TRADE_ERROR_MESSAGE: Record<TradeActionError, string> = {
  stale: 'The trade changed in the meantime. Review it again before confirming.',
  unavailable: 'Some cards are no longer available in that quantity.',
  not_open: 'This trade is closed.',
  forbidden: 'You cannot change this trade.',
  empty: 'Add at least one card first.',
  not_found: 'This trade no longer exists.',
  expired: 'Too late to undo. The trade stays applied.',
  invalid: 'Something went wrong. Please try again.',
}

export function tradeKey(id: string) {
  return ['trade', id] as const
}

export function useTrade(initial: TradeView, options: { paused?: boolean } = {}) {
  const queryClient = useQueryClient()
  const key = tradeKey(initial.id)
  const { data: trade } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await getTradeAction({ tradeId: initial.id })
      if (!result.ok) throw new Error(result.error)
      return result.trade
    },
    initialData: initial,
    refetchInterval: (query) =>
      !options.paused &&
      query.state.data?.mode === 'account' &&
      query.state.data.status === 'open'
        ? POLL_MS
        : false,
  })

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: key })
  }

  async function mutate<T extends object>(
    action: () => Promise<TradeActionResult<T>>,
  ): Promise<TradeActionResult<T> | null> {
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(TRADE_ERROR_MESSAGE[result.error])
      return result
    } catch {
      setError(TRADE_ERROR_MESSAGE.invalid)
      return null
    } finally {
      setPending(false)
      await refresh()
    }
  }

  // Écriture optimiste d'une quantité : appliquée tout de suite au cache,
  // annulée si le serveur refuse.
  async function optimistic(
    patch: (current: TradeView) => TradeView,
    action: () => Promise<TradeActionResult>,
  ) {
    await queryClient.cancelQueries({ queryKey: key })
    const previous = queryClient.getQueryData<TradeView>(key)
    queryClient.setQueryData<TradeView>(key, (current) => current && patch(current))
    const result = await action().catch(() => null)
    if (!result?.ok) {
      queryClient.setQueryData(key, previous)
      setError(TRADE_ERROR_MESSAGE[result && !result.ok ? result.error : 'invalid'])
    }
    await refresh()
  }

  return { trade, mutate, optimistic, pending, error, setError, refresh }
}

// Exécute une écriture avec la gestion d'erreur de l'écran ; `true` si elle a réussi.
export type RunAction = (
  action: () => Promise<TradeActionResult<object>>,
) => Promise<boolean>

export type TradeStep = 'who' | 'cards' | 'theirs' | 'extras'

// Étapes du parcours selon qui remplit quoi : en personne, l'initiateur
// saisit les deux côtés ; entre comptes, chacun ne saisit que ce qu'il donne
// (l'initiateur envoie son offre dès l'étape des cartes).
export function stepsFor(trade: Pick<TradeView, 'mode' | 'me'>): TradeStep[] {
  if (trade.mode === 'in_person') return ['who', 'cards', 'theirs', 'extras']
  return trade.me === 'initiator' ? ['who', 'cards'] : ['cards', 'extras']
}
