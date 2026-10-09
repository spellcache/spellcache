'use client'

// Feuille `Sort & group` : liste `Sort by` (ligne active fond `#161d2e`),
// puis bloc `Group by`.
//
// Brouillon local appliqué à `Apply` — contrairement à `FiltersSheet` qui
// débounce un recompte réseau, cette feuille n'a aucun coût réseau à
// absorber : le brouillon existe pour que composer un tri (clé, puis sens,
// puis groupement) ne rejoue pas l'URL à chaque tap intermédiaire. Remontée
// par `key` à chaque ouverture (`command-bar.tsx`), comme
// `AddCardSheet`/`FiltersSheet` — sans quoi rouvrir la feuille montrerait un
// brouillon abandonné plutôt que ce sur quoi la liste est réellement triée.
//
// Taper le LIBELLÉ d'une ligne pose la clé SANS jamais basculer le sens —
// le segmenté directionnel est la seule commande qui change `dir`, une ligne
// qui devient active pour la première fois garde le sens déjà porté par le
// brouillon.
import {
  AArrowDown,
  ArrowDown,
  ArrowUp,
  BadgeDollarSign,
  Clock,
  Droplet,
  Gem,
  Hash,
  Package,
} from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import { Chip } from '@/components/ui/chip'
import { ResponsiveSheet } from '@/components/ui/responsive-sheet'
import type { GroupKey, SortDir, SortKey } from '@/lib/view-state/parse'

// Libellés directionnels PAR CLÉ — jamais un générique `High`/`Low` commun
// aux sept lignes : chaque critère épelle son propre sens (`Z–A` pour un
// nom, `Newest` pour une date...).
// `short` est ce que le bouton de la barre de commande affiche (forme
// courte, sans direction — le sens se lit dans la feuille, pas sur le
// bouton).
const SORT_ROWS: Array<{
  key: SortKey
  label: string
  short: string
  Icon: typeof BadgeDollarSign
  high: string
  low: string
}> = [
  { key: 'price', label: 'Value', short: 'Value', Icon: BadgeDollarSign, high: 'High', low: 'Low' },
  { key: 'name', label: 'Name', short: 'Name', Icon: AArrowDown, high: 'Z–A', low: 'A–Z' },
  { key: 'qty', label: 'Quantity', short: 'Qty', Icon: Hash, high: 'Most', low: 'Fewest' },
  {
    key: 'set',
    label: 'Set & collector number',
    short: 'Set',
    Icon: Package,
    high: 'Last',
    low: 'First',
  },
  { key: 'rarity', label: 'Rarity', short: 'Rarity', Icon: Gem, high: 'Mythic', low: 'Common' },
  { key: 'cmc', label: 'Mana value', short: 'Mana', Icon: Droplet, high: 'High', low: 'Low' },
  { key: 'added', label: 'Date added', short: 'Added', Icon: Clock, high: 'Newest', low: 'Oldest' },
]

// Libellé COURT du déclencheur `arrow-down-wide-narrow` de la barre de
// commande — réutilisé par `command-bar.tsx`
// pour ne jamais dupliquer cette table.
export const SORT_KEY_LABEL: Record<SortKey, string> = Object.fromEntries(
  SORT_ROWS.map((row) => [row.key, row.short]),
) as Record<SortKey, string>

// Cinq puces `Group by` — `binder` n'y figure pas : le design validé
// n'en compte que cinq, `GroupKey` porte `binder` pour le contrat
// d'URL mais aucune puce ne le sélectionne jamais depuis cette feuille.
const GROUP_CHIPS: Array<{ value: GroupKey; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'set', label: 'Set' },
  { value: 'colour', label: 'Colour' },
  { value: 'type', label: 'Type' },
  { value: 'rarity', label: 'Rarity' },
]

interface SortDraft {
  sort: { key: SortKey; dir: SortDir }
  groupBy: GroupKey | null
}

export function SortSheet({
  open,
  onOpenChange,
  trigger,
  sort,
  groupBy,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement<{ onClick?: () => void }>
  sort: { key: SortKey; dir: SortDir }
  groupBy: GroupKey | null
  onChange: (next: { sort: { key: SortKey; dir: SortDir }; groupBy: GroupKey | null }) => void
}) {
  const [draft, setDraft] = useState<SortDraft>({ sort, groupBy })

  // Le brouillon repart de l'état appliqué à chaque ouverture — même
  // technique que `FiltersSheet` (effet sur `open`, pas un remontage complet
  // du composant : `ResponsiveSheet` garde son animation de fermeture
  // intacte).
  useEffect(() => {
    if (!open) return
    setDraft({ sort, groupBy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function selectSortKey(key: SortKey) {
    // Pose la clé, jamais le sens : une ligne qui devient active garde le
    // `dir` déjà porté par le brouillon, y compris quand elle l'était déjà.
    setDraft((current) => ({ ...current, sort: { key, dir: current.sort.dir } }))
  }

  function selectDir(dir: SortDir) {
    setDraft((current) => ({ ...current, sort: { ...current.sort, dir } }))
  }

  function selectGroup(value: GroupKey) {
    setDraft((current) => ({ ...current, groupBy: value === 'none' ? null : value }))
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} trigger={trigger} title="Sort & group">
      <div className="flex flex-col gap-18">
        <div>
          <div className="mb-10 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Sort by
          </div>
          <div className="overflow-hidden rounded-sort-list bg-surface-2">
            {SORT_ROWS.map((row, index) => {
              const active = row.key === draft.sort.key
              // Une ligne, deux zones cliquables (le libellé pose la clé, le
              // segmenté High|Low bascule le sens) : `<button>` ne peut pas
              // imbriquer de second `<button>` (HTML), la ligne est donc un
              // conteneur simple quand le segmenté est absent (ligne
              // inactive) — active, le segmenté porte ses propres boutons
              // et le libellé un bouton frère distinct.
              return (
                <div
                  key={row.key}
                  className={`flex min-h-sort-row w-full items-center gap-12 px-14 ${
                    active ? 'bg-accent-bg' : 'bg-transparent'
                  } ${index > 0 ? 'border-t border-border' : ''}`}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectSortKey(row.key)}
                    className="flex min-w-0 flex-1 items-center gap-12 py-13 text-left"
                  >
                    <row.Icon
                      width={17}
                      height={17}
                      strokeWidth={1.75}
                      className={active ? 'text-accent-text' : 'text-text-2'}
                    />
                    <span
                      className={`min-w-0 flex-1 text-sort-row ${
                        active ? 'font-bold text-text' : 'font-semibold text-text-2'
                      }`}
                    >
                      {row.label}
                    </span>
                  </button>
                  {active && (
                    <div className="flex flex-shrink-0 gap-3 rounded-row-icon bg-surface-sunken p-3">
                      <button
                        type="button"
                        aria-pressed={draft.sort.dir === 'high'}
                        onClick={() => selectDir('high')}
                        className={`flex items-center gap-4 rounded-sort-toggle px-9 py-5 text-sort-toggle font-bold ${
                          draft.sort.dir === 'high' ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'
                        }`}
                      >
                        <ArrowDown width={12} height={12} strokeWidth={1.75} />
                        {row.high}
                      </button>
                      <button
                        type="button"
                        aria-pressed={draft.sort.dir === 'low'}
                        onClick={() => selectDir('low')}
                        className={`flex items-center gap-4 rounded-sort-toggle px-9 py-5 text-sort-toggle font-bold ${
                          draft.sort.dir === 'low' ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'
                        }`}
                      >
                        <ArrowUp width={12} height={12} strokeWidth={1.75} />
                        {row.low}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-10 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Group by
          </div>
          <div className="flex flex-wrap gap-6">
            {GROUP_CHIPS.map((chip) => (
              <Chip
                key={chip.value}
                variant="group"
                label={chip.label}
                selected={chip.value === 'none' ? draft.groupBy === null : draft.groupBy === chip.value}
                onClick={() => selectGroup(chip.value)}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            onChange(draft)
            onOpenChange(false)
          }}
          className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent"
        >
          Apply
        </button>
      </div>
    </ResponsiveSheet>
  )
}
