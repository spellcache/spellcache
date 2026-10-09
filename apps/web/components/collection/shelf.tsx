'use client'

// Étagère : un éventail de cartes superposées, un seul bouton pour
// toute la pile — pas une piste défilante de tuiles individuellement
// cliquables. Choix délibéré contre une première version qui défilait
// horizontalement et ouvrait la feuille de carte au tap : pile figée, un seul
// geste, le design validé l'emporte. `tests/e2e/shelves.spec.ts` et
// `tests/integration/collection-shelves.test.ts` couvrent ce comportement.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import type { ShelfTile } from '@/app/(app)/collection/collection-data'

export function Shelf({
  name,
  tag,
  meta,
  price,
  tiles,
  href,
  lazyTiles = false,
}: {
  name: string
  // Tag encadré à côté du titre —
  // « LIST » pour un container `kind = 'list'`, absent sinon. `meta` porte
  // déjà le suffixe « · not owned » d'une liste (`collection-data.ts`) :
  // cette étiquette-ci ne fait que nommer le type de container au premier
  // coup d'œil, elle ne répète jamais ce que `meta` dit déjà.
  tag?: string
  meta: string
  price: string
  tiles: ShelfTile[]
  href: string
  // Étagère au-delà de la première rangée visible de l'écran — posé par
  // l'appelant, qui seul connaît le rang de cette étagère parmi les autres.
  lazyTiles?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="mb-9 ml-2 flex items-baseline gap-8">
        <span className="flex-shrink-0 text-shelf-name font-bold tracking-shelf-name text-text">
          {name}
        </span>
        {tag && (
          <span className="flex-shrink-0 rounded-tag border-thin border-border px-6 py-2 text-tag-list font-bold uppercase tracking-section-label text-text-3">
            {tag}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-shelf-meta text-text-2">{meta}</span>
        <span className="flex-shrink-0 font-mono text-shelf-price font-bold text-accent-text">
          {price}
        </span>
      </div>

      {/* Toute la pile est UN SEUL lien qui ouvre le container — aucune
          tuile individuellement cliquable, aucune `CardPreviewSheet` depuis
          cette pile : le tap sur le nom (`shelves-view.tsx`) et le tap sur la
          pile mènent au même endroit. */}
      <Link
        href={href}
        aria-label={`${name} — ${meta}`}
        className="flex w-full items-end pl-2"
      >
        {tiles.length === 0 ? (
          <span className="flex-1 py-18 text-left text-meta text-text-3">
            Nothing here yet.
          </span>
        ) : (
          tiles.map((tile, index) => (
            <span
              key={tile.cardId}
              className={`aspect-card w-shelf-tile flex-shrink-0 overflow-hidden rounded-tile-art bg-surface-2 shadow-shelf-overlap ${
                index === 0 ? '' : '-ml-26'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
              <img
                src={tile.artUrl}
                alt=""
                loading={lazyTiles ? 'lazy' : 'eager'}
                className="h-full w-full object-contain"
              />
            </span>
          ))
        )}

        <span
          aria-hidden="true"
          className="ml-14 flex h-shelf-chevron w-shelf-chevron flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-text-2"
        >
          <ChevronRight width={18} height={18} strokeWidth={1.75} />
        </span>
      </Link>
    </div>
  )
}
