'use client'

// Playtest d'un deck — main de départ, mulligans, premiers tours. Îlot client
// unique, état en mémoire seulement (`lib/tools/playtest-state.ts`) : rien sur
// le compte, rien dans `localStorage`.
import { useEffect, useState } from 'react'

import { PlaytestCardTile } from '@/components/tools/playtest-card'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '@/components/ui/sheet-controls'
import {
  HAND_SIZE,
  cardsToBottom,
  cryptoRandom,
  playtestReducer,
  startPlaytest,
  type PlaytestAction,
  type PlaytestCard,
  type PlaytestDeck,
  type PlaytestState,
} from '@/lib/tools/playtest-state'

type PlayOrder = 'play' | 'draw'

const PLAY_ORDER_OPTIONS: Array<{ value: PlayOrder; label: string }> = [
  { value: 'play', label: 'On the play' },
  { value: 'draw', label: 'On the draw' },
]

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function CardGrid({
  cards,
  onTap,
  actionLabel,
  selectedIds,
}: {
  cards: PlaytestCard[]
  onTap?: (card: PlaytestCard) => void
  actionLabel?: string
  selectedIds?: string[]
}) {
  return (
    <div className="grid grid-cols-4 gap-9 tablet:grid-cols-5 desktop:grid-cols-7">
      {cards.map((card) => (
        <PlaytestCardTile
          key={card.id}
          name={card.name}
          thumbUrl={card.thumbUrl}
          onClick={onTap ? () => onTap(card) : undefined}
          actionLabel={actionLabel}
          selectable={selectedIds !== undefined}
          selected={selectedIds?.includes(card.id) ?? false}
        />
      ))}
    </div>
  )
}

function EmptyZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-row border border-border bg-surface-1 px-14 py-14 text-body text-text-3">
      {children}
    </div>
  )
}

export function Playtest({
  name,
  formatLabel,
  deck,
}: {
  name: string
  formatLabel: string | null
  deck: PlaytestDeck
}) {
  // Le mélange n'a lieu que côté client, dans l'effet : un mélange au rendu
  // serveur différerait de celui de l'hydratation.
  const [state, setState] = useState<PlaytestState | null>(null)

  useEffect(() => {
    setState(startPlaytest(deck, cryptoRandom))
  }, [deck])

  function dispatch(action: PlaytestAction) {
    setState((current) =>
      current ? playtestReducer(current, action, cryptoRandom) : current,
    )
  }

  function restart() {
    setState((current) => startPlaytest(deck, cryptoRandom, current?.onThePlay ?? true))
  }

  const header = (
    <ScreenHeader
      title={name}
      breadcrumb="Playtest"
      backHref="/tools/playtest"
      meta={
        state
          ? [
              formatLabel,
              state.phase === 'playing' ? `Turn ${state.turn}` : null,
              `${plural(state.library.length, 'card')} in library`,
            ]
              .filter(Boolean)
              .join(' · ')
          : formatLabel
      }
    />
  )

  if (deck.cards.length === 0) {
    return (
      <Screen header={header}>
        <EmptyZone>This deck has no mainboard cards to draw.</EmptyZone>
      </Screen>
    )
  }

  if (!state) return <Screen header={header}>{null}</Screen>

  const bottomCount = cardsToBottom(state)
  const canMulligan =
    cardsToBottom({ ...state, mulligans: state.mulligans + 1 }) < HAND_SIZE

  return (
    <Screen header={header}>
      {deck.cards.length < HAND_SIZE && (
        <div className="mb-22">
          <EmptyZone>
            This deck has only {plural(deck.cards.length, 'card')} in its mainboard.
          </EmptyZone>
        </div>
      )}

      {state.phase !== 'playing' && (
        <div className="mb-22">
          <Segmented
            options={PLAY_ORDER_OPTIONS}
            value={state.onThePlay ? 'play' : 'draw'}
            onChange={(value) =>
              dispatch({ type: 'setOnThePlay', onThePlay: value === 'play' })
            }
          />
        </div>
      )}

      {deck.commanders.length > 0 && (
        <div className="mb-22">
          <SectionLabel>Command zone</SectionLabel>
          <CardGrid cards={deck.commanders} />
        </div>
      )}

      {state.phase === 'mulligan' && (
        <>
          <SectionLabel>
            {state.mulligans === 0
              ? 'Opening hand'
              : `Mulligan ${state.mulligans} · ${plural(bottomCount, 'card')} to bottom`}
          </SectionLabel>
          <div className="mb-22">
            <CardGrid cards={state.hand} />
          </div>
          <div className="flex flex-col gap-9">
            <PrimaryButton onClick={() => dispatch({ type: 'keep' })}>Keep</PrimaryButton>
            <SecondaryButton
              onClick={() => dispatch({ type: 'mulligan' })}
              disabled={!canMulligan}
            >
              Mulligan
            </SecondaryButton>
          </div>
        </>
      )}

      {state.phase === 'bottom' && (
        <>
          <SectionLabel>
            {`Put ${plural(bottomCount, 'card')} on the bottom · ${state.toBottom.length} of ${bottomCount}`}
          </SectionLabel>
          <div className="mb-22">
            <CardGrid
              cards={state.hand}
              onTap={(card) => dispatch({ type: 'toggleBottom', id: card.id })}
              actionLabel="Put on the bottom"
              selectedIds={state.toBottom}
            />
          </div>
          <PrimaryButton
            onClick={() => dispatch({ type: 'confirmBottom' })}
            disabled={state.toBottom.length !== bottomCount}
          >
            Keep hand
          </PrimaryButton>
        </>
      )}

      {state.phase === 'playing' && (
        <>
          <SectionLabel>{`Battlefield · ${state.battlefield.length}`}</SectionLabel>
          <div className="mb-22">
            {state.battlefield.length === 0 ? (
              <EmptyZone>Tap a card in your hand to play it.</EmptyZone>
            ) : (
              <CardGrid
                cards={state.battlefield}
                onTap={(card) => dispatch({ type: 'unplay', id: card.id })}
                actionLabel="Return to hand"
              />
            )}
          </div>
          <SectionLabel>{`Hand · ${state.hand.length}`}</SectionLabel>
          <div className="mb-22">
            {state.hand.length === 0 ? (
              <EmptyZone>Your hand is empty.</EmptyZone>
            ) : (
              <CardGrid
                cards={state.hand}
                onTap={(card) => dispatch({ type: 'play', id: card.id })}
                actionLabel="Play"
              />
            )}
          </div>
          <div className="flex flex-col gap-9">
            <PrimaryButton onClick={() => dispatch({ type: 'nextTurn' })}>
              Next turn
            </PrimaryButton>
            <SecondaryButton
              onClick={() => dispatch({ type: 'draw' })}
              disabled={state.library.length === 0}
            >
              Draw a card
            </SecondaryButton>
            <SecondaryButton onClick={restart}>New game</SecondaryButton>
          </div>
        </>
      )}
    </Screen>
  )
}
