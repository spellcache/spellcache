'use client'

// Carte de deck de 152px de la vue étagères de l'onglet `Decks`.
// Trois habillages de la bande d'illustration, choisis dans le même ordre
// que `DeckRow` pour que les deux rendus du même onglet ne divergent
// pas : `art_crop` du commandant s'il y en a un ; à défaut, dégradé
// d'identité colorée dès qu'un format est posé ; à défaut (aucun format),
// bloc `#101319` avec le glyphe de cartes empilées.
//
// « Aucun format » se lit sur `status.kind === 'noFormat'` — le seul statut
// qu'`evaluateDeck` produise pour `format === null` : `DeckCardData` ne
// porte pas de champ `format`, et cette vue n'en ajoute aucun.
//
// La ligne de statut reprend telle quelle celle calculée par `evaluateDeck` :
// aucune règle de légalité n'est écrite ici, et le seul import de logique de
// deck de ce fichier est `lib/decks/legality` (pour son type).
import { Check, CircleHelp, Layers3, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

import type { DeckCardData } from '@/app/(app)/decks/folders-data'
import { binderRowBackground } from '@/lib/binders/gradients'
import { gradientKeyForIdentity } from '@/lib/decks/identity'
import { formatMoney, type Currency } from '@/lib/format/money'

// Icône de la ligne de statut, 12px (référence ligne 40) ; glyphe de repli
// sans illustration, 26px (ligne 96). Attributs SVG, pas une boîte CSS : le
// preflight Tailwind ne force `height: auto` que sur `img`/`video`, jamais
// sur un `svg` — même convention que le reste des icônes lucide du projet.
const STATUS_ICON_SIZE = 12
const FALLBACK_GLYPH_SIZE = 26
const STROKE_WIDTH = 1.75

export interface DeckCardGesture {
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void
  onClickCapture?: (event: ReactMouseEvent<HTMLElement>) => void
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
}

// Formes courtes : « Legal » / « Built » / « No
// format » plutôt que la phrase entière d'`evaluateDeck` (« Legal for
// Modern », « No format set ») — à 152px de large, la tuile n'a la place que
// pour un mot. Un statut `needsWork`, lui, garde son libellé complet
// (« 36 short · 2 duplicates ») : c'est la seule ligne qui dit CE qui manque,
// l'écourter perdrait l'information que la tuile existe pour montrer.
function shortStatusLabel(status: DeckCardData['status']): string {
  if (status.kind === 'built') return 'Built'
  if (status.kind === 'legal') return 'Legal'
  if (status.kind === 'noFormat') return 'No format'
  return status.label
}

function StatusLine({ status }: { status: DeckCardData['status'] }) {
  // Format sans règles (tout sauf Commander) : la tuile n'affiche aucun
  // statut — rien de spécial à vérifier.
  if (status.kind === 'noRules') return null

  const label = shortStatusLabel(status)

  if (status.kind === 'needsWork') {
    return (
      <div className="mt-8 flex items-center gap-5 text-deck-card-status font-bold text-warning">
        <TriangleAlert width={STATUS_ICON_SIZE} height={STATUS_ICON_SIZE} strokeWidth={STROKE_WIDTH} />
        <span className="min-w-0 truncate">{label}</span>
      </div>
    )
  }

  if (status.kind === 'noFormat') {
    // Couleur de statut neutre (l'étagère `Unsorted` utilise la même carte
    // que les autres, avec la couleur de statut neutre — pas un rendu
    // spécial) : c'est bien le statut du deck qui choisit cette teinte, jamais
    // l'étagère où il est rangé.
    return (
      <div className="mt-8 flex items-center gap-5 text-deck-card-status font-bold text-text-2">
        <CircleHelp width={STATUS_ICON_SIZE} height={STATUS_ICON_SIZE} strokeWidth={STROKE_WIDTH} />
        <span className="min-w-0 truncate">{label}</span>
      </div>
    )
  }

  // `built` et `legal` — même regroupement visuel que `StatusChip`.
  return (
    <div className="mt-8 flex items-center gap-5 text-deck-card-status font-bold text-success">
      <Check width={STATUS_ICON_SIZE} height={STATUS_ICON_SIZE} strokeWidth={STROKE_WIDTH} />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}

// Repli sans identité colorée : « {N} cards » à la
// place des pips — un deck sans terrain ni sort coloré (ou pas encore de
// commandant choisi) ne laisse aucune pastille à dessiner, la tuile disait
// alors moins que ce qu'elle sait déjà (`cardCount`).
function IdentityPips({
  colorIdentity,
  cardCount,
}: {
  colorIdentity: string[] | undefined
  cardCount: number
}) {
  const identity = colorIdentity ?? []
  if (identity.length === 0) {
    return (
      <span className="flex-shrink-0 text-deck-card-price text-text-2">
        {cardCount} card{cardCount === 1 ? '' : 's'}
      </span>
    )
  }
  return (
    <span className="flex flex-shrink-0 items-center gap-2">
      {identity.map((color) => (
        // eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/
        <img
          key={color}
          src={`/mana/${color}.svg`}
          alt=""
          // Boîte forcée en CSS, pas en attributs `width`/`height` : le
          // preflight Tailwind pose `img { height: auto }`, qui l'emporte
          // sur l'attribut (même piège que `--width-icon-set-tile`).
          className="h-deck-card-pip w-deck-card-pip"
        />
      ))}
    </span>
  )
}

function ArtBand({ deck, lazy }: { deck: DeckCardData; lazy: boolean }) {
  if (deck.artUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser
      <img
        src={deck.artUrl}
        alt=""
        loading={lazy ? 'lazy' : undefined}
        // `opacity: .9` du design validé, en utilitaire Tailwind plutôt qu'en
        // style en ligne — l'échelle d'opacité est statique, elle ne dépend
        // d'aucun jeton manquant.
        className="block h-deck-card-art w-full object-cover opacity-90"
      />
    )
  }

  if (deck.coverGradient || deck.status.kind !== 'noFormat') {
    // Dégradé choisi, sinon dégradé d'identité colorée — exactement la
    // formule de la ligne de deck (`binderRowBackground`,
    // `lib/binders/gradients.ts`, l'un des deux seuls fichiers autorisés à
    // porter une valeur hex), jamais un second dégradé recopié dans ce
    // composant (docs/development.md).
    const gradient = deck.coverGradient ?? gradientKeyForIdentity(deck.colorIdentity)
    return (
      <div
        style={{ backgroundImage: binderRowBackground(gradient, 1) }}
        className="h-deck-card-art w-full bg-bg scheme-dark"
      />
    )
  }

  return (
    <div className="flex h-deck-card-art w-full items-center justify-center bg-deck-card-art-fallback text-deck-card-glyph">
      <Layers3 width={FALLBACK_GLYPH_SIZE} height={FALLBACK_GLYPH_SIZE} strokeWidth={STROKE_WIDTH} />
    </div>
  )
}

export function DeckCard({
  deck,
  currency,
  lazy = false,
  gesture,
}: {
  deck: DeckCardData
  currency: Currency
  // Carte au-delà de la première étagère visible (même chargement paresseux
  // que les étagères de la collection) — posé par l'appelant, qui seul connaît
  // le rang de son étagère.
  lazy?: boolean
  gesture?: DeckCardGesture
}) {
  return (
    <Link
      href={`/decks/${deck.id}`}
      data-deck-id={deck.id}
      // Le glisser natif d'un lien (image fantôme du navigateur) partirait
      // d'un appui long, à la place du menu de la tuile.
      draggable={false}
      aria-label={deck.name}
      className="w-deck-card flex-shrink-0 snap-start overflow-hidden rounded-deck-card border border-border-deck-card bg-surface-1"
      {...gesture}
    >
      <ArtBand deck={deck} lazy={lazy} />
      <div className="px-11 pb-12 pt-10">
        <div className="truncate text-deck-card-name font-bold text-text">{deck.name}</div>
        <div className="mt-4 flex items-center gap-5">
          <IdentityPips colorIdentity={deck.colorIdentity} cardCount={deck.cardCount} />
          <span className="ml-auto text-deck-card-price font-bold text-accent-light">
            {formatMoney(deck.priceMinor, currency)}
          </span>
        </div>
        <StatusLine status={deck.status} />
      </div>
    </Link>
  )
}
