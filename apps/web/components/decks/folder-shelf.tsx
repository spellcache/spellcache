'use client'

// Étagère d'un dossier de decks : en-tête, piste, stub et tuile `New deck`.
//
// Ce fichier ne formate **aucun** montant : l'en-tête d'étagère porte le
// nombre de decks et rien d'autre (aucune valeur agrégée dans l'en-tête
// d'étagère, choix délibéré). Les cartes, elles, portent leur propre prix et
// sont rendues par l'appelant (`children`), pas par ce composant.
//
// La piste vient de `ShelfTrack` (`components/collection/shelf-track.tsx`), partagée
// avec l'onglet Collection : snap, barre masquée et navigation aux flèches ne
// sont posés qu'une seule fois.
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'

import { ShelfTrack } from '@/components/collection/shelf-track'
import { useCanEdit } from '@/lib/collections/access-context'

// Pas de défilement au clavier : largeur d'une carte (`--width-deck-card`,
// 152px) plus l'entrefer de la piste (`gap-10`, 10px), pour avancer d'une
// carte complète par appui — même convention que `ARROW_SCROLL_PX` de
// `Shelf`.
const ARROW_SCROLL_PX = 162

// Géométrie de la piste, en nombres, pour la seule mesure de débordement
// ci-dessous (jamais pour styler quoi que ce soit — les classes restent
// `gap-10` et `px-16`) : entrefer `--spacing-10` et padding latéral
// `--spacing-16`, app/globals.css.
const TRACK_GAP_PX = 10
const TRACK_SIDE_PADDING_PX = 16
// Largeur de la tuile `New deck` (`--width-deck-card`, 152px), pour la même
// mesure : la tuile ne s'affiche que si elle tient **entière** dans la
// largeur visible, à la suite des cartes.
const NEW_DECK_TILE_PX = 152

const NEW_DECK_ICON_SIZE = 18

// Une piste est « défilable » quand ses cartes suivies de la tuile `New
// deck` dépassent la largeur visible (une tuile coupée par le bord droit ne
// doit jamais apparaître — dès qu'elle ne tient pas, c'est le stub).
// Mesurée sur les cartes elles-mêmes, jamais sur `scrollWidth` de la piste
// entière : l'élément de fin fait partie de cette largeur, et le choisir
// d'après une mesure qui l'inclut oscillerait entre stub (60px) et tuile
// (152px) à chaque rendu.
function useCardsOverflow(trackRef: React.RefObject<HTMLDivElement | null>, deckCount: number): boolean {
  const [overflowing, setOverflowing] = useState(false)

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    let cardsWidth = 0
    for (const child of Array.from(track.children)) {
      if (!(child instanceof HTMLElement) || !child.dataset.deckId) continue
      cardsWidth += child.getBoundingClientRect().width + TRACK_GAP_PX
    }
    // Cartes, entrefers, puis la tuile (le dernier entrefer est le sien) ;
    // les deux paddings latéraux sont peints.
    const contentWidth = cardsWidth + NEW_DECK_TILE_PX + TRACK_SIDE_PADDING_PX * 2
    setOverflowing(contentWidth > track.clientWidth)
  }, [trackRef])

  // `useLayoutEffect` : la bascule stub/tuile se joue avant la peinture,
  // pour qu'aucune des deux ne clignote au montage.
  useLayoutEffect(measure, [measure, deckCount])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return overflowing
}

export function FolderShelf({
  name,
  deckCount,
  seeAllHref,
  unsorted = false,
  headerProps,
  onNewDeck,
  children,
}: {
  name: string
  // Un nombre de **decks**, jamais de cartes.
  deckCount: number
  // `null` masque le lien (étagère vide).
  seeAllHref: string | null
  unsorted?: boolean
  // Gestes de l'en-tête (appui long → menu du dossier), posés par l'appelant.
  headerProps?: HTMLAttributes<HTMLDivElement>
  onNewDeck: () => void
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const overflowing = useCardsOverflow(trackRef, deckCount)
  // Lecture seule (`viewer`) : pas de tuile `New deck`.
  const canEdit = useCanEdit()

  return (
    <div className="min-w-0">
      <div
        {...headerProps}
        data-folder-header=""
        className="mb-10 flex items-center justify-between px-16"
      >
        <div className="flex min-w-0 items-baseline gap-8">
          <span
            className={`min-w-0 truncate text-folder-name font-extrabold tracking-shelf-name ${
              unsorted ? 'text-folder-unsorted' : 'text-text'
            }`}
          >
            {name}
          </span>
          <span className="flex-shrink-0 font-mono text-folder-count text-text-2">{deckCount}</span>
        </div>
        {seeAllHref && (
          <Link href={seeAllHref} className="flex-shrink-0 text-see-all font-bold text-accent-text">
            See all
          </Link>
        )}
      </div>

      {/* `scroll-px-16` double le `px-16` : sans lui, le snap aligne la
          première carte sur le bord du scrollport et la piste s'ouvre
          déjà défilée de 16px — le padding gauche disparaît dès que la
          piste déborde (constat produit, 2026-09-06). */}
      <ShelfTrack
        trackRef={trackRef}
        label={`${name} decks`}
        scrollStep={ARROW_SCROLL_PX}
        className="gap-10 px-16 scroll-px-16 pb-22"
      >
        {children}
        {overflowing ? (
          // Stub pointillé de 60px en fin de piste défilable — décoratif,
          // il annonce seulement qu'il reste des cartes à droite.
          <div
            aria-hidden="true"
            data-testid="shelf-stub"
            className="w-shelf-stub flex-shrink-0 rounded-deck-card border border-dashed border-border-shelf-stub"
          />
        ) : canEdit ? (
          <button
            type="button"
            onClick={onNewDeck}
            className="flex min-h-deck-card w-deck-card flex-shrink-0 flex-col items-center justify-center gap-7 rounded-deck-card border-thin border-dashed border-border-new-deck-tile bg-transparent text-new-deck-tile font-semibold text-text-2"
          >
            <Plus width={NEW_DECK_ICON_SIZE} height={NEW_DECK_ICON_SIZE} strokeWidth={1.75} />
            New deck
          </button>
        ) : null}
      </ShelfTrack>
    </div>
  )
}
