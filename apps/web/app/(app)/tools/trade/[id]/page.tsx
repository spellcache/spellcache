// Écran d'un échange. Composant serveur : gardes de session et d'outil, puis
// lecture de l'échange — un échange inconnu ou dont le compte n'est pas
// partie répond 404, sans distinction.
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { getTradeView, TradeError } from '@/lib/trades/trades'

import { TradeScreen } from './trade-screen'

const stepSchema = z.enum(['cards', 'theirs', 'extras'])

export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ step?: string | string[] }>
}) {
  const { id } = await params
  const step = stepSchema.safeParse((await searchParams).step)
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.trading_mode) notFound()
  if (!z.uuid().safeParse(id).success) notFound()

  try {
    const trade = await getTradeView(session.id, id)
    return <TradeScreen initial={trade} step={step.success ? step.data : null} />
  } catch (error) {
    if (error instanceof TradeError && error.code === 'not_found') notFound()
    throw error
  }
}
