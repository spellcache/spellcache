'use client'

// Bottom sheet Radix générique, partagé par plusieurs écrans : voile
// `rgba(4,5,8,0.6)`, panneau rayon `22 22 0 0` sur
// `#181b22`, en-tête titre + action optionnelle + fermeture ronde 32px.
//
// Comportement :
//   - bornée à 85dvh dans tous les cas, l'en-tête reste en place et le corps
//     défile seul (`ScrollArea`, curseur en surimpression) ;
//   - au-delà du point de bascule desktop, la feuille devient une modale
//     centrée de 540px max (82dvh, rayon plein) — une seule coquille
//     d'overlay, jamais un second modèle par écran ;
//   - au-dessus du toast Undo (z-50 contre z-45) : un toast ne peint jamais
//     par-dessus une feuille ouverte.
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useBackToClose } from '@/components/ui/use-back-to-close'

// Pour une `ScrollArea` posée par le contenu d'une feuille `scrollBody={false}` :
// la boîte déborde dans la marge latérale de la feuille et la zone défilante
// la reprend en padding. Le contenu garde sa largeur, et le curseur se place
// dans la marge, au bord de la feuille — pas par-dessus le contenu.
// Le contenu se met en page dans un `div` enfant, jamais en `flex` sur la
// zone défilante elle-même : bornée en hauteur, elle compresserait ses
// enfants (`overflow-hidden` ramène leur hauteur minimale à 0).
export const SHEET_SCROLL_BLEED = {
  outer: '-mx-sheet-pad desktop:-mx-sheet-pad-desktop',
  inner: 'px-sheet-pad desktop:px-sheet-pad-desktop',
}

export function Sheet({
  open,
  onOpenChange,
  title,
  headerAction,
  children,
  // Conservé pour compatibilité d'appel : la borne de hauteur est désormais
  // systématique (85dvh) — ce prop n'a plus d'effet.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxHeight = false,
  // Libellé de la fermeture ronde — `'Close'` par défaut sur tous les
  // appelants existants. Distinct uniquement pour une feuille montée alors
  // qu'une autre fermeture `aria-label="Close"` l'est déjà.
  closeLabel = 'Close',
  // `false` : le corps ne défile pas lui-même, il borne seulement la hauteur
  // de ses enfants. Pour une feuille qui pose sa propre `ScrollArea` suivie
  // d'un pied épinglé (Assemble, Filters) — imbriquée dans le défilement
  // par défaut, cette `ScrollArea` n'était jamais bornée, donc ne défilait
  // pas, et son `overscroll-contain` bloquait la molette vers le parent.
  scrollBody = true,
  // Hauteur fixe à la borne (85dvh, 82dvh desktop) au lieu de suivre le
  // contenu : pour une feuille dont la liste change de longueur sous
  // l'utilisateur (Assemble), qui sinon se redimensionne à chaque bascule.
  // `'card'` : la hauteur, plus basse, de la feuille de détail d'une carte.
  fixedHeight = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  headerAction?: ReactNode
  children: ReactNode
  maxHeight?: boolean | 'assemble'
  closeLabel?: string
  scrollBody?: boolean
  fixedHeight?: boolean | 'card'
}) {
  useBackToClose(open, () => onOpenChange(false))
  const bodyPadding =
    'px-sheet-pad pb-sheet-bottom desktop:px-sheet-pad-desktop desktop:pb-sheet-pad-desktop'
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-modal-veil" />
        <Dialog.Content
          className={`fixed inset-x-0 bottom-keyboard-inset z-50 flex max-h-sheet-default flex-col rounded-t-card bg-surface-3 outline-none desktop:inset-x-auto desktop:bottom-auto desktop:left-1/2 desktop:top-1/2 desktop:max-h-sheet-desktop desktop:w-full desktop:max-w-sheet-desktop desktop:-translate-x-1/2 desktop:-translate-y-1/2 desktop:rounded-card ${
            fixedHeight === 'card'
              ? 'h-sheet-card desktop:h-sheet-card-desktop'
              : fixedHeight
                ? 'h-sheet-default desktop:h-sheet-desktop'
                : ''
          }`}
        >
          <div className="flex flex-shrink-0 items-center gap-10 px-sheet-pad pb-14 pt-sheet-pad desktop:px-sheet-pad-desktop desktop:pt-sheet-pad-desktop">
            <Dialog.Title className="min-w-0 flex-1 truncate text-title-sheet font-extrabold tracking-sheet-title text-text">
              {title}
            </Dialog.Title>
            {headerAction}
            <Dialog.Close
              aria-label={closeLabel}
              className="flex h-close-button w-close-button flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2"
            >
              <X width={17} height={17} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {scrollBody ? (
            <ScrollArea className={bodyPadding}>
              <div className="flex min-h-0 flex-col">{children}</div>
            </ScrollArea>
          ) : (
            <div className={`flex min-h-0 flex-1 flex-col ${bodyPadding}`}>
              {children}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
