'use client'

// Une ligne de l'onglet `Sets` de la recherche. L'icône est le symbole de set
// de Scryfall — un SVG monochrome, teinté vers `--color-text-2` par le même
// filtre que le pied de `GridTile` (`.icon-set-tint`, app/globals.css), pour
// qu'il se lise sur la surface sombre.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import type { SetSummary } from '@/app/(app)/search/actions'

// L'icône est l'URI du catalogue (`sets.icon_svg_uri`, tirée de `GET /sets`
// par l'import), jamais une URL construite à la main. Sans URI, ou si elle
// répond en erreur, l'icône se masque plutôt que d'afficher le glyphe
// d'image cassée du navigateur.

export function SetRow({ set }: { set: SetSummary }) {
  const year = set.releasedAt ? set.releasedAt.slice(0, 4) : '—'
  const [iconFailed, setIconFailed] = useState(false)

  return (
    <Link
      href={`/search/sets/${set.code}`}
      className="flex items-center gap-12 rounded-card border border-border bg-surface-1 px-14 py-12"
    >
      <span className="flex h-set-icon-box w-set-icon-box flex-shrink-0 items-center justify-center">
        {set.iconSvgUri && !iconFailed && (
          // eslint-disable-next-line @next/next/no-img-element -- icône de set Scryfall, URL lue dans `sets.icon_svg_uri` (catalogue), jamais construite
          <img
            src={set.iconSvgUri}
            alt=""
            onError={() => setIconFailed(true)}
            className="icon-set-tint h-icon-set-row w-icon-set-row"
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-card-name-search font-bold text-text">{set.name}</span>
        <span className="mt-2 block text-meta text-text-2">
          <span className="font-mono">{set.code.toUpperCase()}</span>
          {` · ${year} · ${set.cardCount} ${set.cardCount === 1 ? 'card' : 'cards'}`}
        </span>
      </span>

      <ChevronRight width={17} height={17} strokeWidth={1.75} className="flex-shrink-0 text-text-3" />
    </Link>
  )
}
