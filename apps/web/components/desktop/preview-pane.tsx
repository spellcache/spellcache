'use client'

// Panneau d'aperçu desktop 426px : image `normal` de 150px en ratio 5/7
// servie par le CDN Scryfall, nom,
// coût, type, set/numéro/rareté, prix 26px en mono, contrôles quantité /
// condition / foil, texte d'oracle, bloc `In your collection`, bloc `Other
// printings` avec trois vignettes 46×64, puis `Add to deck` / `Binder` /
// supprimer.
//
// Il **remplace** la modale, il ne la double pas : les contrôles éditables
// sont exactement ceux de la feuille de carte (`CardEditControls`, extrait
// précisément pour ça), et les mutations restent celles de l'écran de
// container — ce panneau ne touche ni au cache TanStack Query ni à une
// Server Action d'écriture, il remonte les mêmes rappels que `CardSheet`.
import { BookCopy, Trash2 } from 'lucide-react'

import { CardEditControls } from '@/components/cards/card-edit-controls'
import { ZoomableCardImage } from '@/components/cards/zoomable-card-image'
import { ManaCost } from '@/components/cards/mana-cost'
import { DecksIcon } from '@/components/ui/tab-bar'
import type { Condition } from '@spellcache/db/schema'
import { useCanEdit } from '@/lib/collections/access-context'
import { formatCount } from '@/lib/format/money'

import type { CardPreview } from './preview-pane-data'

import type { HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

function copiesLabel(qty: number): string {
  return `${formatCount(qty)} ${qty === 1 ? 'copy' : 'copies'}`
}

export function PreviewPane({
  preview,
  // La ligne réellement sélectionnée dans la liste : c'est elle qui porte
  // la finition, l'état et la quantité affichés/édités (une même carte peut
  // exister deux fois dans un container, en foil et en normal). `preview`
  // n'apporte que ce que la ligne ne sait pas — catalogue, collection,
  // autres impressions.
  holding,
  priceLabel,
  onQtyChange,
  onConditionChange,
  onFoilChange,
  onAddToDeck,
  onMoveToBinder,
  onDelete,
}: {
  preview: CardPreview | null
  holding: HoldingRow | null
  priceLabel: string
  onQtyChange: (next: number) => void
  onConditionChange: (condition: Condition) => void
  onFoilChange: (isFoil: boolean) => void
  // `Add to deck` / `Binder` (quantité, condition, foil, binder et deck sont
  // éditables sur place) — remontés à l'écran de container, qui les fait
  // entrer dans la **même** `BulkEditSheet` que les boutons `To deck`/`Binder`
  // de la barre d'action de sélection, sur la seule
  // ligne courante du panneau. Aucun second flux de destination n'est
  // ouvert ici.
  onAddToDeck: () => void
  onMoveToBinder: () => void
  onDelete: () => void
}) {
  // Lecture seule (`viewer`) : ni contrôles d'édition, ni actions de ligne.
  const canEdit = useCanEdit()
  return (
    <aside
      data-testid="preview-pane"
      data-preview-pane
      aria-label="Card preview"
      className="hidden w-preview-pane flex-shrink-0 flex-col overflow-y-auto rounded-preview-pane border border-border bg-surface-1 p-18 pane:flex"
    >
      {/* Aucune ligne sélectionnée, ou ligne supprimée entre-temps : état
          vide explicite plutôt qu'un cadre nu. C'est `container-view.tsx`
          qui remet `selectedHoldingId` à `null`. */}
      {(!preview || !holding) && (
        <div className="flex min-h-preview-empty flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="text-body font-semibold text-text-2">Pick a card to see it here.</div>
          <div className="text-meta text-text-3">↑ and ↓ walk the list.</div>
        </div>
      )}
      {preview && holding && (
        <>
          <div className="flex items-start gap-16">
            <div className="aspect-card w-detail-image flex-shrink-0 overflow-hidden rounded-detail-image bg-surface-2">
              {preview.imageUrl && (
                <ZoomableCardImage
                  src={preview.imageUrl}
                  zoomSrc={preview.zoomImageUrl}
                  alt={preview.name}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-preview-name font-extrabold tracking-preview-name text-text">
                {preview.name}
              </h2>
              <div className="mt-7 flex items-center gap-7">
                <ManaCost cost={preview.manaCost} size={15} />
                <span className="truncate text-meta text-text-2">{preview.typeLine}</span>
              </div>
              <div className="mt-6 flex items-center gap-6 text-meta-search text-text-2">
                {preview.setIconUri && (
                  // eslint-disable-next-line @next/next/no-img-element -- icône de set Scryfall, URL lue dans `sets.icon_svg_uri` (catalogue), jamais construite
                  <img
                    src={preview.setIconUri}
                    alt=""
                    className="icon-set-tint h-icon-set-tile w-icon-set-tile flex-shrink-0"
                  />
                )}
                <span className="font-mono font-bold text-text-2">
                  {preview.setCode.toUpperCase()}
                </span>
                <span className="font-mono text-text-3">#{preview.collectorNumber}</span>
                <span className="text-preview-rarity font-bold uppercase tracking-preview-rarity text-text-3">
                  {preview.rarity}
                </span>
              </div>
              <div className="mt-12 font-mono text-price-pane font-extrabold text-accent-text">
                {priceLabel}
              </div>
            </div>
          </div>

          {canEdit && (
          <div className="mt-16">
            <CardEditControls
              holdingId={holding.holdingId}
              qty={holding.qty}
              condition={holding.condition}
              finish={holding.finish}
              onQtyChange={onQtyChange}
              onConditionChange={onConditionChange}
              onFoilChange={onFoilChange}
            />
          </div>
          )}

          {preview.oracleText && (
            <div className="mt-14 rounded-preview-block bg-surface-2 px-14 py-12 text-body leading-preview-oracle text-text">
              {preview.oracleText}
            </div>
          )}

          {/* Nom de l'artiste conservé (docs/development.md : « ne PAS recadrer le
              copyright ni le nom de l'artiste ») — l'image du panneau est
              rognée par `object-contain` sur un cadre 5/7, la mention
              accompagne donc la carte en clair. */}
          {preview.artist && (
            <div className="mt-7 text-meta-mono text-text-3">{preview.artist}</div>
          )}

          <div className="mt-14 flex gap-10">
            <div className="min-w-0 flex-1 rounded-preview-block bg-surface-2 p-12">
              <div className="text-preview-block-label font-semibold uppercase tracking-section-label text-text-2">
                In your collection
              </div>
              <div className="mt-7 text-body font-bold leading-preview-block text-text">
                {preview.inCollection.length === 0 ? (
                  <span className="font-semibold text-text-2">Not in your collection</span>
                ) : (
                  preview.inCollection.map((entry) => (
                    <div key={entry.containerId} className="truncate">
                      {copiesLabel(entry.qty)} · {entry.containerName}
                    </div>
                  ))
                )}
                <div className="mt-4 font-semibold text-text-2">
                  {preview.builtDeckCount > 0
                    ? `Used in ${formatCount(preview.builtDeckCount)} built ${preview.builtDeckCount === 1 ? 'deck' : 'decks'}`
                    : 'Not in any built deck'}
                </div>
              </div>
            </div>

            <div className="min-w-0 flex-1 rounded-preview-block bg-surface-2 p-12">
              <div className="text-preview-block-label font-semibold uppercase tracking-section-label text-text-2">
                Other printings
              </div>
              {/* Six vignettes 52×73 rayon 6, non interactives : aucune
                  navigation vers une autre impression n'existe. */}
              <div className="mt-9 flex flex-wrap gap-6">
                {preview.otherPrintings.map((printing) => (
                  // eslint-disable-next-line @next/next/no-img-element -- vignette servie par le proxy interne
                  <img
                    key={printing.cardId}
                    src={printing.thumbUrl}
                    alt={`${preview.name} · ${printing.setCode.toUpperCase()}`}
                    title={printing.setCode.toUpperCase()}
                    loading="lazy"
                    className="h-printing-tile w-printing-tile rounded-printing-tile bg-surface-3 object-contain"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Trois boutons égaux : contour hairline, fond surface, 12.5/700,
              icône 15 — la suppression est libellée « Remove », pas réduite
              à un carré. */}
          {canEdit && (
          <div className="mt-14 flex gap-8">
            <button
              type="button"
              onClick={onAddToDeck}
              className="flex flex-1 items-center justify-center gap-7 rounded-preview-block border border-border bg-surface-2 py-11 text-preview-action font-bold text-text"
            >
              <DecksIcon size={15} />
              Add to deck
            </button>
            <button
              type="button"
              onClick={onMoveToBinder}
              className="flex flex-1 items-center justify-center gap-7 rounded-preview-block border border-border bg-surface-2 py-11 text-preview-action font-bold text-text"
            >
              <BookCopy width={15} height={15} strokeWidth={1.75} />
              Move to binder
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex flex-1 items-center justify-center gap-7 rounded-preview-block border border-border bg-surface-2 py-11 text-preview-action font-bold text-danger"
            >
              <Trash2 width={15} height={15} strokeWidth={1.75} />
              Remove
            </button>
          </div>
          )}
        </>
      )}
    </aside>
  )
}
