// Tuile de la liste d'apps de l'onglet Tools.
//
// Hauteur **automatique**, sans `h-app-tile` fixe : le design borne les
// quatre tuiles à 132px, mais une description plus longue que les autres s'y
// tronquerait sans ellipse — la boîte suit donc son contenu.
//
// Composant serveur : les tuiles inertes n'ont aucun état, et la seule
// tuile active navigue par `<Link>`.
import Link from 'next/link'

// Deux états seulement, pas d'état `soon` : il n'existe pas de statut
// intermédiaire « bientôt » distinct d'« éteint ». Le badge `PLANNED` d'un
// outil qui n'a pas encore d'écran (`Trading mode`, `Card scanner`, `AI
// assistant`) est un `tagLabel` surchargé sur l'état `off`, jamais un
// troisième état ambré — il n'y a délibérément pas de variante « next one
// up ».
export type AppTileState = 'on' | 'off'

// Étiquettes par défaut de la tuile — la page peut les surcharger,
// exactement comme le design le fait avec
// `taglabel="PLANNED"` sur les tuiles `off` qui n'ont pas encore d'écran.
const DEFAULT_TAG: Record<AppTileState, string> = {
  on: 'ENABLED',
  off: 'OFF',
}

// Gris partout hors `on`, jamais d'ambre pour une tuile `PLANNED` : l'ambre
// signale ailleurs un problème à corriger, le dépenser sur « plus tard »
// l'émousserait.
const TAG_COLOR: Record<AppTileState, string> = {
  on: 'text-accent-text',
  off: 'text-text-3',
}

const ICON_BOX: Record<AppTileState, string> = {
  on: 'bg-accent text-on-accent',
  off: 'bg-surface-2 text-text-2',
}

export function AppTile({
  name,
  description,
  icon,
  state,
  tagLabel,
  href,
}: {
  name: string
  description: string
  icon: React.ReactNode
  state: AppTileState
  tagLabel?: string
  // Absent : la tuile est rendue mais inerte (`Trading mode`, `Card
  // scanner`, `AI assistant` n'ont aucun écran — docs/development.md).
  href?: string
}) {
  const className = [
    'flex w-full flex-col gap-12 overflow-hidden rounded-app-tile border p-16 text-left',
    state === 'on' ? 'border-border-app-tile' : 'border-border',
    'bg-surface-1',
    state === 'on' ? '' : 'opacity-72',
  ].join(' ')

  const body = (
    <>
      <span className="flex w-full items-center gap-10">
        <span
          className={`flex h-app-tile-icon w-app-tile-icon flex-shrink-0 items-center justify-center rounded-app-tile-icon ${ICON_BOX[state]}`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-app-tile-name font-bold tracking-shelf-name text-text">
            {name}
          </span>
          <span
            className={`mt-3 block text-app-tile-tag font-bold tracking-badge-foil ${TAG_COLOR[state]}`}
          >
            {tagLabel ?? DEFAULT_TAG[state]}
          </span>
        </span>
      </span>
      <span className="block text-app-tile-desc leading-app-tile-desc text-text-2">
        {description}
      </span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }

  return (
    <button type="button" disabled className={className}>
      {body}
    </button>
  )
}
