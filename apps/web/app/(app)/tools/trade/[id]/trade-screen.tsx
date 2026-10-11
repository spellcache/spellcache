'use client'

// Écran d'un échange. Selon l'avancement, il montre :
// - une étape du parcours (`?step=cards|theirs|extras`) ;
// - entre deux comptes, avant que la contrepartie ait accepté l'offre :
//   l'attente côté initiateur, l'offre reçue côté contrepartie ;
// - sinon le résumé : la balance, les deux côtés en liste compacte (détails
//   dans une feuille), la destination des cartes reçues et la conclusion.
//
// Une acceptation porte sur la révision affichée à l'ouverture de la
// confirmation — si l'autre partie a changé quelque chose entre-temps, le
// serveur refuse (`stale`) et l'écran se relit.
import { ArrowLeftRight, Check, Clock, FolderInput, Share2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  acceptTradeAction,
  cancelTradeAction,
  completeInPersonAction,
  joinTradeAction,
  listTradeDestinationsAction,
  removeLineAction,
  setCashAction,
  setDestinationAction,
  setNotesAction,
  setRateAction,
  setSideValueAction,
  undoInPersonAction,
  updateLineAction,
  withdrawAcceptanceAction,
  type TradeActionResult,
} from '@/app/(app)/tools/trade/actions'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { CardsStep } from '@/components/trades/cards-step'
import { CompactCardList } from '@/components/trades/compact-card-list'
import { DetailsSheet } from '@/components/trades/details-sheet'
import { ExportSheet } from '@/components/trades/export-sheet'
import { ExtrasStep, type ExtrasDraft } from '@/components/trades/extras-step'
import { PriceSheet } from '@/components/trades/price-sheet'
import { SideZone } from '@/components/trades/side-zone'
import { StepFooter } from '@/components/trades/step-footer'
import { TheirCardsStep } from '@/components/trades/their-cards-step'
import { ValueSheet } from '@/components/trades/value-sheet'
import {
  stepsFor,
  useTrade,
  type RunAction,
  type TradeStep,
} from '@/components/trades/use-trade'
import { WizardHeader } from '@/components/trades/wizard-header'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import { sideTotalMinor, sideValueMinor, tradeBalance } from '@/lib/trades/pricing'
import type { TradeParty } from '@spellcache/db/schema'
import type { TradeDestination, TradeLineView, TradeView } from '@/lib/trades/trades'

type Confirm = {
  kind: 'complete' | 'accept' | 'cancel' | 'decline'
  revision: number
} | null

function cardCount(lines: TradeLineView[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function TradeScreen({
  initial,
  step,
}: {
  initial: TradeView
  step: TradeStep | null
}) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const { trade, mutate, optimistic, pending, error, setError } = useTrade(initial, {
    paused: confirm !== null,
  })

  const [details, setDetails] = useState<'give' | 'get' | null>(null)
  const [pricing, setPricing] = useState<TradeLineView | null>(null)
  const [customRate, setCustomRate] = useState<TradeParty | null>(null)
  const [destinations, setDestinations] = useState<TradeDestination[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [undoToken, setUndoToken] = useState<string | null>(null)
  const [extras, setExtras] = useState<ExtrasDraft | null | undefined>(undefined)

  const base = `/tools/trade/${trade.id}`
  const partner = trade.partnerName
  const open = trade.status === 'open'
  const editable = open && trade.canWrite && trade.joined
  const live = trade.mode === 'account'

  const run: RunAction = async (action) => {
    const result = await mutate(action)
    return Boolean(result?.ok)
  }

  function lineQty(line: TradeLineView, qty: number) {
    void optimistic(
      (current) => ({
        ...current,
        give: {
          ...current.give,
          lines: current.give.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)),
        },
        get: {
          ...current.get,
          lines: current.get.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)),
        },
      }),
      () => updateLineAction({ tradeId: trade.id, lineId: line.id, qty }),
    )
  }

  // --- Étapes --------------------------------------------------------------

  const steps = stepsFor(trade)
  const canFill = open && trade.canWrite && (trade.joined || trade.me === 'initiator')
  // L'argent et les notes restent accessibles à l'initiateur d'un échange
  // entre comptes, depuis le résumé, même si son parcours s'arrête à l'offre.
  const reachable = steps.includes(step ?? 'who') || step === 'extras'
  if (step && step !== 'who' && reachable && canFill) {
    const index = steps.includes(step) ? steps.indexOf(step) : steps.length - 1
    const previous =
      index > 0 && steps[index - 1] !== 'who'
        ? `${base}?step=${steps[index - 1]}`
        : undefined
    const giveTotal = sideTotalMinor(trade.give).valueMinor
    const getTotal = sideTotalMinor(trade.get).valueMinor

    async function saveExtras() {
      const draft = extras
      if (draft) {
        const writes: Array<() => Promise<TradeActionResult<object>>> = []
        if (draft.giveCashMinor !== trade.give.cashMinor)
          writes.push(() =>
            setCashAction({
              tradeId: trade.id,
              giver: trade.give.giver,
              amountMinor: draft.giveCashMinor,
            }),
          )
        if (trade.mode === 'in_person' && draft.getCashMinor !== trade.get.cashMinor)
          writes.push(() =>
            setCashAction({
              tradeId: trade.id,
              giver: trade.get.giver,
              amountMinor: draft.getCashMinor,
            }),
          )
        if (draft.notes.trim() !== (trade.give.notes ?? ''))
          writes.push(() =>
            setNotesAction({
              tradeId: trade.id,
              giver: trade.give.giver,
              notes: draft.notes,
            }),
          )
        for (const write of writes) if (!(await run(write))) return
      }
      router.push(base)
    }

    let body: React.ReactNode
    let footer: React.ReactNode
    let title: string
    if (step === 'cards') {
      title = 'What do you give?'
      body = (
        <CardsStep
          trade={trade}
          pending={pending}
          run={run}
          onChanged={() => setError(null)}
        />
      )
      const offer = live && trade.me === 'initiator'
      footer = (
        <StepFooter
          title={plural(cardCount(trade.give.lines), 'card')}
          subtitle={formatMoney(giveTotal, trade.currency)}
          nextLabel={offer ? 'Send offer' : 'Next'}
          nextHref={offer ? base : `${base}?step=${steps[index + 1] ?? ''}`}
          disabled={offer && trade.give.lines.length === 0 && trade.give.cashMinor === 0}
        />
      )
    } else if (step === 'theirs') {
      title = `What does ${partner} give?`
      body = <TheirCardsStep trade={trade} pending={pending} run={run} />
      footer = (
        <StepFooter
          title={plural(cardCount(trade.get.lines), 'card')}
          subtitle={formatMoney(getTotal, trade.currency)}
          nextLabel="Next"
          nextHref={`${base}?step=extras`}
        />
      )
    } else {
      title = 'Cash & notes'
      body = <ExtrasStep trade={trade} onChange={setExtras} />
      footer = (
        <StepFooter
          title={`You give ${formatMoney(giveTotal, trade.currency)}`}
          subtitle={`You get ${formatMoney(getTotal, trade.currency)}`}
          nextLabel="Review the trade"
          disabled={pending || extras === null}
          onNext={() => void saveExtras()}
        />
      )
    }

    return (
      <Screen
        header={
          <WizardHeader
            step={index + 1}
            total={steps.length}
            title={title}
            label={trade.me === 'counterparty' ? `Trade with ${partner}` : 'New trade'}
            backHref={previous}
            closeHref={base}
            action={
              step === 'extras' ? (
                <Link href={base} className="text-body font-bold text-text-2">
                  Skip
                </Link>
              ) : undefined
            }
          />
        }
      >
        {/* Le pied reste en bas de l'écran même quand l'étape est courte. */}
        <div className="flex min-h-full w-full min-w-0 flex-col">
          {body}
          {error && (
            <p role="alert" className="mt-14 text-meta text-danger">
              {error}
            </p>
          )}
          <div className="mt-auto">{footer}</div>
        </div>
      </Screen>
    )
  }

  // --- Entre deux comptes, avant l'acceptation de l'offre --------------------

  if (live && !trade.joined && open) {
    const mine = trade.me === 'initiator'
    const offer = mine ? trade.give : trade.get
    const offerTotal = sideTotalMinor(offer).valueMinor

    return (
      <Screen
        header={
          <ScreenHeader
            title={mine ? partner : `${partner} wants to trade`}
            breadcrumb={mine ? 'Trading · Live' : 'Trade offer'}
            backHref="/tools/trade"
          />
        }
      >
        {mine ? (
          <div
            className="mb-18 rounded-card border border-border bg-surface-1 p-18"
            data-testid="trade-waiting"
          >
            <div className="flex items-center gap-12">
              <span className="flex h-touch-target w-touch-target flex-shrink-0 items-center justify-center rounded-control bg-accent-bg text-accent-text">
                <Clock width={20} height={20} strokeWidth={1.75} />
              </span>
              <div>
                <div className="text-row-label font-bold text-text">
                  Waiting for {partner}
                </div>
                <div className="mt-2 text-meta text-text-2">
                  {partner} sees your offer and picks what to give.
                </div>
              </div>
            </div>
            <ol className="m-0 mt-16 flex list-none flex-col gap-10 p-0 text-body text-text">
              <li className="flex items-center gap-10">
                <span className="flex h-selection-circle w-selection-circle items-center justify-center rounded-full bg-accent text-on-accent">
                  <Check width={12} height={12} strokeWidth={3} />
                </span>
                Offer sent
              </li>
              <li className="flex items-center gap-10 font-bold">
                <span className="h-selection-circle w-selection-circle rounded-full border-2 border-accent" />
                {partner} accepts to start
              </li>
              <li className="flex items-center gap-10 text-text-2">
                <span className="h-selection-circle w-selection-circle rounded-full border-2 border-text-3" />
                {partner} picks cards or cash
              </li>
              <li className="flex items-center gap-10 text-text-2">
                <span className="h-selection-circle w-selection-circle rounded-full border-2 border-text-3" />
                You both review and accept
              </li>
            </ol>
          </div>
        ) : (
          <div className="mb-18 rounded-card bg-gradient-value-band p-18">
            <div className="text-meta font-semibold uppercase tracking-value-label text-value-band-label">
              {partner} offers
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-value-total font-extrabold tracking-value-amount text-on-accent">
                {formatMoney(offerTotal, trade.currency)}
              </span>
              <span className="text-body font-semibold text-value-band-caption">
                {plural(cardCount(offer.lines), 'card')}
              </span>
            </div>
          </div>
        )}

        <SectionLabel>{mine ? 'Your offer' : 'The offer'}</SectionLabel>
        <CompactCardList
          lines={offer.lines}
          currency={trade.currency}
          cash={{
            amountMinor: offer.cashMinor,
            label: mine ? `Cash, you pay ${partner}` : `Cash, ${partner} pays you`,
          }}
        />
        {mine && (
          <Link
            href={`${base}?step=cards`}
            className="mt-10 ml-2 inline-block text-body font-bold text-accent-text"
          >
            Edit my offer
          </Link>
        )}
        {offer.notes && (
          <p className="mt-14 rounded-control border border-border bg-surface-1 px-14 py-12 text-body leading-normal text-text-2">
            <b className="text-text">{mine ? 'Your note' : `${partner}'s note`}:</b>{' '}
            {offer.notes}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-14 text-meta text-danger">
            {error}
          </p>
        )}

        <div className="mt-24 flex flex-col gap-10">
          {mine ? (
            <SecondaryButton
              onClick={() => setConfirm({ kind: 'cancel', revision: trade.revision })}
              disabled={pending}
            >
              Cancel offer
            </SecondaryButton>
          ) : (
            <>
              <p className="text-center text-meta text-text-3">
                Accepting opens the next step: pick what you give back.
              </p>
              <div className="grid grid-cols-3 gap-8">
                <SecondaryButton
                  onClick={() =>
                    setConfirm({ kind: 'decline', revision: trade.revision })
                  }
                  disabled={pending}
                >
                  Decline
                </SecondaryButton>
                <div className="col-span-2">
                  <PrimaryButton
                    disabled={pending || !trade.canWrite}
                    onClick={() =>
                      void run(() => joinTradeAction({ tradeId: trade.id })).then(
                        (ok) => ok && router.push(`${base}?step=cards`),
                      )
                    }
                  >
                    Accept and pick
                  </PrimaryButton>
                </div>
              </div>
            </>
          )}
        </div>

        <ConfirmDialog
          open={confirm !== null}
          title={
            confirm?.kind === 'decline' ? 'Decline this offer?' : 'Cancel this offer?'
          }
          message="It stays in both histories. Nothing changes in any collection."
          confirmLabel={confirm?.kind === 'decline' ? 'Decline' : 'Cancel offer'}
          cancelLabel="Back"
          pending={pending}
          onConfirm={() =>
            void mutate(() => cancelTradeAction({ tradeId: trade.id })).then(() =>
              setConfirm(null),
            )
          }
          onClose={() => setConfirm(null)}
        />
      </Screen>
    )
  }

  // --- Résumé ---------------------------------------------------------------

  const balance = tradeBalance(trade.give, trade.get)
  const giveCount = cardCount(trade.give.lines)
  const getCount = cardCount(trade.get.lines)
  const canRate = editable && (live || trade.me === 'initiator')
  const detailsSide =
    details === 'give' ? trade.give : details === 'get' ? trade.get : null
  const status =
    trade.status === 'completed'
      ? `Completed ${day(trade.completedAt!)}`
      : trade.status === 'cancelled'
        ? 'Cancelled'
        : null

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

  async function saveNotes(giver: TradeParty, notes: string): Promise<boolean> {
    return run(() => setNotesAction({ tradeId: trade.id, giver, notes }))
  }

  return (
    <CollectionAccessProvider canEdit={trade.canWrite}>
      <Screen
        header={
          <ScreenHeader
            title={partner}
            breadcrumb={`Trading · ${live ? 'Live' : 'In person'}`}
            backHref="/tools/trade"
            meta={
              status ? <span className="text-meta text-text-2">{status}</span> : undefined
            }
            actions={[
              {
                icon: Share2,
                label: 'Export the trade',
                onClick: () => setExporting(true),
              },
            ]}
          />
        }
      >
        <div className="flex flex-col gap-14">
          <div
            className="rounded-row bg-gradient-value-band px-18 py-14"
            data-testid="trade-balance"
          >
            <div className="flex items-center justify-between">
              <div className="text-meta font-semibold tracking-value-label text-value-band-label">
                BALANCE
              </div>
              <div className="text-value-stat font-extrabold tracking-value-amount text-on-accent">
                {balance.deltaMinor === 0
                  ? 'Even'
                  : `${balance.deltaMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(balance.deltaMinor), trade.currency)}`}
              </div>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-10 border-t border-value-band-caption pt-10">
              <div>
                <div className="text-value-caption text-value-band-caption">You give</div>
                <div className="text-row-label font-bold text-on-accent">
                  {formatMoney(balance.giveMinor, trade.currency)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-value-caption text-value-band-caption">
                  {partner} gives
                </div>
                <div className="text-row-label font-bold text-on-accent">
                  {formatMoney(balance.getMinor, trade.currency)}
                </div>
              </div>
            </div>
            {balance.missing > 0 && (
              <div className="mt-8 text-value-caption text-value-band-caption">
                {balance.missing === 1 ? '1 card has' : `${balance.missing} cards have`}{' '}
                no price and count as 0.
              </div>
            )}
          </div>

          {trade.status === 'completed' && (
            <PrimaryButton onClick={() => setExporting(true)}>
              Send the list to {partner}
            </PrimaryButton>
          )}

          <SideZone
            title="You give"
            side={trade.give}
            currency={trade.currency}
            cashLabel={`Cash, you pay ${partner}`}
            addHref={`${base}?step=cards`}
            cashHref={`${base}?step=extras`}
            onDetails={() => setDetails('give')}
            canRate={canRate}
            pending={pending}
            onRate={(ratePct) =>
              void mutate(() =>
                setRateAction({ tradeId: trade.id, giver: trade.give.giver, ratePct }),
              )
            }
            onCustomRate={() => setCustomRate(trade.give.giver)}
            notesLabel={live ? `Your notes · ${partner} sees them` : 'Your notes'}
            onSaveNotes={(notes) => saveNotes(trade.give.giver, notes)}
          />

          <SideZone
            title={`${partner} gives`}
            side={trade.get}
            currency={trade.currency}
            cashLabel={`Cash, ${partner} pays you`}
            addHref={live ? undefined : `${base}?step=theirs`}
            cashHref={live ? undefined : `${base}?step=extras`}
            onDetails={() => setDetails('get')}
            canRate={canRate}
            pending={pending}
            onRate={(ratePct) =>
              void mutate(() =>
                setRateAction({ tradeId: trade.id, giver: trade.get.giver, ratePct }),
              )
            }
            onCustomRate={() => setCustomRate(trade.get.giver)}
            notesLabel={live ? `${partner}'s notes` : `Notes about ${partner}'s side`}
            onSaveNotes={(notes) => saveNotes(trade.get.giver, notes)}
          />
          {live && editable && (
            <p className="ml-2 text-meta-search text-text-3">
              Only {partner} adds or removes their cards. You can still adjust prices and
              the value %.
            </p>
          )}

          {(open || trade.destination.containerId) && (
            <SettingsGroup>
              <SettingRow
                icon={<FolderInput width={18} height={18} strokeWidth={1.75} />}
                label={trade.destination.name ?? 'Collection'}
                subtitle="Cards you get go to"
                onClick={
                  editable
                    ? () =>
                        void listTradeDestinationsAction({ tradeId: trade.id }).then(
                          (result) =>
                            setDestinations(result.ok ? result.destinations : []),
                        )
                    : undefined
                }
              />
            </SettingsGroup>
          )}

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}

          {editable && !live && (
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

          {editable && live && (
            <div className="flex flex-col gap-10">
              <div
                className="flex flex-col gap-8 rounded-row border border-border bg-surface-1 px-14 py-12 text-body"
                data-testid="trade-acceptance"
              >
                {[
                  {
                    done: trade.acceptedByPartner,
                    label: trade.acceptedByPartner
                      ? `${partner} accepted this version`
                      : `${partner} has not accepted yet`,
                  },
                  {
                    done: trade.acceptedByMe,
                    label: trade.acceptedByMe ? 'You accepted' : 'Your acceptance',
                  },
                ].map((entry) => (
                  <div
                    key={entry.label}
                    className={`flex items-center gap-10 ${entry.done ? 'text-text' : 'text-text-2'}`}
                  >
                    <span
                      className={`flex h-selection-circle w-selection-circle items-center justify-center rounded-full ${
                        entry.done ? 'bg-accent text-on-accent' : 'border-2 border-text-3'
                      }`}
                    >
                      {entry.done && <Check width={11} height={11} strokeWidth={3} />}
                    </span>
                    {entry.label}
                  </div>
                ))}
              </div>
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
        </div>

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
                  } added to ${trade.destination.name ?? 'Collection'}.${
                    trade.give.lines.some((line) => line.wholeDeck)
                      ? ' Your whole deck is dismantled, so this trade cannot be undone.'
                      : ''
                  }`
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

        {detailsSide && (
          <DetailsSheet
            open
            onClose={() => setDetails(null)}
            title={details === 'give' ? 'You give' : `${partner} gives`}
            side={detailsSide}
            currency={trade.currency}
            editPrice={editable}
            pending={pending}
            onQty={lineQty}
            onRemove={(line) =>
              void mutate(() => removeLineAction({ tradeId: trade.id, lineId: line.id }))
            }
            onPrice={(line) => setPricing(line)}
            onKey={(line, patch) =>
              void mutate(() =>
                updateLineAction({ tradeId: trade.id, lineId: line.id, ...patch }),
              )
            }
            onAdd={
              details === 'give' || !live
                ? () =>
                    router.push(`${base}?step=${details === 'give' ? 'cards' : 'theirs'}`)
                : undefined
            }
          />
        )}

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
          <ValueSheet
            key={customRate}
            open
            title={
              customRate === trade.give.giver
                ? 'Value of what you give'
                : `Value of what ${partner} gives`
            }
            currency={trade.currency}
            ratePct={
              customRate === trade.give.giver ? trade.give.ratePct : trade.get.ratePct
            }
            fixedMinor={
              customRate === trade.give.giver
                ? trade.give.fixedMinor
                : trade.get.fixedMinor
            }
            marketMinor={
              sideValueMinor(
                customRate === trade.give.giver ? trade.give.lines : trade.get.lines,
                100,
              ).valueMinor
            }
            pending={pending}
            onClose={() => setCustomRate(null)}
            onSave={(value) =>
              void mutate(() =>
                value.kind === 'rate'
                  ? setRateAction({
                      tradeId: trade.id,
                      giver: customRate,
                      ratePct: value.ratePct,
                    })
                  : setSideValueAction({
                      tradeId: trade.id,
                      giver: customRate,
                      amountMinor: value.amountMinor,
                    }),
              ).then((result) => result?.ok && setCustomRate(null))
            }
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

        <ExportSheet open={exporting} onClose={() => setExporting(false)} trade={trade} />

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
