'use client'

// Toutes les impressions d'une carte, l'impression courante marquée
// `Current` — ouverte depuis la zone d'édition de la feuille d'ajout
// (`AddCardSheet`) et depuis les feuilles d'édition d'une ligne possédée
// (`EditCardSheet`/`EditListCardSheet`). Une seule liste pour ces écrans :
// mêmes lignes (`SearchRow`) que l'étape « Choose a printing » de l'ajout.
// Choisir ferme la feuille ; c'est l'appelant qui décide quoi en faire
// (simple affichage avant ajout, ou écriture sur la ligne possédée).
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { printingsAction } from '@/app/(app)/search/actions'
import { SearchRow } from '@/components/search/search-row'
import { Sheet } from '@/components/ui/sheet'
import type { Currency } from '@/lib/format/money'
import type { CardSearchItem, PrintingItem } from '@/lib/search/search-cards'
import { thumbUrl } from '@spellcache/core/images'

import { SetIcon } from './set-icon'

// Ce qu'une impression partage avec toutes les autres du même nom — porté
// par l'appelant, `printingsAction` ne renvoie que ce qui varie d'une
// impression à l'autre.
export interface PrintingCard {
  name: string
  manaCost: string | null
  typeLine?: string
  colorIdentity?: string[]
}

export function toCardSearchItem(printing: PrintingItem, card: PrintingCard): CardSearchItem {
  return {
    id: printing.id,
    name: card.name,
    setCode: printing.setCode,
    setName: printing.setName,
    setIconUri: printing.setIconUri,
    collectorNumber: printing.collectorNumber,
    rarity: printing.rarity,
    manaCost: card.manaCost,
    typeLine: card.typeLine ?? '',
    thumbUrl: thumbUrl(printing.id, 'small'),
    imageUrl: printing.imageUrl,
    price: printing.price,
    colorIdentity: card.colorIdentity ?? [],
  }
}

// Zone « édition courante » qui ouvre la feuille ci-dessous — même gabarit
// que la ligne `Binder` de `EditCardSheet`.
export function EditionButton({
  setName,
  setCode,
  setIconUri,
  collectorNumber,
  onClick,
}: {
  setName: string | null
  setCode: string
  setIconUri: string | null
  collectorNumber: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Change edition"
      className="flex w-full items-center gap-10 rounded-control border border-border bg-surface-2 px-14 py-12 text-left"
    >
      <span className="flex-shrink-0 text-body font-semibold text-text-2">Edition</span>
      {/* Nom et numéro alignés sur leur ligne de base (polices différentes),
          l'icône centrée sur eux. */}
      <span className="flex min-w-0 flex-1 items-center justify-end gap-6 text-body font-semibold text-text">
        <SetIcon uri={setIconUri} />
        <span className="flex min-w-0 items-baseline gap-6 leading-none">
          <span className="min-w-0 truncate">{setName ?? setCode.toUpperCase()}</span>
          <span className="flex-shrink-0 font-mono text-meta text-text-3">#{collectorNumber}</span>
        </span>
      </span>
      <ChevronRight width={16} height={16} strokeWidth={1.75} className="flex-shrink-0 text-text-3" />
    </button>
  )
}

export function PrintingPickerSheet({
  open,
  onClose,
  card,
  currentCardId,
  onPick,
}: {
  open: boolean
  onClose: () => void
  card: PrintingCard
  currentCardId: string
  onPick: (printing: CardSearchItem, currency: Currency) => void
}) {
  const [printings, setPrintings] = useState<CardSearchItem[] | null>(null)
  const [currency, setCurrency] = useState<Currency>('eur')
  const [failed, setFailed] = useState(false)

  // Rechargée à chaque ouverture : la liste est courte et les prix bougent
  // d'un import à l'autre.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPrintings(null)
    setFailed(false)
    printingsAction({ name: card.name })
      .then((result) => {
        if (cancelled) return
        setCurrency(result.currency)
        setPrintings(result.items.map((printing) => toCardSearchItem(printing, card)))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
    // `card` est reconstruit à chaque rendu par les appelants : seul le nom
    // change la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card.name])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title="Editions">
      <div className="flex flex-col gap-8">
        {printings === null && !failed && (
          <p role="status" className="px-2 text-meta text-text-2">
            Loading editions...
          </p>
        )}
        {failed && <p className="px-2 text-meta text-danger">Could not load editions.</p>}
        {printings?.map((printing) => (
          <SearchRow
            key={printing.id}
            item={printing}
            currency={currency}
            current={printing.id === currentCardId}
            showSetName
            onClick={() => {
              if (printing.id !== currentCardId) onPick(printing, currency)
              onClose()
            }}
          />
        ))}
      </div>
    </Sheet>
  )
}
