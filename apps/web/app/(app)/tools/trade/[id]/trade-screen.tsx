'use client'

// Écran d'un échange : bandeau de balance, ce que je donne, ce que je reçois,
// destination des cartes reçues, puis la conclusion.
//
// Entre deux comptes, l'écran se relit toutes les 5 secondes tant que
// l'échange est ouvert : l'autre partie modifie ses lignes ou accepte de son
// côté. Une acceptation porte sur la révision affichée — si l'autre a changé
// quelque chose entre-temps, le serveur refuse (`stale`) et l'écran se relit.
//
// Les contrôles d'édition partagés (`QtyStepper`, `AddCardSheet`) lisent le
// droit d'écriture du contexte : il est reposé ici pour la collection de
// l'échange, qui n'est pas forcément la collection active.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, FolderInput, Plus } from 'lucide-react'
import { useState } from 'react'

import {
  acceptTradeAction,
  addCatalogLineAction,
  cancelTradeAction,
  completeInPersonAction,
  getTradeAction,
  listTradeDestinationsAction,
  removeLineAction,
  setDestinationAction,
  setRateAction,
  undoInPersonAction,
  updateLineAction,
  withdrawAcceptanceAction,
  type TradeActionError,
  type TradeActionResult,
} from '@/app/(app)/tools/trade/actions'
import { AddCardSheet, type CardPick } from '@/app/(app)/container/[id]/add-card-sheet'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { HoldingPickerSheet } from '@/components/trades/holding-picker-sheet'
import { PriceSheet } from '@/components/trades/price-sheet'
import { RateChips } from '@/components/trades/rate-chips'
import { TradeLineRow } from '@/components/trades/trade-line-row'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { NameSheet } from '@/components/ui/name-sheet'
import { PickerSheet } from '@/components/ui/picker-sheet'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '@/components/ui/sheet-controls'
import { UndoToast } from '@/components/ui/undo-toast'
import { CollectionAccessProvider } from '@/lib/collections/access-context'
import { formatMoney } from '@/lib/format/money'
import { clampRate, RATE_MAX_PCT, RATE_MIN_PCT, tradeBalance } from '@/lib/trades/pricing'
import type {
  TradeDestination,
  TradeLineView,
  TradeSideView,
  TradeView,
} from '@/lib/trades/trades'

const POLL_MS = 5_000

const ERROR_MESSAGE: Record<TradeActionError, string> = {
  stale: 'The trade changed in the meantime. Review it again before confirming.',
  unavailable: 'Some cards are no longer available in that quantity.',
  not_open: 'This trade is closed.',
  forbidden: 'You cannot change this trade.',
  empty: 'Add at least one card first.',
  not_found: 'This trade no longer exists.',
  expired: 'Too late to undo. The trade stays applied.',
  invalid: 'Something went wrong. Please try again.',
}

// La révision est figée à l'ouverture de la confirmation : l'acceptation
// porte sur ce que l'écran montrait, pas sur une relecture arrivée pendant
// que la feuille était ouverte.
type Confirm = { kind: 'complete' | 'accept' | 'cancel'; revision: number } | null

function tradeKey(id: string) {
  return ['trade', id] as const
}

export function TradeScreen({ initial }: { initial: TradeView }) {
  const queryClient = useQueryClient()
  const key = tradeKey(initial.id)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const { data: trade } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await getTradeAction({ tradeId: initial.id })
      if (!result.ok) throw new Error(result.error)
      return result.trade
    },
    initialData: initial,
    refetchInterval: (query) =>
      confirm === null &&
      query.state.data?.mode === 'account' &&
      query.state.data.status === 'open'
        ? POLL_MS
        : false,
  })
  const [pickingHoldings, setPickingHoldings] = useState(false)
  const [pickingCatalog, setPickingCatalog] = useState(false)
  const [pricing, setPricing] = useState<TradeLineView | null>(null)
  const [customRate, setCustomRate] = useState<TradeSideView | null>(null)
  const [destinations, setDestinations] = useState<TradeDestination[] | null>(null)
  const [undoToken, setUndoToken] = useState<string | null>(null)

  const open = trade.status === 'open'
  const editable = open && trade.canWrite
  const balance = tradeBalance(trade.give, trade.get)

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: key })
  }

  // Toute écriture : une seule à la fois, message d'erreur lisible, relecture
  // de l'échange dans tous les cas (succès comme refus).
  async function mutate<T extends object>(
    action: () => Promise<TradeActionResult<T>>,
  ): Promise<TradeActionResult<T> | null> {
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(ERROR_MESSAGE[result.error])
      return result
    } catch {
      setError(ERROR_MESSAGE.invalid)
      return null
    } finally {
      setPending(false)
      await refresh()
    }
  }

  // Quantité optimiste, annulée si le serveur refuse.
  async function handleQty(line: TradeLineView, qty: number) {
    await queryClient.cancelQueries({ queryKey: key })
    const previous = queryClient.getQueryData<TradeView>(key)
    queryClient.setQueryData<TradeView>(
      key,
      (current) =>
        current && {
          ...current,
          give: {
            ...current.give,
            lines: current.give.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)),
          },
          get: {
            ...current.get,
            lines: current.get.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)),
          },
        },
    )
    const result = await updateLineAction({
      tradeId: trade.id,
      lineId: line.id,
      qty,
    }).catch(() => null)
    if (!result?.ok) {
      queryClient.setQueryData(key, previous)
      setError(ERROR_MESSAGE[result && !result.ok ? result.error : 'invalid'])
    }
    await refresh()
  }

  async function handlePick(pick: CardPick): Promise<boolean> {
    const result = await mutate(() =>
      addCatalogLineAction({ tradeId: trade.id, ...pick }),
    )
    return Boolean(result?.ok)
  }

  async function openDestinations() {
    const result = await listTradeDestinationsAction({ tradeId: trade.id })
    setDestinations(result.ok ? result.destinations : [])
  }

  async function handleConfirm() {
    if (!confirm) return
    const { kind, revision } = confirm
    if (kind === 'complete') {
      const result = await mutate(() =>
        completeInPersonAction({ tradeId: trade.id, revision }),
      )
      if (result?.ok) setUndoToken(result.undoToken)
    } else if (kind === 'accept') {
      await mutate(() => acceptTradeAction({ tradeId: trade.id, revision }))
    } else {
      await mutate(() => cancelTradeAction({ tradeId: trade.id }))
    }
    setConfirm(null)
  }

  function side(view: TradeSideView, title: string) {
    const editQty = editable && view.canEdit
    return (
      <section className="mb-22">
        <SectionLabel>{title}</SectionLabel>
        <div className="flex flex-col gap-8">
          {view.lines.length === 0 && (
            <p className="rounded-row border border-border bg-surface-1 px-12 py-14 text-meta text-text-2">
              No cards yet.
            </p>
          )}
          {view.lines.map((line) => (
            <TradeLineRow
              key={line.id}
              line={line}
              currency={trade.currency}
              editQty={editQty}
              editPrice={editable}
              onQtyChange={(qty) => void handleQty(line, qty)}
              onRemove={() =>
                void mutate(() =>
                  removeLineAction({ tradeId: trade.id, lineId: line.id }),
                )
              }
              onPrice={() => setPricing(line)}
              disabled={pending}
            />
          ))}
          {editQty && (
            <SecondaryButton
              onClick={() =>
                view.giver === trade.me
                  ? setPickingHoldings(true)
                  : setPickingCatalog(true)
              }
              disabled={pending}
            >
              <span className="flex items-center justify-center gap-6">
                <Plus width={16} height={16} strokeWidth={2} />
                {view.giver === trade.me
                  ? 'Add from your collection'
                  : 'Add a card you get'}
              </span>
            </SecondaryButton>
          )}
        </div>
        <div className="mt-12">
          <div className="mb-8 ml-2 text-meta text-text-2">Value at</div>
          <RateChips
            value={view.ratePct}
            disabled={
              !editable ||
              pending ||
              (trade.mode === 'in_person' && trade.me !== 'initiator')
            }
            onChange={(ratePct) =>
              void mutate(() =>
                setRateAction({ tradeId: trade.id, giver: view.giver, ratePct }),
              )
            }
            onCustom={() => setCustomRate(view)}
          />
        </div>
      </section>
    )
  }

  const partner = trade.partnerName
  const status =
    trade.status === 'completed'
      ? `Completed ${new Date(trade.completedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : trade.status === 'cancelled'
        ? 'Cancelled'
        : trade.mode === 'in_person'
          ? 'In person'
          : `With ${partner}`

  const giveCount = trade.give.lines.reduce((sum, line) => sum + line.qty, 0)
  const getCount = trade.get.lines.reduce((sum, line) => sum + line.qty, 0)

  return (
    <CollectionAccessProvider canEdit={trade.canWrite}>
      <Screen
        header={
          <ScreenHeader
            title={partner}
            breadcrumb="Trading"
            backHref="/tools/trade"
            meta={<span className="text-meta text-text-2">{status}</span>}
          />
        }
      >
        <div
          className="mb-22 rounded-card bg-gradient-value-band p-20"
          data-testid="trade-balance"
        >
          <div className="text-meta font-semibold tracking-value-label text-value-band-label">
            BALANCE
          </div>
          <div className="mt-5 text-value-total font-extrabold tracking-value-amount text-on-accent">
            {balance.deltaMinor === 0
              ? 'Even'
              : `${balance.deltaMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(balance.deltaMinor), trade.currency)}`}
          </div>
          <div className="mt-14 flex gap-20">
            <div>
              <div className="text-value-stat font-bold text-on-accent">
                {formatMoney(balance.giveMinor, trade.currency)}
              </div>
              <div className="text-value-caption text-value-band-caption">you give</div>
            </div>
            <div>
              <div className="text-value-stat font-bold text-on-accent">
                {formatMoney(balance.getMinor, trade.currency)}
              </div>
              <div className="text-value-caption text-value-band-caption">you get</div>
            </div>
          </div>
          {balance.missing > 0 && (
            <div className="mt-10 text-value-caption text-value-band-caption">
              {balance.missing === 1 ? '1 card has' : `${balance.missing} cards have`} no
              price and count as 0.
            </div>
          )}
        </div>

        {side(trade.give, 'You give')}
        {side(
          trade.get,
          trade.mode === 'in_person' ? 'You get' : `You get from ${partner}`,
        )}

        {(open || trade.destination.containerId) && (
          <SettingsGroup label="Cards you get go to">
            <SettingRow
              icon={<FolderInput width={18} height={18} strokeWidth={1.75} />}
              label={trade.destination.name ?? 'Collection'}
              onClick={editable ? () => void openDestinations() : undefined}
            />
          </SettingsGroup>
        )}

        {error && (
          <p role="alert" className="mb-14 text-meta text-danger">
            {error}
          </p>
        )}

        {editable && trade.mode === 'in_person' && (
          <div className="flex flex-col gap-10">
            <PrimaryButton
              onClick={() => setConfirm({ kind: 'complete', revision: trade.revision })}
              disabled={pending || giveCount + getCount === 0}
            >
              Complete trade
            </PrimaryButton>
            <SecondaryButton
              onClick={() => setConfirm({ kind: 'cancel', revision: trade.revision })}
              disabled={pending}
            >
              Cancel trade
            </SecondaryButton>
          </div>
        )}

        {editable && trade.mode === 'account' && (
          <div className="flex flex-col gap-10">
            <p className="text-meta text-text-2" data-testid="trade-acceptance">
              {trade.acceptedByMe
                ? `You accepted. Waiting for ${partner}.`
                : trade.acceptedByPartner
                  ? `${partner} accepted this version. Accept to apply the trade.`
                  : `Both of you need to accept. Any change asks for a new acceptance.`}
            </p>
            {trade.acceptedByMe ? (
              <SecondaryButton
                onClick={() =>
                  void mutate(() => withdrawAcceptanceAction({ tradeId: trade.id }))
                }
                disabled={pending}
              >
                Withdraw acceptance
              </SecondaryButton>
            ) : (
              <PrimaryButton
                onClick={() => setConfirm({ kind: 'accept', revision: trade.revision })}
                disabled={pending || giveCount + getCount === 0}
              >
                {trade.acceptedByPartner ? 'Accept and apply trade' : 'Accept trade'}
              </PrimaryButton>
            )}
            <SecondaryButton
              onClick={() => setConfirm({ kind: 'cancel', revision: trade.revision })}
              disabled={pending}
            >
              Cancel trade
            </SecondaryButton>
          </div>
        )}

        {open && !trade.canWrite && (
          <p className="text-meta text-text-2">
            You have read-only access to your collection, so you cannot trade from it.
          </p>
        )}

        <ConfirmDialog
          open={confirm !== null}
          title={
            confirm?.kind === 'cancel'
              ? 'Cancel this trade?'
              : confirm?.kind === 'accept'
                ? 'Accept this trade?'
                : 'Complete this trade?'
          }
          message={
            confirm?.kind === 'cancel'
              ? 'It stays in your history. Nothing changes in your collection.'
              : confirm?.kind === 'accept' && !trade.acceptedByPartner
                ? `Nothing changes until ${partner} accepts this same version too.`
                : `${giveCount} ${giveCount === 1 ? 'card leaves' : 'cards leave'} your collection, ${getCount} ${
                    getCount === 1 ? 'card is' : 'cards are'
                  } added to ${trade.destination.name ?? 'Collection'}.`
          }
          confirmLabel={
            confirm?.kind === 'cancel'
              ? 'Cancel trade'
              : confirm?.kind === 'accept'
                ? 'Accept'
                : 'Complete'
          }
          cancelLabel="Back"
          destructive={confirm?.kind === 'cancel'}
          pending={pending}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirm(null)}
        />

        <HoldingPickerSheet
          open={pickingHoldings}
          onOpenChange={setPickingHoldings}
          tradeId={trade.id}
          currency={trade.currency}
          onAdded={() => void refresh()}
        />

        <AddCardSheet
          open={pickingCatalog}
          onOpenChange={setPickingCatalog}
          containerId={null}
          onAdded={() => void refresh()}
          onPick={handlePick}
          pickLabel="Add to trade"
        />

        {pricing && (
          <PriceSheet
            key={pricing.id}
            open
            onClose={() => setPricing(null)}
            cardName={pricing.name}
            currency={trade.currency}
            marketPriceMinor={pricing.marketPriceMinor}
            priceOverrideMinor={pricing.priceOverrideMinor}
            pending={pending}
            onSave={(priceOverrideMinor) =>
              void mutate(() =>
                updateLineAction({
                  tradeId: trade.id,
                  lineId: pricing.id,
                  priceOverrideMinor,
                }),
              ).then((result) => result?.ok && setPricing(null))
            }
          />
        )}

        {customRate && (
          <NameSheet
            key={customRate.giver}
            open
            title="Value at"
            label={`Percentage (${RATE_MIN_PCT}–${RATE_MAX_PCT})`}
            initialValue={String(customRate.ratePct)}
            confirmLabel="Set"
            pending={pending}
            onClose={() => setCustomRate(null)}
            onSubmit={(value) => {
              const parsed = Number.parseInt(value, 10)
              if (Number.isNaN(parsed)) return
              const ratePct = clampRate(parsed)
              void mutate(() =>
                setRateAction({ tradeId: trade.id, giver: customRate.giver, ratePct }),
              ).then((result) => result?.ok && setCustomRate(null))
            }}
          />
        )}

        <PickerSheet
          open={destinations !== null}
          onClose={() => setDestinations(null)}
          title="Cards you get go to"
          options={(destinations ?? []).map((destination) => ({
            value: destination.containerId,
            label: destination.name,
          }))}
          value={trade.destination.containerId}
          onPick={(containerId) =>
            void mutate(() => setDestinationAction({ tradeId: trade.id, containerId }))
          }
        />

        {undoToken && (
          <UndoToast
            token={undoToken}
            message="Trade completed"
            icon={ArrowLeftRight}
            onUndo={() => {
              const token = undoToken
              setUndoToken(null)
              void mutate(() => undoInPersonAction({ undoToken: token }))
            }}
            onExpire={() => setUndoToken(null)}
          />
        )}
      </Screen>
    </CollectionAccessProvider>
  )
}
