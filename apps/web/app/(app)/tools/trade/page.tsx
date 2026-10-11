// Trading mode — échanges en cours et historique. Composant serveur : garde de
// session puis garde d'outil, comme `/tools/life` — la route répond 404 tant
// que l'outil est éteint.
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { listTrades } from '@/lib/trades/trades'

import { TradesView } from './trades-view'

export default async function TradesPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.tradingMode) notFound()

  const trades = await listTrades(session.id)
  return <TradesView trades={trades} />
}
