// Coquille d'un écran : un en-tête qui reste en place au-dessus d'un corps
// qui défile seul. C'est la forme unique de tous les écrans — rien au-dessus
// du corps ne bouge, et la barre de défilement appartient donc au contenu
// auquel elle se rapporte, entre l'en-tête et la barre d'onglets, plutôt
// qu'à la fenêtre.
//
// Le document, lui, ne défile jamais (`html, body { overflow: hidden }`,
// app/globals.css) : ce corps-ci est le seul défilement de l'écran.
//
// Les gouttières par défaut sont portées ici une fois pour toutes plutôt que
// répétées par chaque page : haut `--spacing-screen-top` (commun à tous les
// écrans, illustrés compris), retrait latéral `--gutter` — l'en-tête et le corps partagent le même retrait latéral, sinon les
// contrôles du titre ne s'alignent pas sur les lignes en dessous. Les deux
// écrans à étagères les remplacent : leurs pistes débordent jusqu'aux bords de
// la colonne et paient elles-mêmes leur retrait.
import { ScrollArea } from '@/components/ui/scroll-area'

export function Screen({
  header,
  children,
  // Gouttière fluide (`--gutter: clamp(16px,3.5vw,34px)`),
  // annulée sur desktop où la coquille bornée paie déjà ses retraits ; le
  // corps réserve en plus la voie de la scrollbar en surimpression à droite
  // (`--scrollbar-lane`), pour que le curseur ne morde jamais le contenu.
  headerClassName = 'px-gutter pt-screen-top desktop:px-0 desktop:pt-34',
  bodyClassName = 'pl-gutter pr-gutter-lane desktop:pl-0 desktop:pr-scrollbar-lane',
}: {
  header?: React.ReactNode
  children: React.ReactNode
  headerClassName?: string
  bodyClassName?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header !== undefined && <div className={`flex-shrink-0 ${headerClassName}`}>{header}</div>}
      <ScrollArea
        className={`pb-28 desktop:pb-40 ${header === undefined ? 'pt-screen-top desktop:pt-34' : ''} ${bodyClassName}`}
      >
        {children}
      </ScrollArea>
    </div>
  )
}
