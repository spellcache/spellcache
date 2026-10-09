'use client'

// Feuille de détail de carte (mobile) — une vue LECTURE SEULE : image
// `normal` servie directement par le CDN Scryfall
// (`packages/core/src/images.ts#largeUrl` — jamais le proxy, réservé aux
// vignettes d'une liste de centaines de lignes), nom, coût, type, set/numéro/rareté, prix, puis un
// bloc de lignes label/valeur (Quantity, Finish, Condition, Language,
// Binder, Notes) — ni bouton `Add to deck`/`Binder` désactivé, ni contrôles
// de quantité/condition/foil : toute édition passe par le bouton `Edit` de
// l'en-tête, qui ouvre `EditCardSheet`/`EditListCardSheet` (composants
// distincts).
//
// **Cette feuille reste l'unique implémentation de la carte en modale.**
// Panneau désactivé, un clic sur une ligne rouvre *cette* feuille sur
// desktop comme sur mobile, pas une seconde version.
import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CONDITION_LABEL } from '@/components/cards/card-edit-controls'
import { ManaCost } from '@/components/cards/mana-cost'
import { Sheet } from '@/components/ui/sheet'
import { useCanEdit } from '@/lib/collections/access-context'
import { largeUrl } from '@spellcache/core/images'
import { ZoomableCardImage } from '@/components/cards/zoomable-card-image'
import { useSwipe } from '@/components/ui/use-swipe'

import {
  getCardDetailAction,
  getHoldingDetailAction,
  type CardDetail,
  type HoldingDetail,
} from '@/app/(app)/container/[id]/actions'
import type { HoldingRow } from '@/app/(app)/container/[id]/holdings-data'

// Une ligne label/valeur — absente quand la
// valeur est `null`/vide, jamais un tiret creux affiché pour rien.
function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-12 border-b border-border py-9">
      <span className="flex-shrink-0 text-meta font-semibold text-text-2">{label}</span>
      <span className="min-w-0 text-right text-row-value font-semibold text-text">{value}</span>
    </div>
  )
}

export function CardSheet({
  open,
  onOpenChange,
  holding,
  priceLabel,
  // Nom du binder courant (voir le commentaire de tête de `listHoldings`,
  // `holdings-data.ts`) : le nom du container si ce container EST un binder,
  // ou celui du HOLDING lui-même quand l'écran est la racine (une ligne peut
  // désormais y venir d'un binder), `null` sinon — la ligne `Binder` ne se
  // lit que sur un binder ou le container racine, jamais sur une liste/un
  // deck, où l'appartenance à un binder n'a pas de sens.
  binderName,
  containerKind,
  onEdit,
  onPrevious,
  onNext,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  holding: HoldingRow | null
  priceLabel: string
  binderName: string | null
  containerKind: 'collection' | 'binder' | 'list' | 'deck'
  onEdit: () => void
  // Ligne voisine de la liste affichée (balayage, `←`/`→`) ; absente en
  // début ou en fin de liste.
  onPrevious?: () => void
  onNext?: () => void
}) {
  // Lecture seule (`viewer`) : la feuille reste consultable, sans `Edit`.
  const canEdit = useCanEdit()
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const [holdingDetail, setHoldingDetail] = useState<HoldingDetail | null>(null)
  const swipe = useSwipe({ onPrevious, onNext, keyboard: open })

  useEffect(() => {
    if (!open || !holding) {
      setDetail(null)
      setHoldingDetail(null)
      return
    }
    let cancelled = false
    getCardDetailAction(holding.cardId).then((result) => {
      if (!cancelled) setDetail(result)
    })
    getHoldingDetailAction(holding.holdingId).then((result) => {
      if (!cancelled) setHoldingDetail(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, holding])

  if (!holding) return null

  const image = detail ? largeUrl(detail, 'normal') : null
  const zoomImage = detail ? largeUrl(detail, 'png') : null
  const isFoil = holding.finish !== 'nonfoil'
  // Racine : `binderName` porte le nom du binder RÉEL de
  // cette ligne quand elle en vient une, `null` quand elle est en vrac —
  // `?? 'No binder'` couvre ce second cas.
  const binderRowValue =
    containerKind === 'binder'
      ? (binderName ?? '—')
      : containerKind === 'collection'
        ? (binderName ?? 'No binder')
        : null

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={holding.name}
      // Hauteur fixe : passer d'une carte à l'autre (balayage) ne fait pas
      // sauter la feuille au gré de la longueur du texte de règles. Le corps
      // gère son défilement lui-même (repli d'un petit écran) pour pouvoir
      // poser les lignes label/valeur en bas de la feuille.
      fixedHeight="card"
      scrollBody={false}
      headerAction={
        canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="flex flex-shrink-0 items-center gap-6 rounded-pill bg-accent px-12 py-7 text-meta font-bold text-on-accent"
          >
            <Pencil width={14} height={14} strokeWidth={1.75} />
            Edit
          </button>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-14 overflow-y-auto" {...swipe}>
        <div className="flex items-start gap-16">
          <div className="aspect-card w-detail-image flex-shrink-0 overflow-hidden rounded-detail-image bg-surface-2">
            {image && (
              <ZoomableCardImage
                src={image}
                zoomSrc={zoomImage}
                alt={holding.name}
                onPrevious={onPrevious}
                onNext={onNext}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mt-2 flex items-center gap-7">
              <ManaCost cost={holding.manaCost} size={15} />
              {detail && <span className="text-meta text-text-2">{detail.typeLine}</span>}
            </div>
            <div className="mt-6 flex items-center gap-6 font-mono text-meta-search text-text-2">
              <span className="font-bold text-text-2">{holding.setCode.toUpperCase()}</span>
              <span className="text-text-3">#{holding.collectorNumber}</span>
              <span className="text-tab-label font-bold uppercase tracking-section-label text-text-3">
                {holding.rarity}
              </span>
            </div>
            <div className="mt-12 font-mono text-price-detail font-extrabold text-accent-text">
              {priceLabel}
            </div>
          </div>
        </div>

        {/* Coupé à cinq lignes : le texte complet se lit sur l'image agrandie. */}
        {detail?.oracleText && (
          <div className="line-clamp-5 rounded-control bg-surface-2 px-14 py-12 text-body leading-relaxed text-text">
            {detail.oracleText}
          </div>
        )}

        <div className="mt-auto">
          <Row label="Quantity" value={`×${holding.qty}`} />
          <Row label="Finish" value={isFoil ? 'Foil' : 'Non-foil'} />
          <Row label="Condition" value={CONDITION_LABEL[holding.condition] ?? holding.condition} />
          <Row label="Language" value={holdingDetail?.language.toUpperCase() ?? null} />
          <Row label="Binder" value={binderRowValue} />
          <Row label="Notes" value={holdingDetail?.notes ?? null} />
        </div>
      </div>
    </Sheet>
  )
}
