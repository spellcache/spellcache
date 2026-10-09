'use client'

// Le panneau de filtres de la recherche de cartes : des sections de puces,
// puis les deux filtres qui portent une valeur propre (le set, la fourchette
// de prix). Il édite un brouillon et ne le remonte qu'à `Show cards` — un
// filtre à moitié posé ne doit pas déclencher une recherche par frappe.
//
// Deux choses que la feuille de filtres de la collection a et que
// celle-ci n'a délibérément pas : la condition, qui appartient à un
// exemplaire possédé alors qu'une recherche de catalogue n'en contient aucun ;
// et un compteur de résultats sur le bouton, le nombre n'étant connu qu'une
// fois la recherche exécutée.
import { DollarSign, Package } from 'lucide-react'
import { useState } from 'react'

import type { SetSummary } from '@/app/(app)/search/actions'
import { Chip } from '@/components/ui/chip'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton, SectionLabel, SheetGroup, SheetRow } from '@/components/ui/sheet-controls'

import { SearchColorCell } from './search-color-cell'
import { SetPickerSheet } from './set-picker-sheet'
import {
  DEFAULT_SET_TYPE_GROUPS,
  isDefaultSetTypeSelection,
  SET_TYPE_GROUPS,
  type SetTypeGroup,
} from '@/lib/search/set-type-groups'

export type ColorMatch = 'including' | 'exactly' | 'atMost'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic'
export type SearchColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
// Spectre de couleur : troisième axe du bloc
// couleurs, orthogonal aux pips — `null` : pas de contrainte.
export type ColorSpread = 'multi' | 'mono' | null

export interface SearchFilters {
  colors: SearchColor[]
  colorMatch: ColorMatch
  colorSpread: ColorSpread
  types: string[]
  rarities: Rarity[]
  setCode: string | null
  priceMin: string
  priceMax: string
  foilOnly: boolean
  // Familles « Set · Type » à montrer (demande produit) — multi-sélection
  // comme `Type`, défaut Release + Tokens (`lib/search/set-type-groups.ts`).
  // Vide = tout montrer. Compte pour 1 dans le badge dès que la sélection
  // s'écarte du défaut.
  setTypes: SetTypeGroup[]
}

export const EMPTY_FILTERS: SearchFilters = {
  colors: [],
  colorMatch: 'including',
  colorSpread: null,
  types: [],
  rarities: [],
  setCode: null,
  priceMin: '',
  priceMax: '',
  foilOnly: false,
  setTypes: DEFAULT_SET_TYPE_GROUPS,
}

// Le vocabulaire des puces de type : `type_line` part au serveur en liste,
// ces valeurs n'en sont que les entrées lisibles. `Land` avant
// `Planeswalker`.
const CARD_TYPES = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Planeswalker',
]

const RARITIES: Array<{ value: Rarity; label: string }> = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic' },
]

const COLORS: SearchColor[] = ['W', 'U', 'B', 'R', 'G', 'C']

const COLOR_MATCHES: Array<{ value: ColorMatch; label: string }> = [
  { value: 'including', label: 'Including' },
  { value: 'exactly', label: 'Exactly' },
  { value: 'atMost', label: 'At most' },
]

const COLOR_SPREADS: Array<{ value: NonNullable<ColorSpread>; label: string }> = [
  { value: 'multi', label: 'Multicolour only' },
  { value: 'mono', label: 'Mono only' },
]

// Combien de filtres sont réellement posés — le nombre que porte le bouton
// `Filters` de l'écran. La fourchette de prix compte pour deux
// (`priceMin` et `priceMax` comptent séparément), et `colorSpread` pour un
// de plus.
export function activeFilterCount(filters: SearchFilters): number {
  let count = 0
  if (filters.colors.length > 0) count += 1
  if (filters.colorSpread) count += 1
  if (filters.types.length > 0) count += 1
  if (filters.rarities.length > 0) count += 1
  if (filters.setCode) count += 1
  if (filters.priceMin.trim() !== '') count += 1
  if (filters.priceMax.trim() !== '') count += 1
  if (filters.foilOnly) count += 1
  if (!isDefaultSetTypeSelection(filters.setTypes)) count += 1
  return count
}

export function SearchFiltersSheet({
  open,
  onOpenChange,
  filters,
  sets,
  onApply,
  // `false` à l'intérieur d'un set : le set est l'écran où l'on se trouve
  // déjà, l'y proposer serait une sortie, pas un filtre.
  showSet = true,
  showSetTypes = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: SearchFilters
  sets: SetSummary[]
  onApply: (next: SearchFilters) => void
  showSet?: boolean
  showSetTypes?: boolean
}) {
  const [draft, setDraft] = useState(filters)
  const [setPickerOpen, setSetPickerOpen] = useState(false)

  function patch(next: Partial<SearchFilters>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  }

  const chosenSet = sets.find((entry) => entry.code === draft.setCode)

  return (
    <>
      <Sheet
        open={open && !setPickerOpen}
        onOpenChange={onOpenChange}
        title="Filters"
        headerAction={
          <button
            type="button"
            onClick={() => setDraft(EMPTY_FILTERS)}
            className="text-row-value font-bold text-accent-text"
          >
            Reset
          </button>
        }
      >
        <SectionLabel>Colours</SectionLabel>
        <div className="mb-12 flex flex-wrap gap-6">
          {COLORS.map((color) => (
            <SearchColorCell
              key={color}
              color={color}
              selected={draft.colors.includes(color)}
              onClick={() => patch({ colors: toggle(draft.colors, color) })}
            />
          ))}
        </div>
        <div className="mb-12">
          <Segmented
            options={COLOR_MATCHES}
            value={draft.colorMatch}
            onChange={(next) => patch({ colorMatch: next })}
            size="compact"
          />
        </div>
        <div className="mb-20 flex flex-wrap gap-6">
          {COLOR_SPREADS.map((spread) => (
            <Chip
              key={spread.value}
              variant="group"
              label={spread.label}
              selected={draft.colorSpread === spread.value}
              onClick={() =>
                patch({ colorSpread: draft.colorSpread === spread.value ? null : spread.value })
              }
            />
          ))}
        </div>

        <SectionLabel>Type</SectionLabel>
        <div className="mb-20 flex flex-wrap gap-6">
          {CARD_TYPES.map((type) => (
            <Chip
              key={type}
              variant="group"
              label={type}
              selected={draft.types.includes(type)}
              onClick={() => patch({ types: toggle(draft.types, type) })}
            />
          ))}
        </div>

        <SectionLabel>Rarity · Finish</SectionLabel>
        <div className="mb-20 flex flex-wrap gap-6">
          {RARITIES.map((rarity) => (
            <Chip
              key={rarity.value}
              variant="group"
              label={rarity.label}
              selected={draft.rarities.includes(rarity.value)}
              onClick={() => patch({ rarities: toggle(draft.rarities, rarity.value) })}
            />
          ))}
          <Chip
            variant="group"
            label="Foil only"
            selected={draft.foilOnly}
            onClick={() => patch({ foilOnly: !draft.foilOnly })}
          />
        </div>

        {showSetTypes && (
          <>
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
          </>
        )}

        <div className="mb-18">
          <SheetGroup>
            {showSet && (
              <SheetRow
                icon={Package}
                label="Set"
                value={
                  chosenSet ? chosenSet.name : draft.setCode ? draft.setCode.toUpperCase() : 'Any'
                }
                onClick={() => setSetPickerOpen(true)}
              />
            )}
            {/* Le prix du marché de l'impression, dans la devise du compte —
                pas ce que vaut un exemplaire qu'on posséderait. */}
            <SheetRow
              icon={DollarSign}
              label="Price"
              value={
                <span className="flex items-center gap-8">
                  <input
                    inputMode="decimal"
                    aria-label="Minimum price"
                    value={draft.priceMin}
                    onChange={(event) => patch({ priceMin: event.target.value })}
                    placeholder="0"
                    className="w-price-input rounded-control border border-border bg-surface-1 px-10 py-8 text-center text-row-value font-bold text-text outline-none"
                  />
                  <span className="text-meta text-text-3">to</span>
                  <input
                    inputMode="decimal"
                    aria-label="Maximum price"
                    value={draft.priceMax}
                    onChange={(event) => patch({ priceMax: event.target.value })}
                    placeholder="∞"
                    className="w-price-input rounded-control border border-border bg-surface-1 px-10 py-8 text-center text-row-value font-bold text-text outline-none"
                  />
                </span>
              }
            />
          </SheetGroup>
        </div>

        <PrimaryButton onClick={() => onApply(draft)}>Show cards</PrimaryButton>
      </Sheet>

      <SetPickerSheet
        open={setPickerOpen}
        onClose={() => setSetPickerOpen(false)}
        sets={sets}
        value={draft.setCode}
        onPick={(code) => {
          patch({ setCode: code })
          setSetPickerOpen(false)
        }}
      />
    </>
  )
}
