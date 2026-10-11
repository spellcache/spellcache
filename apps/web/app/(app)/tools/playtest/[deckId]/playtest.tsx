'use client'

// Partie de test d'un deck : îlot client unique qui tient la partie et la
// reprend de `sessionStorage` après un rechargement (`lib/tools/playtest-state.ts`).
//
// Mise en page : en-tête, corps défilant (zones et champ de bataille), pied
// fixe (main et actions du tour) — la main reste sous le pouce quelle que
// soit la taille du champ de bataille.
import { useEffect, useState } from 'react'

import { ContextMenu } from '@/components/ui/context-menu'
import { Chip } from '@/components/ui/chip'
import { ScreenHeader } from '@/components/ui/screen-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PlaytestCard } from '@/components/tools/playtest-card'
import { cardActions, PlaytestCardSheet } from '@/components/tools/playtest-card-sheet'
import { PlaytestZoneSheet, ZONE_LABELS } from '@/components/tools/playtest-zone-sheet'
import {
  isLandCard,
  loadPlaytestGame,
  playtestReducer,
  savePlaytestGame,
  startPlaytest,
  type PlaytestAction,
  type PlaytestDeck,
  type PlaytestGame,
  type PlaytestZone,
} from '@/lib/tools/playtest-state'

const PRIMARY_BUTTON = 'flex-1 rounded-control bg-accent py-13 text-button-primary font-extrabold text-on-accent'
const SECONDARY_BUTTON =
  'flex-1 rounded-control border border-border bg-surface-2 py-13 text-button-secondary font-bold text-text disabled:opacity-60'
const SECTION_LABEL = 'mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2'

const SIDE_ZONES: PlaytestZone[] = ['library', 'graveyard', 'exile', 'command']

function zoneOf(game: PlaytestGame, id: string): PlaytestZone | null {
  return (Object.keys(game.zones) as PlaytestZone[]).find((zone) => game.zones[zone].includes(id)) ?? null
}

function headerMeta(game: PlaytestGame): string {
  if (game.phase === 'playing') return `Turn ${game.turn} · ${game.onThePlay ? 'on the play' : 'on the draw'}`
  return game.mulligans === 0 ? 'Opening hand' : `Mulligan ${game.mulligans}`
}

export function Playtest({ deck }: { deck: PlaytestDeck }) {
  // Rendu serveur et premier rendu client partagent `null` : la reprise se
  // fait dans l'effet, jamais pendant l'hydratation.
  const [game, setGame] = useState<PlaytestGame | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [openZone, setOpenZone] = useState<PlaytestZone | null>(null)
  const [looked, setLooked] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setGame(loadPlaytestGame(deck))
    setLoaded(true)
  }, [deck])

  useEffect(() => {
    if (loaded) savePlaytestGame(game)
  }, [game, loaded])

  const libraryCount = deck.main.reduce((sum, entry) => sum + entry.qty, 0)

  function start(onThePlay: boolean) {
    setLooked([])
    setGame(startPlaytest(deck, onThePlay))
  }

  function dispatch(action: PlaytestAction) {
    setGame((current) => (current ? playtestReducer(current, action) : current))
    // Mélanger ou piocher change le dessus : ce qui avait été regardé ne
    // l'est plus.
    if (action.type === 'shuffle' || action.type === 'nextTurn' || action.type === 'mulligan') setLooked([])
  }

  const cardOf = (id: string) => deck.cards[game?.instances[id] ?? '']!

  const header = (
    <ScreenHeader
      title={deck.name}
      breadcrumb="Playtest"
      backHref="/tools/playtest"
      meta={game ? headerMeta(game) : undefined}
      onOverflow={game ? () => setMenuOpen(true) : undefined}
      overflowLabel="Game actions"
    />
  )

  if (!game) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-shrink-0 px-gutter pt-screen-top desktop:px-0 desktop:pt-34">{header}</div>
        <div className="px-gutter desktop:px-0">
          {libraryCount === 0 ? (
            <p className="px-4 text-body leading-normal text-text-2">
              This deck has no cards in its mainboard yet.
            </p>
          ) : (
            loaded && (
              <>
                <p className="mb-22 px-4 text-body leading-normal text-text-2">
                  {libraryCount} cards
                  {deck.commanders.length > 0 ? ` · ${deck.commanders.length} in the command zone` : ''}. Shuffle up
                  and draw seven.
                </p>
                <div className="flex gap-9">
                  <button type="button" onClick={() => start(true)} className={PRIMARY_BUTTON}>
                    On the play
                  </button>
                  <button type="button" onClick={() => start(false)} className={SECONDARY_BUTTON}>
                    On the draw
                  </button>
                </div>
              </>
            )
          )}
        </div>
      </div>
    )
  }

  const selectedZone = selected ? zoneOf(game, selected) : null
  const selectedItems =
    selected && selectedZone && game.phase === 'playing'
      ? cardActions(selected, selectedZone, {
          tapped: game.tapped.includes(selected),
          isCommander: deck.commanders.includes(game.instances[selected] ?? ''),
        })
      : []

  function onHandCard(id: string) {
    if (game?.phase === 'bottom') dispatch({ type: 'bottom', id })
    else setSelected(id)
  }

  const lands = game.zones.battlefield.filter((id) => isLandCard(cardOf(id)))
  const permanents = game.zones.battlefield.filter((id) => !isLandCard(cardOf(id)))

  function battlefieldRow(label: string, ids: string[]) {
    if (ids.length === 0) return null
    return (
      <section className="mb-18">
        <div className={SECTION_LABEL}>
          {label} · {ids.length}
        </div>
        <div className="flex flex-wrap items-center gap-8">
          {ids.map((id) => (
            <PlaytestCard
              key={id}
              card={cardOf(id)}
              size="battlefield"
              tapped={game!.tapped.includes(id)}
              onClick={() => setSelected(id)}
            />
          ))}
        </div>
      </section>
    )
  }

  const choosing = game.phase !== 'playing'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 px-gutter pt-screen-top desktop:px-0 desktop:pt-34">{header}</div>

      <ScrollArea className="pb-16 pl-gutter pr-gutter-lane desktop:pl-0 desktop:pr-scrollbar-lane">
        <div className="mb-18 flex flex-wrap gap-8">
          {SIDE_ZONES.filter((zone) => zone !== 'command' || deck.commanders.length > 0).map((zone) => (
            <Chip
              key={zone}
              variant="group"
              label={`${ZONE_LABELS[zone]} · ${game.zones[zone].length}`}
              selected={false}
              onClick={() => setOpenZone(zone)}
            />
          ))}
        </div>

        {choosing ? (
          <section>
            <div className={SECTION_LABEL}>
              {game.phase === 'bottom'
                ? `Put ${game.bottomPending} on the bottom`
                : `Hand · ${game.zones.hand.length}`}
            </div>
            <div className="flex flex-wrap gap-8">
              {game.zones.hand.map((id) => (
                <PlaytestCard key={id} card={cardOf(id)} size="hand" onClick={() => onHandCard(id)} />
              ))}
            </div>
          </section>
        ) : game.zones.battlefield.length === 0 ? (
          <p className="px-4 text-body leading-normal text-text-2">Tap a card in your hand to play it.</p>
        ) : (
          <>
            {/* Comme à la table : les permanents devant, les terrains près du
                joueur, donc au-dessus de la main. */}
            {battlefieldRow('Permanents', permanents)}
            {battlefieldRow('Lands', lands)}
          </>
        )}
      </ScrollArea>

      <div className="flex-shrink-0 border-t border-border px-gutter pb-12 pt-12 desktop:px-0">
        {game.phase === 'playing' && (
          <>
            <div className={SECTION_LABEL}>Hand · {game.zones.hand.length}</div>
            <div className="mb-12 flex gap-8 overflow-x-auto">
              {game.zones.hand.map((id) => (
                <PlaytestCard key={id} card={cardOf(id)} size="hand" onClick={() => onHandCard(id)} />
              ))}
            </div>
          </>
        )}
        <div className="flex gap-9">
          {game.phase === 'mulligan' && (
            <>
              <button
                type="button"
                disabled={game.mulligans >= 7}
                onClick={() => dispatch({ type: 'mulligan' })}
                className={SECONDARY_BUTTON}
              >
                Mulligan
              </button>
              <button type="button" onClick={() => dispatch({ type: 'keep' })} className={PRIMARY_BUTTON}>
                Keep
              </button>
            </>
          )}
          {game.phase === 'playing' && (
            <>
              <button
                type="button"
                disabled={game.zones.library.length === 0}
                onClick={() => dispatch({ type: 'draw' })}
                className={SECONDARY_BUTTON}
              >
                Draw
              </button>
              <button type="button" onClick={() => dispatch({ type: 'nextTurn' })} className={PRIMARY_BUTTON}>
                Next turn
              </button>
            </>
          )}
        </div>
      </div>

      <PlaytestCardSheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        card={selected ? cardOf(selected) : null}
        items={selectedItems}
        onAction={(action) => {
          dispatch(action)
          // Après avoir rangé une carte regardée, on revient aux suivantes.
          if (selectedZone === 'library' && looked.length > 0) setOpenZone('library')
        }}
      />

      <PlaytestZoneSheet
        zone={openZone}
        onOpenChange={(open) => {
          if (!open) setOpenZone(null)
        }}
        ids={openZone ? game.zones[openZone] : []}
        cardOf={cardOf}
        onCard={setSelected}
        looked={looked}
        onLook={(count) => setLooked(game.zones.library.slice(0, count))}
        onDraw={game.phase === 'playing' ? () => dispatch({ type: 'draw' }) : null}
        onShuffle={() => dispatch({ type: 'shuffle' })}
      />

      <ContextMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Game"
        items={[
          { key: 'untap', label: 'Untap all', onSelect: () => dispatch({ type: 'untapAll' }), disabled: game.phase !== 'playing' },
          { key: 'shuffle', label: 'Shuffle library', onSelect: () => dispatch({ type: 'shuffle' }) },
          { key: 'play', label: 'Restart on the play', onSelect: () => start(true) },
          { key: 'draw', label: 'Restart on the draw', onSelect: () => start(false) },
          {
            key: 'end',
            label: 'End game',
            onSelect: () => {
              setLooked([])
              setGame(null)
            },
          },
        ]}
      />
    </div>
  )
}
