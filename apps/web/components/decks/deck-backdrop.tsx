'use client'

// Fond de l'écran `Planning deck` et sa barre d'actions flottantes. Trois
// habillages, dans cet ordre de priorité — même ordre que `DeckRow` pour la
// ligne de la liste, adapté à ce fond plein écran :
//
// 1. Une dérogation explicite posée par `components/binders/look-sheet.tsx`
//    (`coverCardId`/`coverGradient` non nuls) — la même carte ou le même
//    dégradé qu'un binder afficherait, module par `coverIntensity` (le
//    bouton `palette` ouvre la feuille d'apparence des binders, donc les
//    mêmes deux dérogations, `Intensity` compris).
// 2. Sans dérogation (`coverCardId`/`coverGradient` tous deux `null`, le
//    mode `commander`/`none` de `BinderLook`) : le commandant s'il y en a un
//    — piloté par `coverIntensity` (l'art du commandant n'est figé à aucune
//    opacité fixe, le même curseur
//    `Intensity` de `Deck look` module aussi ce fond qu'une dérogation soit
//    posée ou non) — sinon le dégradé d'identité colorée s'il y a un
//    format, à pleine intensité (même absence de réglage que
//    `binderRowBackground(key, 1)` pour la ligne de la liste) — sinon
//    rien (surface nue).
//
// Les deux bornes 330px/430px (fond commandant) se recouvrent
// volontairement : ne pas les aligner.
import { ChevronLeft, Ellipsis } from 'lucide-react'

import type { GradientKey } from '@/lib/binders/gradients'
import { BACKDROP_FADE_MASK, BACKDROP_SCRIM, binderBackdropGradient } from '@/lib/binders/gradients'
import { useCanEdit } from '@/lib/collections/access-context'

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-back-button w-back-button flex-shrink-0 items-center justify-center rounded-full bg-header-icon-veil text-text scheme-dark"
    >
      {children}
    </button>
  )
}

// La couche d'art seule (art/dégradé + masque de fondu + voile), sans la
// rangée de boutons — exportée pour que `deck-view.tsx` puisse la dupliquer
// comme fond du bloc titre + onglets épinglé (en-tête repliable, demande
// produit : « garder l'art » derrière le titre figé). Alignée au pixel avec la
// couche du fond absolu tant que son conteneur la décale de la même hauteur
// que la réserve des boutons (`-top-deck-controls-reserve`).
export function DeckBackdropArt({
  commanderArtUrl,
  coverGradient,
  coverCardId,
  coverArtUrl,
  coverIntensity,
}: {
  commanderArtUrl: string | null
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  coverIntensity: number
}) {
  // Ordre de `resolveDeckLook` (lib/decks/deck-look.ts), le même que la
  // ligne de liste et la tuile : carte choisie, dégradé choisi, commandant.
  const artUrl = coverCardId !== null ? coverArtUrl : coverGradient === null ? commanderArtUrl : null

  if (coverCardId === null && coverGradient) {
    return (
      <div className="absolute inset-x-0 top-0 h-deck-backdrop" style={{ opacity: coverIntensity }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: binderBackdropGradient(coverGradient),
            maskImage: BACKDROP_FADE_MASK,
            WebkitMaskImage: BACKDROP_FADE_MASK,
          }}
        />
        <div className="absolute inset-0" style={{ backgroundImage: BACKDROP_SCRIM }} />
      </div>
    )
  }

  if (artUrl === null) return null

  return (
    <div className="absolute inset-x-0 top-0 h-deck-backdrop">
      {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne */}
      <img
        src={artUrl}
        alt=""
        className="h-full w-full object-cover"
        style={{
          opacity: coverIntensity,
          maskImage: BACKDROP_FADE_MASK,
          WebkitMaskImage: BACKDROP_FADE_MASK,
        }}
      />
      <div className="absolute inset-0" style={{ backgroundImage: BACKDROP_SCRIM }} />
    </div>
  )
}

export function DeckBackdrop({
  commanderArtUrl,
  coverGradient,
  coverCardId,
  coverArtUrl,
  coverIntensity,
  onBack,
  onMore,
}: {
  commanderArtUrl: string | null
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  coverIntensity: number
  onBack: () => void
  onMore: () => void
}) {
  // Lecture seule (`viewer`) : pas de menu d'actions du deck.
  const canEdit = useCanEdit()
  const artUrl = coverCardId !== null ? coverArtUrl : coverGradient === null ? commanderArtUrl : null
  // Un fond vient d'un choix (dérogation posée dans `Deck look`) ou, à
  // défaut, de l'illustration du commandant. **Jamais** d'un dégradé dérivé
  // du format ou de l'identité colorée : c'était une invention de notre côté,
  // et elle habillait de 440px de dégradé un deck vide dont personne n'avait
  // demandé d'habillage — d'où le grand vide sous le titre, avant même la
  // première carte. Un deck sans commandant et sans dérogation n'a pas de
  // fond, et son en-tête tient sur une ligne.
  const hasBackdrop = coverGradient !== null || artUrl !== null

  return (
    // `min-h-deck-backdrop` réserve la hauteur peinte (430px) quand un fond
    // existe (même défaut et même correction que `min-h-binder-backdrop` sur
    // `components/binders/binder-header.tsx`) : les fonds ci-dessous sont
    // peints par des enfants `absolute`, qui
    // ne contribuent jamais à la hauteur `auto` de ce conteneur — sans cette
    // réserve, seule la rangée de boutons (en flux normal) dictait sa
    // hauteur, et le dégradé/l'art étaient tronqués au-delà.
    <div
      className={`absolute inset-x-0 top-0 overflow-hidden ${hasBackdrop ? 'min-h-deck-backdrop' : ''}`}
    >
      <DeckBackdropArt
        commanderArtUrl={commanderArtUrl}
        coverGradient={coverGradient}
        coverCardId={coverCardId}
        coverArtUrl={coverArtUrl}
        coverIntensity={coverIntensity}
      />

      <div className="relative box-content flex min-h-header-row items-center gap-10 px-16 pt-screen-top">
        <IconButton label="Back" onClick={onBack}>
          <ChevronLeft width={20} height={20} strokeWidth={1.75} />
        </IconButton>
        <div className="flex-1" />
        {canEdit && (
          <IconButton label="Deck actions" onClick={onMore}>
            <Ellipsis width={18} height={18} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
