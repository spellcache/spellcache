'use client'

// Liste des échanges : ceux qui attendent une réponse d'abord, puis ceux en
// cours, puis l'historique. Aucun langage visuel nouveau : `SettingsGroup` et
// `SettingRow`, comme Settings.
import { ArrowLeftRight, Handshake, UserRound } from 'lucide-react'
import { useState } from 'react'

import { NewTradeSheet } from '@/components/trades/new-trade-sheet'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { formatMoney } from '@/lib/format/money'
import type { TradeSummary } from '@/lib/trades/trades'

function deltaLabel(trade: TradeSummary): string {
  const delta = trade.getMinor - trade.giveMinor
  if (delta === 0) return 'Even'
  return `${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta), trade.currency)}`
}

function subtitleOf(trade: TradeSummary): string {
  const counts = `Give ${trade.giveCount} · Get ${trade.getCount}`
  if (trade.status === 'cancelled') return `Cancelled · ${counts}`
  if (trade.status === 'completed') {
    const day = new Date(trade.updatedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    return `${day} · ${counts}`
  }
  return counts
}

function TradeRow({ trade }: { trade: TradeSummary }) {
  const Icon = trade.mode === 'account' ? UserRound : Handshake
  return (
    <SettingRow
      icon={<Icon width={18} height={18} strokeWidth={1.75} />}
      label={trade.partnerName}
      labelSuffix={trade.awaitingMe ? 'Your turn' : undefined}
      subtitle={subtitleOf(trade)}
      value={trade.status === 'cancelled' ? undefined : deltaLabel(trade)}
      href={`/tools/trade/${trade.id}`}
    />
  )
}

export function TradesView({ trades }: { trades: TradeSummary[] }) {
  const [creating, setCreating] = useState(false)
  const open = trades.filter((trade) => trade.status === 'open')
  const awaiting = open.filter((trade) => trade.awaitingMe)
  const inProgress = open.filter((trade) => !trade.awaitingMe)
  const history = trades.filter((trade) => trade.status !== 'open')

  return (
    <Screen
      header={
        <ScreenHeader
          title="Trading"
          breadcrumb="Tools"
          backHref="/tools"
          onAdd={() => setCreating(true)}
          addLabel="New trade"
        />
      }
    >
      {trades.length === 0 && (
        <div className="flex flex-col items-center gap-10 px-20 py-40 text-center">
          <ArrowLeftRight
            width={28}
            height={28}
            strokeWidth={1.75}
            className="text-text-3"
          />
          <p className="text-body text-text-2">
            No trades yet. Start one in person, or with another user of this server.
          </p>
        </div>
      )}

      {awaiting.length > 0 && (
        <SettingsGroup label="Waiting for you">
          {awaiting.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </SettingsGroup>
      )}

      {inProgress.length > 0 && (
        <SettingsGroup label="In progress">
          {inProgress.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </SettingsGroup>
      )}

      {history.length > 0 && (
        <SettingsGroup label="History">
          {history.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </SettingsGroup>
      )}

      <NewTradeSheet open={creating} onOpenChange={setCreating} />
    </Screen>
  )
}
