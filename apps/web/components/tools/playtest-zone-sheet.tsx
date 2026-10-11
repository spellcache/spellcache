'use client'

// Feuille d'une zone hors du champ de bataille. Cimetière, exil et zone de
// commandement montrent leurs cartes ; la bibliothèque reste cachée, sauf
// les cartes du dessus que l'on choisit de regarder (`Look at the top`).
import { Chip } from '@/components/ui/chip'
import { Sheet } from '@/components/ui/sheet'
import { PlaytestCard } from '@/components/tools/playtest-card'
import type { PlaytestCard as PlaytestCardData, PlaytestZone } from '@/lib/tools/playtest-state'

export const ZONE_LABELS: Record<PlaytestZone, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command zone',
}

const LOOK_COUNTS = [1, 3, 5] as const

const ROW_CLASS =
  'flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text disabled:opacity-60'

export function PlaytestZoneSheet({
  zone,
  onOpenChange,
  ids,
  cardOf,
  onCard,
  looked,
  onLook,
  onDraw,
  onShuffle,
}: {
  zone: PlaytestZone | null
  onOpenChange: (open: boolean) => void
  ids: string[]
  cardOf: (id: string) => PlaytestCardData
  onCard: (id: string) => void
  // Cartes du dessus regardées, tenues par l'écran pour survivre à la
  // fermeture de la feuille le temps d'agir sur l'une d'elles.
  looked: string[]
  onLook: (count: number) => void
  // `null` tant que la main n'est pas gardée : on ne pioche pas pendant le
  // mulligan.
  onDraw: (() => void) | null
  onShuffle: () => void
}) {
  // Une carte regardée reste visible tant qu'elle est encore parmi les
  // cartes du dessus : mise dessous, elle disparaît sans qu'une carte neuve
  // ne prenne sa place.
  const visible =
    zone === 'library'
      ? looked.filter((id) => {
          const position = ids.indexOf(id)
          return position > -1 && position < looked.length
        })
      : ids

  function close() {
    onOpenChange(false)
  }

  return (
    <Sheet
      open={zone !== null}
      onOpenChange={onOpenChange}
      title={zone ? `${ZONE_LABELS[zone]} · ${ids.length}` : ''}
    >
      {zone === 'library' && (
        <div className="mb-14 flex flex-col gap-8">
          <button
            type="button"
            disabled={ids.length === 0 || !onDraw}
            onClick={() => {
              close()
              onDraw?.()
            }}
            className={ROW_CLASS}
          >
            Draw a card
          </button>
          <button
            type="button"
            onClick={() => {
              close()
              onShuffle()
            }}
            className={ROW_CLASS}
          >
            Shuffle
          </button>
          <div className="mt-6 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Look at the top
          </div>
          <div className="flex gap-8">
            {LOOK_COUNTS.map((count) => (
              <Chip
                key={count}
                label={String(count)}
                selected={looked.length === count}
                onClick={() => onLook(looked.length === count ? 0 : count)}
              />
            ))}
          </div>
        </div>
      )}
      {visible.length > 0 ? (
        <div className="flex flex-wrap gap-8">
          {visible.map((id) => (
            <PlaytestCard
              key={id}
              card={cardOf(id)}
              size="hand"
              onClick={() => {
                close()
                onCard(id)
              }}
            />
          ))}
        </div>
      ) : (
        zone !== 'library' && <p className="px-4 text-body text-text-2">No cards.</p>
      )}
    </Sheet>
  )
}
