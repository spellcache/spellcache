'use client'

// Écran de partie du compteur de vie (écrans `Life tracker · 4 players` et
// `Who goes first — seat highlight`) : grille
// plein écran, orientation, barre de partie et surbrillance bloquante. Le
// tirage se fait au lancement de la partie (réglage `Roll for first player`
// du setup) et sur le bouton `Roll` dédié de la barre — `Reset` ne tire
// jamais. Avant l'annonce, une lumière fait le tour des pavés et ralentit
// jusqu'au siège tiré (`rollSequence`), pour que la table voie qui commence.
//
// `fixed inset-0` : l'écran de partie masque la navigation et ne doit pas
// hériter de la réserve de 96px du shell. La réserve reste posée une seule fois, sur
// le `<main>` de `app/(app)/app-shell.tsx` ; ce panneau passe par-dessus au
// lieu de la combattre.
import { Crown, Dices, RotateCcw, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { LifePad } from '@/components/tools/life-pad'
import {
  lifeReducer,
  rollSequence,
  seatName,
  seatRows,
  seatTint,
  type LifeGame,
  type RollStep,
} from '@/lib/tools/life-state'

const ICON_STROKE = 1.75
const CROWN_STROKE = 1.8

// Wake Lock : détection à l'exécution plutôt qu'une déclaration de type
// optimiste — la partie doit démarrer sur un navigateur qui n'a pas l'API, et
// une demande refusée ne doit rien casser.
interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function screenWakeLock(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  const candidate: unknown = (navigator as unknown as { wakeLock?: unknown }).wakeLock
  if (!candidate || typeof candidate !== 'object') return null
  if (typeof (candidate as { request?: unknown }).request !== 'function') return null
  return candidate as WakeLockLike
}

// Voile bloquant qui annonce le premier joueur : la partie reste gelée tant
// que personne n'a tapé `Play`, il n'y a donc ni minuteur ni écoute
// `pointerdown` en capture à désarmer.
export function FirstPlayerOverlay({
  seat,
  players,
  onRollAgain,
  onPlay,
}: {
  seat: number
  players: number
  onRollAgain: () => void
  onPlay: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-20 bg-first-player-veil p-24 scheme-dark">
      {/* La tuile prend la teinte du siège tiré, celle du pavé que la
          lumière vient d'allumer : aucun numéro de siège n'est affiché sur la
          table, un chiffre ne désignait personne. */}
      <div
        className="flex h-first-player-tile w-first-player-tile items-center justify-center rounded-first-player-tile text-text"
        style={{ background: `color-mix(in oklab, ${seatTint(seat)} 70%, var(--color-surface-1))` }}
      >
        <Crown width={64} height={64} strokeWidth={CROWN_STROKE} />
      </div>
      <div className="text-first-player-label font-extrabold tracking-sheet-title text-text">
        {seatName(seat, players)} starts
      </div>
      <div className="flex w-full max-w-first-player-actions gap-10">
        <button
          type="button"
          onClick={onRollAgain}
          className="flex-1 rounded-control bg-surface-2 py-13 text-confirm-button font-bold text-text"
        >
          Roll again
        </button>
        <button
          type="button"
          onClick={onPlay}
          className="flex-1 rounded-control bg-accent py-13 text-confirm-button font-extrabold text-on-accent"
        >
          Play
        </button>
      </div>
    </div>
  )
}

// Bouton plat de la barre de partie : icône 19px et libellé texte — les
// quatre commandes (`Reset`, `{n} players`, `Roll`, `Quit`) partagent le
// même gabarit.
function BarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-5 py-8 text-life-bar-label font-semibold text-text"
    >
      <Icon width={19} height={19} strokeWidth={ICON_STROKE} />
      {label}
    </button>
  )
}

export function LifeGameScreen({
  game,
  onChange,
  onExit,
  rollOverlayOnMount = false,
}: {
  game: LifeGame
  // Mise à jour fonctionnelle : l'appui maintenu d'un pavé rejoue la même
  // fermeture toutes les 90ms, et plusieurs joueurs tapent en même temps —
  // un instantané de `game` figé au rendu perdrait leurs changements.
  onChange: (update: (game: LifeGame) => LifeGame) => void
  onExit: () => void
  // `Start game` avec `Roll for first player` actif : le tirage a déjà eu
  // lieu dans le setup, le tour de table puis le voile s'enchaînent à
  // l'ouverture de l'écran. Un simple
  // rechargement de page monte le même écran sans
  // rejouer l'ouverture.
  rollOverlayOnMount?: boolean
}) {
  // Tirage en deux temps : la lumière fait le tour de la table (`spin`), puis
  // le voile annonce le siège (`showOverlay`). `Start game` avec le tirage
  // actif ouvre l'écran directement sur la première phase.
  const [spin, setSpin] = useState<RollStep[] | null>(() =>
    rollOverlayOnMount && game.firstPlayer !== null
      ? rollSequence(game.setup.players, game.firstPlayer)
      : null,
  )
  const [spotlight, setSpotlight] = useState<number | null>(null)
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    if (!spin) return
    // Mouvement réduit demandé : pas de lumière qui tourne, l'annonce tout
    // de suite.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSpin(null)
      setShowOverlay(true)
      return
    }

    let step = 0
    let timer = 0
    const next = () => {
      const current = spin[step]
      if (!current) {
        setSpotlight(null)
        setSpin(null)
        setShowOverlay(true)
        return
      }
      setSpotlight(current.seat)
      step += 1
      timer = window.setTimeout(next, current.holdMs)
    }
    next()
    return () => window.clearTimeout(timer)
  }, [spin])

  useEffect(() => {
    if (!game.setup.keepAwake) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    // Une demande à la fois : montage et retour de visibilité rapprochés en
    // lanceraient deux, et le premier verrou ne serait jamais relâché.
    let pending = false

    async function acquire() {
      if (pending || (sentinel && !sentinel.released)) return
      pending = true
      const api = screenWakeLock()
      // Navigateur sans l'API : ignoré silencieusement, la partie tourne
      // quand même.
      if (!api) return
      try {
        const next = await api.request('screen')
        if (cancelled) {
          await next.release()
          return
        }
        sentinel = next
      } catch {
        // Demande refusée (onglet en arrière-plan, batterie faible,
        // politique du navigateur) — sans erreur remontée.
      } finally {
        pending = false
      }
    }

    void acquire()

    // Le navigateur relâche le verrou au changement d'onglet : il se
    // redemande au retour de visibilité.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      // Relâché à la sortie.
      void sentinel?.release().catch(() => {})
    }
  }, [game.setup.keepAwake])

  function adjust(seat: number, delta: number) {
    onChange((current) => lifeReducer(current, { type: 'adjust', seat, delta }))
  }

  function reset() {
    // Ne tire jamais : aucune ouverture du voile ici.
    onChange((current) => lifeReducer(current, { type: 'reset' }))
  }

  function roll() {
    // Le siège est tiré ici, avant l'animation qui le met en scène ; seul
    // `firstPlayer` est appliqué en mise à jour fonctionnelle, pour ne pas
    // écraser un total ajusté au même instant.
    const winner = lifeReducer(game, { type: 'roll' }).firstPlayer
    if (winner === null) return
    onChange((current) => ({ ...current, firstPlayer: winner }))
    setShowOverlay(false)
    setSpin(rollSequence(game.setup.players, winner))
  }

  const rows = seatRows(game.setup.players)

  function renderSeat(seat: number, flip: boolean) {
    return (
      <div key={seat} data-seat={seat} className="min-w-0 flex-1">
        <LifePad
          life={game.life[seat] ?? game.setup.startingLife}
          tint={seatTint(seat)}
          flip={flip}
          // La couronne attend la fin du tour de table : elle ne doit pas
          // trahir le résultat pendant que la lumière tourne.
          first={!spin && game.firstPlayer === seat}
          spotlight={spotlight === seat}
          onAdjust={(delta) => adjust(seat, delta)}
        />
      </div>
    )
  }

  return (
    // Partie toujours en sombre (`scheme-dark`), même en thème clair : les
    // teintes de siège et les totaux en couleur sont pensés pour un fond
    // sombre, et l'écran se joue posé sur une table, souvent en pénombre.
    <div className="fixed inset-0 z-30 flex flex-col gap-6 bg-bg px-6 pt-life-frame-top pb-life-frame-bottom scheme-dark">
      <div className="flex min-h-0 flex-1 gap-6">
        {rows.top.map((seat) => renderSeat(seat, true))}
      </div>

      <div className="flex flex-shrink-0 items-center justify-center gap-4 rounded-life-bar bg-surface-3">
        <BarButton icon={RotateCcw} label="Reset" onClick={reset} />
        <BarButton icon={Users} label={`${game.setup.players} players`} onClick={onExit} />
        <BarButton icon={Dices} label="Roll" onClick={roll} />
        <BarButton icon={X} label="Quit" onClick={onExit} />
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        {rows.bottom.map((seat) => renderSeat(seat, false))}
      </div>

      {/* Pendant le tour de table, la grille reste visible mais ne prend
          aucun appui : un total ajusté par erreur passerait inaperçu. */}
      {spin && (
        <div className="fixed inset-0 z-50" role="status">
          <span className="sr-only">Picking the first player…</span>
        </div>
      )}

      {showOverlay && game.firstPlayer !== null && (
        <FirstPlayerOverlay
          seat={game.firstPlayer}
          players={game.setup.players}
          onRollAgain={roll}
          onPlay={() => setShowOverlay(false)}
        />
      )}
    </div>
  )
}
