'use client'

// Feuille de filtres de l'onglet Sets (demande produit, 2026-09-01) — même
// coquille et mêmes gestes que la feuille de filtres des cartes : brouillon
// local, `Reset`, bouton « Show N sets ». Elle porte l'interrupteur « Ignore
// Tokens and Art Series » (déplacé depuis la rangée sous le champ) et un
// filtre par années de sortie (bornes inclusives sur l'année de
// `released_at` ; un set sans date est masqué dès qu'une borne est posée).
import { useState } from 'react'

import { Sheet } from '@/components/ui/sheet'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/sheet-controls'
import {
  DEFAULT_SET_TYPE_GROUPS,
  isDefaultSetTypeSelection,
  SET_TYPE_GROUPS,
  type SetTypeGroup,
} from '@/lib/search/set-type-groups'

export interface SetsFilters {
  // Familles « Set · Type » à montrer — mêmes puces et même défaut
  // (Release + Tokens) que la feuille de filtres des cartes.
  setTypes: SetTypeGroup[]
  // Saisies telles quelles (chaîne vide = borne absente) — la validation
  // numérique se fait à l'application, comme les bornes de prix des cartes.
  yearFrom: string
  yearTo: string
}

export const EMPTY_SETS_FILTERS: SetsFilters = {
  setTypes: DEFAULT_SET_TYPE_GROUPS,
  yearFrom: '',
  yearTo: '',
}

// Nombre de filtres « posés » pour le badge du bouton — la sélection
// Set · Type compte pour 1 dès qu'elle s'écarte du défaut.
export function activeSetsFilterCount(filters: SetsFilters): number {
  let count = 0
  if (filters.yearFrom.trim() !== '') count += 1
  if (filters.yearTo.trim() !== '') count += 1
  if (!isDefaultSetTypeSelection(filters.setTypes)) count += 1
  return count
}

export function SetsFiltersSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  countFor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: SetsFilters
  onApply: (next: SetsFilters) => void
  // Compte les sets visibles pour un brouillon donné — calculé par le
  // parent, qui tient la liste complète.
  countFor: (next: SetsFilters) => number
}) {
  const [draft, setDraft] = useState<SetsFilters>(filters)

  function patch(partial: Partial<SetsFilters>) {
    setDraft((current) => ({ ...current, ...partial }))
  }

  const shown = countFor(draft)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setDraft(filters)
      }}
      title="Filters"
      headerAction={
        <button
          type="button"
          onClick={() => setDraft(EMPTY_SETS_FILTERS)}
          className="text-meta font-bold text-accent-text"
        >
          Reset
        </button>
      }
    >
      <SectionLabel>Set · Type</SectionLabel>
      <div className="mb-20 flex flex-wrap gap-6">
        {SET_TYPE_GROUPS.map((group) => (
          <Chip
            key={group.value}
            variant="group"
            label={group.label}
            selected={draft.setTypes.includes(group.value)}
            onClick={() =>
              patch({
                setTypes: draft.setTypes.includes(group.value)
                  ? draft.setTypes.filter((value) => value !== group.value)
                  : [...draft.setTypes, group.value],
              })
            }
          />
        ))}
      </div>

      <SectionLabel>Year</SectionLabel>
      <div className="mb-20 flex items-center gap-10">
        <input
          type="text"
          inputMode="numeric"
          value={draft.yearFrom}
          onChange={(event) => patch({ yearFrom: event.target.value })}
          placeholder="1993"
          aria-label="From year"
          className="w-price-input rounded-control border border-border bg-surface-2 px-10 py-9 text-center text-body text-text outline-none placeholder:text-text-3"
        />
        <span className="text-meta text-text-2">to</span>
        <input
          type="text"
          inputMode="numeric"
          value={draft.yearTo}
          onChange={(event) => patch({ yearTo: event.target.value })}
          placeholder="∞"
          aria-label="To year"
          className="w-price-input rounded-control border border-border bg-surface-2 px-10 py-9 text-center text-body text-text outline-none placeholder:text-text-3"
        />
      </div>

      <button
        type="button"
        onClick={() => {
          onApply(draft)
          onOpenChange(false)
        }}
        className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent"
      >
        {`Show ${shown} ${shown === 1 ? 'set' : 'sets'}`}
      </button>
    </Sheet>
  )
}
