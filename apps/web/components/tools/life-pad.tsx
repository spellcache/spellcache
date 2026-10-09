'use client'

// Un pavé de la grille de partie.
//
// **Le pavé entier est retourné, l'ordre des boutons ne l'est jamais** :
// `−` et `+` gardent la même place dans le DOM et le même
// gestionnaire quel que soit `flip`, seule la rotation CSS de la racine
// change. Un pavé retourné rend donc le bouton `+` en bas de sa boîte
// écran — c'est-à-dire en haut pour le joueur assis en face, qui le lit à
// l'endroit. « Corriger » l'ordre ferait taper le mauvais bouton à ce
// joueur.
//
// `tint` est un nom de token (`var(--color-pip-*-bg)`, cf.
// `lib/tools/life-state.ts`), jamais une valeur hex : le fond et la bordure
// s'en dérivent par `color-mix` en style inline, la seule façon de composer
// une couleur portée par une prop sans écrire de littéral dans le composant
// (docs/development.md).
import { Crown, Minus, Plus, Skull } from 'lucide-react'
import { useRef, type PointerEvent } from 'react'

// Épaisseurs de trait reprises telles quelles du design validé quand il les
// donne (2 pour `+`/`−`, 1.8 pour la couronne) — le 1.75 de docs/development.md
// reste le défaut là où le design est muet.
const GLYPH_STROKE = 2
const CROWN_STROKE = 1.8
const SKULL_STROKE = 1.75

// Appui maintenu : un tap ajuste
// immédiatement, un appui plus long que 400ms répète ensuite toutes les
// 90ms — la table entière est la commande, il n'y a donc rien de petit à
// viser pour un ajustement rapide.
const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 90

export function LifePad({
  life,
  tint,
  flip = false,
  first = false,
  onAdjust,
}: {
  life: number
  tint: string
  flip?: boolean
  first?: boolean
  onAdjust: (delta: number) => void
}) {
  // `useRef`, pas `useState` : les timers ne pilotent aucun rendu, seule la
  // fonction `onChange` du parent doit s'exécuter à chaque pas.
  const holdTimer = useRef<number | null>(null)
  const repeatTimer = useRef<number | null>(null)

  function stopHold() {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    if (repeatTimer.current !== null) window.clearInterval(repeatTimer.current)
    holdTimer.current = null
    repeatTimer.current = null
  }

  function startHold(event: PointerEvent, delta: number) {
    // Clic droit ou molette : pas un ajustement.
    if (event.pointerType === 'mouse' && event.button !== 0) return
    stopHold()
    onAdjust(delta)
    holdTimer.current = window.setTimeout(() => {
      repeatTimer.current = window.setInterval(() => onAdjust(delta), REPEAT_EVERY_MS)
    }, REPEAT_DELAY_MS)
  }

  // Un joueur à zéro (ou en dessous) est mort : le total passe en `danger` et
  // une tête de mort le double, pour que la table le voie d'un coup d'oeil
  // sans lire le chiffre. Le pavé reste jouable — on peut regagner des points
  // (Commander : `Feed the Clan`, `Angel's Grace`), le total continue donc de
  // s'ajuster dans les deux sens.
  const dead = life <= 0

  return (
    <div
      // `data-life` : le total, lisible sans dépendre du texte rendu — la
      // puce `You start` de la surbrillance vit dans le même sous-arbre et
      // polluerait un `innerText` (`tests/e2e/life-tracker.spec.ts`).
      data-life={life}
      data-dead={dead ? 'true' : undefined}
      className={`relative h-full w-full overflow-hidden rounded-life-pad border text-text ${
        flip ? 'rotate-180' : ''
      }`}
      style={{
        background: `color-mix(in oklab, ${tint} 12%, var(--color-surface-1))`,
        borderColor: `color-mix(in oklab, ${tint} 34%, transparent)`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-8">
        {dead && <Skull width={34} height={34} strokeWidth={SKULL_STROKE} className="text-danger" />}
        <span
          className={`font-mono text-life-total font-extrabold leading-life-total tracking-life-total ${
            dead ? 'text-danger' : ''
          }`}
          style={dead ? undefined : { color: tint }}
        >
          {life}
        </span>
      </div>

      {/* Moitié haute : gagner. Moitié basse : perdre (« Tap the upper half
          of a pad to gain, the lower half to lose », note de design du
          compteur de vie). Ordre et gestionnaires identiques dans les deux
          orientations — voir l'en-tête. */}
      <button
        type="button"
        aria-label="Gain one life"
        onPointerDown={(event) => startHold(event, 1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        // Appui long Android : sans cela, le menu contextuel du navigateur
        // coupe l'appui maintenu.
        onContextMenu={(event) => event.preventDefault()}
        className="absolute inset-x-0 top-0 flex h-1/2 items-start justify-center bg-transparent pt-10 text-text-2 [touch-action:manipulation]"
      >
        <Plus width={22} height={22} strokeWidth={GLYPH_STROKE} />
      </button>
      <button
        type="button"
        aria-label="Lose one life"
        onPointerDown={(event) => startHold(event, -1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        // Appui long Android : sans cela, le menu contextuel du navigateur
        // coupe l'appui maintenu.
        onContextMenu={(event) => event.preventDefault()}
        className="absolute inset-x-0 bottom-0 flex h-1/2 items-end justify-center bg-transparent pb-10 text-text-2 [touch-action:manipulation]"
      >
        <Minus width={22} height={22} strokeWidth={GLYPH_STROKE} />
      </button>

      {/* Petite couronne conservée par le siège tiré une fois la
          surbrillance retombée. */}
      {first && (
        <span className="pointer-events-none absolute right-12 top-12 flex h-crown-badge w-crown-badge items-center justify-center rounded-full bg-crown-badge-bg text-warning">
          <Crown width={15} height={15} strokeWidth={CROWN_STROKE} />
        </span>
      )}
    </div>
  )
}
