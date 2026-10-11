// Écran d'un échange. Composant serveur : gardes de session et d'outil, puis
// lecture de l'échange — un échange inconnu ou dont le compte n'est pas
// partie répond 404, sans distinction.
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { getTradeView, TradeError } from '@/lib/trades/trades'

import { TradeScreen } from './trade-screen'

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.tradingMode) notFound()
  if (!z.uuid().safeParse(id).success) notFound()

  try {
    const trade = await getTradeView(session.id, id)
    return <TradeScreen initial={trade} />
  } catch (error) {
    if (error instanceof TradeError && error.code === 'not_found') notFound()
    throw error
  }
}
