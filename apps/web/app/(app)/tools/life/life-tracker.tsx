'use client'

// Compteur de vie — setup et partie. Îlot client unique : c'est lui qui tient la
// seule entrée `localStorage` du projet (`lib/tools/life-state.ts`), la
// configuration comme la partie en cours, si bien qu'un rechargement de page
// retombe sur le même écran.
import { Dices, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { LifeGameScreen } from '@/components/tools/life-game'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Switch } from '@/components/ui/switch'
import {
  DEFAULT_LIFE_SETUP,
  PLAYER_COUNTS,
  STARTING_LIFE_PRESETS,
  lifeReducer,
  loadLifeState,
  parseStartingLife,
  saveLifeState,
  startLifeGame,
  type LifeSetup,
  type LifeState,
} from '@/lib/tools/life-state'

const ICON_STROKE = 1.75

const INITIAL_STATE: LifeState = { setup: DEFAULT_LIFE_SETUP, game: null }

function isPreset(life: number): boolean {
  return (STARTING_LIFE_PRESETS as readonly number[]).includes(life)
}

export function LifeTracker() {
  // Rendu serveur et premier rendu client partagent `INITIAL_STATE` : la
  // reprise se fait dans l'effet, jamais pendant l'hydratation (aucun accès
  // à `window` au rendu).
  const [state, setState] = useState<LifeState>(INITIAL_STATE)
  const [loaded, setLoaded] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [rollOverlayOnMount, setRollOverlayOnMount] = useState(false)

  useEffect(() => {
    const stored = loadLifeState()
    if (stored) {
      setState(stored)
      if (!isPreset(stored.setup.startingLife))
        setOtherText(String(stored.setup.startingLife))
    }
    setLoaded(true)
  }, [])

  // Rien n'est écrit tant que la reprise n'a pas eu lieu : autrement le
  // premier rendu écraserait la dernière configuration par le défaut.
  useEffect(() => {
    if (loaded) saveLifeState(state)
  }, [state, loaded])

  function updateSetup(patch: Partial<LifeSetup>) {
    setState({ ...state, setup: { ...state.setup, ...patch } })
  }

  function startGame() {
    setState({ setup: state.setup, game: startLifeGame(state.setup) })
    setRollOverlayOnMount(state.setup.rollForFirst)
  }

  function exitGame() {
    if (!state.game) return
    // `{ type: 'end' }` rend l'instantané final ; quitter, c'est cet écran
    // qui cesse de le tenir (`lifeReducer` renvoie toujours un `LifeGame`,
    // jamais `null`).
    const finished = lifeReducer(state.game, { type: 'end' })
    setState({ setup: finished.setup, game: null })
    setRollOverlayOnMount(false)
  }

  if (state.game) {
    return (
      <LifeGameScreen
        game={state.game}
        rollOverlayOnMount={rollOverlayOnMount}
        onChange={(update) =>
          setState((current) => {
            if (!current.game) return current
            const next = update(current.game)
            return { setup: next.setup, game: next }
          })
        }
        onExit={exitGame}
      />
    )
  }

  const activeOther = !isPreset(state.setup.startingLife)

  return (
    <Screen
      header={<ScreenHeader title="Life tracker" breadcrumb="Tools" backHref="/tools" />}
    >
      <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
        Players
      </div>
      {/* Gouttières 9px. */}
      <div className="mb-22 flex gap-9">
        {PLAYER_COUNTS.map((count) => {
          const active = state.setup.players === count
          return (
            <button
              key={count}
              type="button"
              aria-pressed={active}
              onClick={() => updateSetup({ players: count })}
              className={`flex-1 rounded-control border py-14 text-center font-mono text-life-players font-extrabold ${
                active
                  ? 'border-accent bg-accent-bg text-accent-text'
                  : 'border-border bg-surface-2 text-text-2'
              }`}
            >
              {count}
            </button>
          )
        })}
      </div>

      <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
        Starting life
      </div>
      <div className="mb-9 flex gap-9">
        {STARTING_LIFE_PRESETS.map((life) => {
          const active = state.setup.startingLife === life
          return (
            <button
              key={life}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setOtherText('')
                updateSetup({ startingLife: life })
              }}
              className={`flex-1 rounded-control border py-14 text-center font-mono text-life-value font-extrabold ${
                active
                  ? 'border-accent bg-accent-bg text-accent-text'
                  : 'border-border bg-surface-2 text-text-2'
              }`}
            >
              {life}
            </button>
          )
        })}
      </div>
      {/* « Other » sur sa propre ligne pleine largeur, sous les trois
          pastilles — jamais un quatrième slot dans la même
          rangée. */}
      <div
        className={`mb-22 flex items-center gap-6 rounded-control border bg-surface-2 px-10 ${
          activeOther ? 'border-accent' : 'border-border'
        }`}
      >
        {/* `inputMode="numeric"` plutôt que `type="number"` : pas de
            chevrons ni de molette sur un champ centré (un entier positif,
            validé par `parseStartingLife`, jamais casté). */}
        <input
          aria-label="Other starting life"
          placeholder="Other"
          inputMode="numeric"
          value={otherText}
          onChange={(event) => {
            const raw = event.target.value
            setOtherText(raw)
            const parsed = parseStartingLife(raw)
            if (parsed !== null) updateSetup({ startingLife: parsed })
          }}
          className="w-full border-none bg-transparent py-13 text-center font-mono text-life-other font-bold text-text outline-none placeholder:text-text-2"
        />
      </div>

      <div className="mb-9 overflow-hidden rounded-life-toggle border border-border bg-surface-1">
        <SettingRow
          icon={<Dices width={18} height={18} strokeWidth={ICON_STROKE} />}
          label="Roll for first player"
          control={
            <Switch
              checked={state.setup.rollForFirst}
              onChange={(next) => updateSetup({ rollForFirst: next })}
              label="Roll for first player"
            />
          }
        />
      </div>
      <div className="mb-22 overflow-hidden rounded-life-toggle border border-border bg-surface-1">
        <SettingRow
          icon={<Sun width={18} height={18} strokeWidth={ICON_STROKE} />}
          label="Keep the screen awake"
          control={
            <Switch
              checked={state.setup.keepAwake}
              onChange={(next) => updateSetup({ keepAwake: next })}
              label="Keep the screen awake"
            />
          }
        />
      </div>

      <button
        type="button"
        onClick={startGame}
        className="w-full rounded-control bg-accent py-15 text-button-primary font-extrabold text-on-accent"
      >
        Start game
      </button>
    </Screen>
  )
}
