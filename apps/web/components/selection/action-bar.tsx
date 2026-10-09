'use client'

// Barre d'action basse de la sélection (fond/bordure identiques à `TabBar` —
// `bg-surface-3 border-t border-surface-2` — seul le padding diffère,
// `px-12 py-10` contre `px-4
// py-10`). Rendue par l'écran de container lui-même (`ContainerView`), en
// position fixe au même emplacement que `TabBar` : `app/(app)/layout.tsx`
// retire `TabBar` du DOM tant que la sélection est active, cette barre en
// occupe alors exactement la place.
import { BookCopy, Pencil, Trash2 } from 'lucide-react'

import { DecksIcon } from '@/components/ui/tab-bar'

const STROKE_WIDTH = 1.75

export function ActionBar({
  onEdit,
  onMove,
  onAddToDeck,
  onDelete,
}: {
  onEdit: () => void
  onMove: () => void
  onAddToDeck: () => void
  onDelete: () => void
}) {
  // Ordre et libellés du design validé : `Binder · To deck · Edit · Delete`
  // (le bouton `Export` de la même rangée n'est pas porté ici). Le design
  // prime sur toute description en prose (« actions Edit, Move, Add to
  // deck ») pour l'ordre et les libellés, jamais l'inverse.
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex gap-8 border-t border-surface-2 bg-surface-3 px-12 pt-10 pb-tab-bar-bottom">
      <button
        type="button"
        onClick={onMove}
        className="flex flex-1 flex-col items-center gap-5 py-8 text-action-bar-label font-semibold text-text"
      >
        <BookCopy width={19} height={19} strokeWidth={STROKE_WIDTH} />
        Binder
      </button>
      <button
        type="button"
        onClick={onAddToDeck}
        className="flex flex-1 flex-col items-center gap-5 py-8 text-action-bar-label font-semibold text-text"
      >
        <DecksIcon size={19} />
        To deck
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 flex-col items-center gap-5 py-8 text-action-bar-label font-semibold text-text"
      >
        <Pencil width={19} height={19} strokeWidth={STROKE_WIDTH} />
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex flex-1 flex-col items-center gap-5 py-8 text-action-bar-label font-semibold text-danger"
      >
        <Trash2 width={19} height={19} strokeWidth={STROKE_WIDTH} />
        Delete
      </button>
    </nav>
  )
}
