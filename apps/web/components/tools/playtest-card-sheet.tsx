'use client'

// Feuille d'une carte en partie de test : l'image agrandissable, puis les
// déplacements possibles depuis sa zone. Mêmes lignes que `ContextMenu`
// (`components/ui/context-menu.tsx`), précédées de l'image comme la feuille
// de détail d'une carte — aucun gabarit neuf.
import { CardImage } from '@/components/ui/card-image'
import { Sheet } from '@/components/ui/sheet'
import type { PlaytestAction, PlaytestCard, PlaytestZone } from '@/lib/tools/playtest-state'

interface SheetItem {
  key: string
  label: string
  action: PlaytestAction
}

const ROW_CLASS =
  'flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text'

// Destinations proposées depuis `from`, la plus fréquente d'abord. Une carte
// de la bibliothèque (vue par `Look at the top`) peut repartir dessous, pas
// dessus : elle y est déjà.
export function cardActions(
  id: string,
  from: PlaytestZone,
  options: { tapped: boolean; isCommander: boolean },
): SheetItem[] {
  const move = (to: PlaytestZone, position?: 'top' | 'bottom'): PlaytestAction => ({ type: 'move', id, to, position })
  const items: SheetItem[] = []

  if (from === 'battlefield') {
    items.push({ key: 'tap', label: options.tapped ? 'Untap' : 'Tap', action: { type: 'toggleTap', id } })
  } else {
    items.push({
      key: 'battlefield',
      label: from === 'hand' || from === 'command' ? 'Play' : 'Put onto the battlefield',
      action: move('battlefield'),
    })
  }
  if (from !== 'hand') {
    items.push({ key: 'hand', label: from === 'library' ? 'Put into hand' : 'Return to hand', action: move('hand') })
  }
  if (from !== 'graveyard') items.push({ key: 'graveyard', label: 'Put into graveyard', action: move('graveyard') })
  if (from !== 'exile') items.push({ key: 'exile', label: 'Exile', action: move('exile') })
  if (from !== 'library') {
    items.push({ key: 'top', label: 'Put on top of library', action: move('library', 'top') })
  }
  items.push({ key: 'bottom', label: 'Put on bottom of library', action: move('library', 'bottom') })
  if (options.isCommander && from !== 'command') {
    items.push({ key: 'command', label: 'Return to command zone', action: move('command') })
  }
  return items
}

export function PlaytestCardSheet({
  open,
  onOpenChange,
  card,
  items,
  onAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: PlaytestCard | null
  // Vide : la feuille ne montre que l'image (main proposée au mulligan).
  items: SheetItem[]
  onAction: (action: PlaytestAction) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={card?.name ?? ''}>
      {card && (
        <div className="flex flex-col gap-8">
          <div className="mb-10">
            <CardImage src={card.imageUrl ?? card.thumbUrl} alt={card.name} maxWidth={200} />
          </div>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onOpenChange(false)
                onAction(item.action)
              }}
              className={ROW_CLASS}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
