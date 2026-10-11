'use client'

// Feuille de carte en lecture seule ouverte au tap d'une tuile d'étagère.
// `ShelfTile` ne porte que `cardId`/`name`/`artUrl`/`priceMinor` — ni
// `holdingId`, ni `qty`/`condition`/`finish`, donc pas la feuille éditable
// (`components/cards/card-sheet.tsx`, qui prend un `HoldingRow` complet et
// des mutateurs scopés à un container). Distincte de `CardSheet`, mêmes
// tokens de mise en page (`w-detail-image`, `rounded-detail-image`,
// `text-price-detail`) et même source d'image CDN directe
// (`packages/core/src/images.ts#largeUrl` — jamais le proxy pour la grande
// image d'une feuille), mais sans les contrôles
// d'édition qu'aucune donnée de `ShelfTile` ne peut alimenter ici.
//
// `quantity` optionnel : la liste d'un deck y place son compteur
// d'exemplaires, retiré de ses lignes (`DeckCardRow`) où il se déclenchait au
// défilement. Les étagères ne le passent jamais.
import { useEffect, useState } from 'react'

import { QtyStepper } from '@/components/cards/qty-stepper'
import { Sheet } from '@/components/ui/sheet'
import { largeUrl } from '@spellcache/core/images'
import { ZoomableCardImage } from '@/components/cards/zoomable-card-image'
import { useSwipe } from '@/components/ui/use-swipe'
import { formatMoney, type Currency } from '@/lib/format/money'

import { getCardDetailAction, type CardDetail } from '@/app/(app)/container/[id]/actions'
import type { ShelfTile } from '@/app/(app)/collection/collection-data'

export function CardPreviewSheet({
  open,
  onOpenChange,
  tile,
  currency,
  onPrevious,
  onNext,
  quantity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Mémorisé par l'appelant : un nouvel objet à chaque rendu relancerait le
  // chargement du détail en boucle.
  tile: ShelfTile | null
  currency: Currency
  // Carte voisine de la liste d'où vient la feuille (balayage, `←`/`→`).
  onPrevious?: () => void
  onNext?: () => void
  // `min` : 1 pour un deck, retirer la carte reste la corbeille de la ligne.
  quantity?: {
    holdingId: string
    qty: number
    min: number
    disabled?: boolean
    onChange: (next: number) => void
  }
}) {
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const swipe = useSwipe({ onPrevious, onNext, keyboard: open })

  useEffect(() => {
    if (!open || !tile) {
      setDetail(null)
      return
    }
    let cancelled = false
    getCardDetailAction(tile.cardId).then((result) => {
      if (!cancelled) setDetail(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, tile])

  if (!tile) return null

  const image = detail ? largeUrl(detail, 'normal') : null
  const zoomImage = detail ? largeUrl(detail, 'png') : null

  return (
    // Hauteur fixe, comme `CardSheet` : le balayage ne fait pas sauter la
    // feuille d'une carte à l'autre.
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={tile.name}
      fixedHeight="card"
      scrollBody={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-14 overflow-y-auto" {...swipe}>
        <div className="flex items-start gap-16">
          <div className="aspect-card w-detail-image flex-shrink-0 overflow-hidden rounded-detail-image bg-surface-2">
            {image && (
              <ZoomableCardImage
                src={image}
                zoomSrc={zoomImage}
                alt={tile.name}
                onPrevious={onPrevious}
                onNext={onNext}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {detail && <div className="mt-2 text-meta text-text-2">{detail.typeLine}</div>}
            {tile.priceMinor !== null && (
              <div className="mt-12 font-mono text-price-detail font-extrabold text-accent-text">
                {formatMoney(tile.priceMinor, currency)}
              </div>
            )}
            {quantity && (
              <div className="mt-12 inline-flex items-center rounded-control border border-border bg-surface-2 px-9 py-5">
                <QtyStepper
                  holdingId={quantity.holdingId}
                  qty={quantity.qty}
                  min={quantity.min}
                  disabled={quantity.disabled}
                  onChange={quantity.onChange}
                />
              </div>
            )}
          </div>
        </div>

        {/* Coupé à cinq lignes, comme `CardSheet`. */}
        {detail?.oracleText && (
          <div className="line-clamp-5 rounded-control bg-surface-2 px-14 py-12 text-body leading-relaxed text-text">
            {detail.oracleText}
          </div>
        )}
      </div>
    </Sheet>
  )
}
