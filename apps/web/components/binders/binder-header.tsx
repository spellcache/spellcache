'use client'

// En-tête de l'écran `Binder · card-art backdrop` : fond en `art_crop`/dégradé
// plein cadre assombri par un voile, en-tête retour + `···`
// (apparence/renommer/supprimer) + ajout, puis titre + valeur. Pas de bouton
// palette dédié : `Binder look` est déjà une entrée du menu `···`
// (`container-action-sheets.tsx`), et deux chemins vers la même feuille dans le
// même en-tête n'en valaient pas la place. La liste de cartes et sa command bar
// restent rendues par `container-view.tsx`, inchangées, sous ce bloc.
//
// Les feuilles elles-mêmes vivent depuis le layout desktop dans
// `components/binders/container-action-sheets.tsx`, montées une seule fois par
// `container-view.tsx` : cet en-tête ne se voit pas au-delà de 768px, où
// `MainHeader` prend le relais, et les garder ici rendait `Binder look`,
// `Rename`, `Delete binder`, `Share` et `Export list` inatteignables sur
// desktop. Les deux en-têtes ouvrent donc le même
// état, sur les mêmes composants.
import { ChevronLeft, Ellipsis, Plus } from 'lucide-react'

import {
  BACKDROP_FADE_MASK,
  BACKDROP_SCRIM,
  binderBackdropGradient,
  type GradientKey,
} from '@/lib/binders/gradients'
import { useCanEdit } from '@/lib/collections/access-context'
import { ArtCredit } from '@/components/cards/art-credit'
import { formatCount, formatMoney, type Currency } from '@/lib/format/money'

import { lookFromHeader } from './container-action-sheets'

// Partagée avec `container-view.tsx` — la command bar doit
// savoir, sans dupliquer ce calcul, si l'écran a un fond d'art derrière elle
// (pour passer `translucent` à `CommandBar`) exactement comme cet en-tête le
// sait déjà pour son propre fond.
export function binderHasCover({
  coverGradient,
  coverCardId,
  coverIntensity,
  binderBackdrops,
}: {
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverIntensity: number
  binderBackdrops: boolean
}): boolean {
  const look = lookFromHeader({ coverGradient, coverCardId, coverIntensity })
  return binderBackdrops && look.mode !== 'none'
}

function IconButton({
  label,
  illustrated,
  accent,
  onClick,
  children,
}: {
  label: string
  illustrated: boolean
  accent?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const className = accent
    ? 'flex h-header-add-binder w-header-add-binder flex-shrink-0 items-center justify-center rounded-full bg-accent text-on-accent'
    : `flex h-back-button w-back-button flex-shrink-0 items-center justify-center rounded-full text-text ${
        illustrated ? 'bg-header-icon-veil' : 'bg-surface-1'
      }`
  return (
    <button type="button" aria-label={label} onClick={onClick} className={className}>
      {children}
    </button>
  )
}

// La couche d'art seule d'un binder illustré (art/dégradé + masque de fondu
// + voile), sans conteneur positionné — exportée pour que
// `container-view.tsx` puisse la dupliquer comme fond du bloc titre + barre
// de commande épinglé (en-tête repliable, demande produit : « garder
// l'art » derrière le bloc figé, jamais un fond opaque). Alignée au pixel
// avec la couche de `BinderHeaderBackdrop` tant que son conteneur reprend la
// même hauteur (`h-binder-backdrop`) et le décalage mesuré via `rootRef`.
export function BinderBackdropArt({
  coverGradient,
  coverCardId,
  coverArtUrl,
  coverIntensity,
}: {
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  coverIntensity: number
}) {
  const look = lookFromHeader({ coverGradient, coverCardId, coverIntensity })

  return (
    <>
      {look.mode === 'art' && coverArtUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxy interne
        <img
          src={coverArtUrl}
          alt=""
          className="h-full w-full object-cover"
          style={{
            opacity: coverIntensity,
            maskImage: BACKDROP_FADE_MASK,
            WebkitMaskImage: BACKDROP_FADE_MASK,
          }}
        />
      ) : look.mode === 'colour' ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: binderBackdropGradient(look.gradient),
            opacity: coverIntensity,
            maskImage: BACKDROP_FADE_MASK,
            WebkitMaskImage: BACKDROP_FADE_MASK,
          }}
        />
      ) : null}
      <div className="absolute inset-0" style={{ backgroundImage: BACKDROP_SCRIM }} />
    </>
  )
}

// Fond + rangée de boutons d'un binder illustré, SANS le bloc titre/méta
// (demande produit : « le défilement doit d'abord replier la zone vide du
// fond au-dessus du titre, puis figer le bloc titre/méta + la barre de
// commande en haut ») — extrait plutôt que réutilisé en interne par
// `BinderHeader` ci-dessous : `BinderHeader` reste intact pour les deux
// usages qui n'ont pas besoin de ce découpage (binder sans fond, binder à
// fond sans aucune carte — rien à faire défiler), afin de ne jamais risquer
// de régression sur son rendu déjà vérifié. Cette variante est montée par
// `container-view.tsx` HORS du conteneur de défilement (comme
// `DeckBackdrop`) ; le bloc titre/méta correspondant (`BinderTitleMeta`
// ci-dessous) est lui rendu par `VirtualList` via son prop `scrollHeader`, DANS
// le défilement, pour se replier puis se figer.
export function BinderHeaderBackdrop({
  coverGradient,
  coverCardId,
  coverArtUrl,
  coverIntensity,
  binderBackdrops,
  rootRef,
  onAddCard,
  onOpenMenu,
}: {
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  coverIntensity: number
  binderBackdrops: boolean
  // En-tête repliable (demande produit) : `container-view.tsx` mesure la
  // position de ce fond pour aligner au pixel la copie de l'art peinte par
  // le bloc titre + commande épinglé (voir `BinderBackdropArt` ci-dessous).
  rootRef?: React.Ref<HTMLDivElement>
  onAddCard: () => void
  onOpenMenu: () => void
}) {
  const hasCover = binderHasCover({ coverGradient, coverCardId, coverIntensity, binderBackdrops })
  const veiled = hasCover && coverIntensity > 0
  // Lecture seule (`viewer`) : ni menu d'actions, ni ajout.
  const canEdit = useCanEdit()

  return (
    // Même bleed `-mx-16 -mt-screen-top` que `BinderHeader` ci-dessous (même
    // piège : n'annule que le padding mobile `px-16 pt-screen-top` du
    // conteneur, pas
    // `desktop:px-20 desktop:pt-30` — imprécision déjà présente avant ce
    // découpage, hors périmètre de cette demande). Pas de `mb-14` ici :
    // `container-view.tsx` pose la réserve en flux (`h-binder-controls-
    // reserve`) comme sibling après ce composant, à la place de cette marge.
    <div ref={rootRef} className="relative -mx-16 -mt-screen-top">
      {veiled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-binder-backdrop overflow-hidden"
        >
          <BinderBackdropArt
            coverGradient={coverGradient}
            coverCardId={coverCardId}
            coverArtUrl={coverArtUrl}
            coverIntensity={coverIntensity}
          />
        </div>
      )}

      {/* Posés sur le haut sombre de l'illustration : boutons en valeurs
          sombres même en thème clair (`scheme-dark`). */}
      <div
        className={`relative flex min-h-header-row items-center gap-10 px-16 pt-screen-top box-content ${veiled ? 'scheme-dark' : ''}`}
      >
        <IconButton label="Back" illustrated={veiled} onClick={() => window.history.back()}>
          <ChevronLeft width={20} height={20} strokeWidth={1.75} />
        </IconButton>
        <div className="flex-1" />
        {/* Le `···` reste pour un Guest : son menu se réduit à « Export
            list » (container-action-sheets.tsx). Le `+` est réservé à
            l'écriture. */}
        <IconButton label="Binder actions" illustrated={veiled} onClick={onOpenMenu}>
          <Ellipsis width={18} height={18} strokeWidth={1.75} />
        </IconButton>
        {canEdit && (
          <IconButton label="Add card" illustrated={veiled} accent onClick={onAddCard}>
            <Plus width={20} height={20} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
    </div>
  )
}

// Bloc titre + méta d'un binder illustré, SANS le fond ni la rangée de
// boutons (voir `BinderHeaderBackdrop` ci-dessus) — rendu à l'intérieur du
// défilement, dans le bloc collant `sticky` que compose `container-view.tsx`
// (même geste que `deckTitleBlock` de `deck-view.tsx`). N'affiche
// jamais le fil d'ariane « Collection » : ce bloc n'existe que pour un
// binder illustré (`hasCover`), et `BinderHeader` ci-dessous le masque déjà
// dans ce cas.
export function BinderTitleMeta({
  name,
  cardCount,
  valueMinor,
  currency,
  artist = null,
}: {
  name: string
  cardCount: number
  valueMinor: number
  currency: Currency
  // Artiste de l'illustration de fond, `null` pour un dégradé.
  artist?: string | null
}) {
  return (
    // Pas de `scheme-dark` ici : le titre s'assoit là où l'illustration se
    // fond dans le fond de page — texte de la page, ombre adaptée au thème.
    <div>
      <h1 className="text-title-binder font-extrabold tracking-title-binder text-shadow-binder-title text-text">
        {name}
      </h1>
      <div className="mt-4 text-body text-text/75">
        {formatCount(cardCount)} cards · {formatMoney(valueMinor, currency)}
      </div>
      <ArtCredit artist={artist} />
    </div>
  )
}

export function BinderHeader({
  name,
  cardCount,
  valueMinor,
  currency,
  coverGradient,
  coverCardId,
  coverArtUrl,
  coverArtist = null,
  coverIntensity,
  binderBackdrops,
  onAddCard,
  onOpenMenu,
}: {
  name: string
  cardCount: number
  valueMinor: number
  currency: Currency
  coverGradient: GradientKey | null
  coverCardId: string | null
  coverArtUrl: string | null
  coverArtist?: string | null
  coverIntensity: number
  // Préférence de compte `Binder backdrops` : à `false`, l'en-tête se rend
  // comme en mode `None`, sans jamais modifier
  // `coverGradient`/`coverCardId`/`coverIntensity` — passés tels quels à
  // `LookSheet` par `container-view.tsx`, pour que la feuille `Binder look`
  // continue de présélectionner l'apparence réellement enregistrée même pendant
  // que la préférence est désactivée.
  binderBackdrops: boolean
  onAddCard: () => void
  onOpenMenu: () => void
}) {
  const look = lookFromHeader({ coverGradient, coverCardId, coverIntensity })
  const hasCover = binderHasCover({ coverGradient, coverCardId, coverIntensity, binderBackdrops })
  // À `intensity = 0`, l'écran doit rester pixel-pour-pixel identique au
  // mode `None` — le fond illustré s'efface déjà via `opacity: coverIntensity`
  // ci-dessous, mais les boutons ronds gardaient la pastille translucide
  // `bg-header-icon-veil` quel que soit `coverIntensity` : `veiled` couvre les
  // deux, pas seulement le fond.
  const veiled = hasCover && coverIntensity > 0
  // Lecture seule (`viewer`) : ni menu d'actions, ni ajout.
  const canEdit = useCanEdit()

  return (
    <div
      // Le bloc ne réserve plus la hauteur du fond : il ne fait que celle de
      // son contenu (rangée de boutons, titre, valeur). Le fond, lui, est un
      // calque `absolute` de 460px posé derrière (`-z-10`), qui déborde donc
      // sous la barre de commande et les premières lignes — où il ne vaut
      // déjà plus que quelques pour cent. C'est ce qui supprime les ~210px de
      // vide qui
      // séparaient le titre de la barre de commande : la hauteur réservée
      // était celle du fond, pas celle de quoi que ce soit de lisible.
      className="relative -mx-16 -mt-screen-top mb-14"
    >
      {veiled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-binder-backdrop overflow-hidden"
        >
          {/* Même modèle pour l'art ET la couleur : la couche (image ou
              dégradé) porte `intensity` et se dissout par le masque sur
              toute la hauteur ; le voile de lisibilité, lui, reste à pleine
              force — il n'est jamais modulé par l'intensité. Une image à
              demi-opacité + un dégradé se refermant sur le fond opaque
              couperait l'illustration net et la rendrait deux fois trop
              sombre (opacités composées). */}
          {look.mode === 'art' && coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- proxy interne
            <img
              src={coverArtUrl}
              alt=""
              className="h-full w-full object-cover"
              style={{
                opacity: coverIntensity,
                maskImage: BACKDROP_FADE_MASK,
                WebkitMaskImage: BACKDROP_FADE_MASK,
              }}
            />
          ) : look.mode === 'colour' ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: binderBackdropGradient(look.gradient),
                opacity: coverIntensity,
                maskImage: BACKDROP_FADE_MASK,
                WebkitMaskImage: BACKDROP_FADE_MASK,
              }}
            />
          ) : null}
          <div className="absolute inset-0" style={{ backgroundImage: BACKDROP_SCRIM }} />
        </div>
      )}

      <div className="relative flex flex-col px-16 pt-screen-top">
        {/* Boutons sur le haut sombre de l'illustration : valeurs sombres en
            thème clair aussi (`scheme-dark`). Le titre, plus bas, s'assoit
            là où l'illustration se fond dans la page : texte de la page. */}
        <div className={`mb-binder-title-gap flex min-h-header-row items-center gap-10 ${veiled ? 'scheme-dark' : ''}`}>
          <IconButton
            label="Back"
            illustrated={veiled}
            onClick={() => window.history.back()}
          >
            <ChevronLeft width={20} height={20} strokeWidth={1.75} />
          </IconButton>
          <div className="flex-1" />
          {/* Même règle que `BinderHeaderBackdrop` : `···` toujours, `+`
              en écriture seulement. */}
          <IconButton label="Binder actions" illustrated={veiled} onClick={onOpenMenu}>
            <Ellipsis width={18} height={18} strokeWidth={1.75} />
          </IconButton>
          {canEdit && (
            <IconButton label="Add card" illustrated={veiled} accent onClick={onAddCard}>
              <Plus width={20} height={20} strokeWidth={1.75} />
            </IconButton>
          )}
        </div>

        {/* Masqué quand le binder est thémé — un fil d'ariane sur un fond
            d'illustration répéterait ce que le bouton retour dit déjà, sans rien ajouter que
            l'écran ne montre déjà par son fond. */}
        {!hasCover && (
          <div className="mb-2 text-breadcrumb-container font-bold uppercase tracking-section-label text-text-3">
            Collection
          </div>
        )}
        <h1 className="text-title-binder font-extrabold tracking-title-binder text-shadow-binder-title text-text">
          {name}
        </h1>
        <div className="mt-4 text-body text-text/75">
          {formatCount(cardCount)} cards · {formatMoney(valueMinor, currency)}
        </div>
        {veiled && look.mode === 'art' && coverArtUrl && <ArtCredit artist={coverArtist} />}
      </div>
    </div>
  )
}
