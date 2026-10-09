'use client'

// Feuille `Filters` : Colours (six cases 44px,
// segmenté `Including | Exactly | At most`, deux puces bascule), Type (7
// puces), Rarity · finish · condition (chips mélangeant trois filtres
// distincts, `HoldingFilters.rarities`/`finishes`/`conditions` — même rangée
// visuelle, valeurs différentes), Set/Binder/Price, pied `Show N cards`.
//
// État de brouillon strictement local : le confondre avec l'état de l'URL
// appliquerait les filtres au fur et à mesure, ce que le design refuse
// explicitement — `draft` ne rejoint `filters` (l'URL, via `onApply`) qu'au
// tap sur `Show N cards`. Le compte est recalculé à chaque changement de
// `draft`, débounced 200 ms, la requête précédente ignorée si une plus
// récente a déjà été émise, pour ne pas inonder le serveur.
import { BadgeDollarSign, BookCopy, ChevronRight, Package } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { Chip } from '@/components/ui/chip'
import { ColorCell } from '@/components/ui/color-cell'
import { ResponsiveSheet, SHEET_SCROLL_BLEED } from '@/components/ui/responsive-sheet'
import type { Condition } from '@spellcache/db/schema'
import {
  EMPTY_FILTERS,
  type Color,
  type ColorMatch,
  type HoldingFilters,
} from '@/lib/view-state/parse'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  countHoldingsAction,
  listContainerSetsAction,
  type ContainerSetOption,
  type HoldingBinderOption,
} from '@/app/(app)/container/[id]/actions'

const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G', 'C']
const COLOR_MATCH_OPTIONS: Array<{ value: ColorMatch; label: string }> = [
  { value: 'including', label: 'Including' },
  { value: 'exactly', label: 'Exactly' },
  { value: 'atMost', label: 'At most' },
]

// Sept puces `Type` — comparées côté serveur par `ilike` sur
// `cards.type_line` (`holdings-data.ts`), insensible à la casse : la casse
// du libellé n'a donc pas besoin de correspondre exactement à celle de
// Scryfall.
const TYPE_CHIPS = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Planeswalker',
]

// Puces de rareté (valeurs Scryfall en minuscules, `cards.rarity`).
const RARITY_CHIPS: Array<{ value: string; label: string }> = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic' },
]

// Condition (`packages/db/src/schema.ts` — `nm`/`lp`/`mp`/`hp`/`dmg`, mêmes
// libellés que `add-card-sheet.tsx`). Le design écrit `NM`/`EX` — un
// vocabulaire de condition à deux crans jamais posé côté schéma : ce
// composant reprend le jeu de cinq conditions déjà livré, pas le texte
// illustratif du design (même précédent que la devise par défaut).
const CONDITION_CHIPS: Array<{ value: Condition; label: string }> = [
  { value: 'nm', label: 'NM' },
  { value: 'lp', label: 'LP' },
  { value: 'mp', label: 'MP' },
  { value: 'hp', label: 'HP' },
  { value: 'dmg', label: 'DMG' },
]

const COUNT_DEBOUNCE_MS = 200

type PriceKind = 'priceMinMinor' | 'priceMaxMinor'

// `null` : champ vide ; `undefined` : saisie invalide, ignorée.
function parsePriceMinor(raw: string): number | null | undefined {
  const trimmed = raw.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.round(value * 100)
}

export function FiltersSheet({
  open,
  onOpenChange,
  trigger,
  containerId,
  query,
  filters,
  onApply,
  // Filtre `Binder` (voir le commentaire de tête de
  // `listHoldings`, `holdings-data.ts`) : visible UNIQUEMENT sur le container
  // racine (`CommandBar` calcule ce booléen depuis `searchScope`),
  // jamais sur un binder/deck/liste — filtrer « par binder » un container
  // déjà unique resterait un no-op.
  // `binders` porte déjà la racine sous le nom « No binder »
  // (`listHoldingBindersAction`).
  showBinderFilter = false,
  binders = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement<{ onClick?: () => void }>
  containerId: string
  query: string
  filters: HoldingFilters
  onApply: (filters: HoldingFilters) => void
  showBinderFilter?: boolean
  binders?: HoldingBinderOption[]
}) {
  const [draft, setDraft] = useState<HoldingFilters>(filters)
  const [count, setCount] = useState<number | null>(null)
  const [sets, setSets] = useState<ContainerSetOption[]>([])
  const requestIdRef = useRef(0)

  // Le brouillon repart de l'état appliqué à chaque ouverture (`Reset` remet
  // `EMPTY_FILTERS`, une fermeture sans
  // validation ne doit inversement rien laisser filtrer) — jamais persisté
  // entre deux ouvertures.
  useEffect(() => {
    if (!open) return
    setDraft(filters)
  }, [open, filters])

  useEffect(() => {
    if (!open) return
    listContainerSetsAction(containerId)
      .then(setSets)
      .catch(() => setSets([]))
  }, [open, containerId])

  useEffect(() => {
    if (!open) return
    const requestId = ++requestIdRef.current
    const timeout = setTimeout(() => {
      countHoldingsAction({ containerId, query, filters: draft })
        .then((result) => {
          if (requestIdRef.current === requestId) setCount(result.count)
        })
        .catch(() => {
          // Une Server Action rejetée (réseau, session expirée) ne doit ni
          // rester une rejection non gérée, ni figer le bouton primaire sur
          // le dernier compte connu : on ne retient que la requête la plus
          // récente (`requestIdRef`, même garde que le succès) et on retombe
          // sur `null` — le libellé redevient `Show cards` plutôt que
          // d'afficher un nombre potentiellement obsolète.
          if (requestIdRef.current === requestId) setCount(null)
        })
    }, COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [open, containerId, query, draft])

  function toggleColor(color: Color) {
    setDraft((d) => ({
      ...d,
      colors: d.colors.includes(color)
        ? d.colors.filter((c) => c !== color)
        : [...d.colors, color],
    }))
  }

  function toggleType(label: string) {
    setDraft((d) => ({
      ...d,
      types: d.types.includes(label)
        ? d.types.filter((v) => v !== label)
        : [...d.types, label],
    }))
  }

  function toggleRarity(value: string) {
    setDraft((d) => ({
      ...d,
      rarities: d.rarities.includes(value)
        ? d.rarities.filter((v) => v !== value)
        : [...d.rarities, value],
    }))
  }

  function toggleCondition(value: Condition) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.includes(value)
        ? d.conditions.filter((v) => v !== value)
        : [...d.conditions, value],
    }))
  }

  function toggleFoilOnly() {
    setDraft((d) => ({ ...d, finishes: d.finishes.includes('foil') ? [] : ['foil'] }))
  }

  // « Non-foil » — même champ `finishes` que « Foil only », mutuellement
  // exclusives : les deux ne demandent jamais qu'un seul finish à la fois.
  function toggleNonfoilOnly() {
    setDraft((d) => ({
      ...d,
      finishes: d.finishes.includes('nonfoil') ? [] : ['nonfoil'],
    }))
  }

  // Texte saisi, gardé tel quel : recalculé depuis le montant, « 1. » redevenait
  // « 1 » et la décimale ne pouvait jamais se taper. La virgule vaut le point
  // (clavier décimal Android en locale fr/de).
  const [priceText, setPriceText] = useState<Partial<Record<PriceKind, string>>>({})

  function priceField(kind: PriceKind) {
    const raw = priceText[kind]
    // Le texte ne vaut que s'il correspond encore au brouillon (`Reset` le
    // remet à zéro sans passer par ce champ).
    if (raw !== undefined && parsePriceMinor(raw) === draft[kind]) return raw
    const minor = draft[kind]
    return minor === null ? '' : String(minor / 100)
  }

  function setPriceField(kind: PriceKind, raw: string) {
    setPriceText((t) => ({ ...t, [kind]: raw }))
    const minor = parsePriceMinor(raw)
    if (minor === undefined) return
    setDraft((d) => ({ ...d, [kind]: minor }))
  }

  const selectedSet = sets.find((s) => s.code === draft.setCode) ?? null
  const selectedBinder = binders.find((b) => b.id === draft.binderId) ?? null

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title="Filters"
      maxHeight
      scrollBody={false}
      headerAction={
        <button
          type="button"
          onClick={() => setDraft(EMPTY_FILTERS)}
          className="flex-shrink-0 text-meta font-bold text-accent-text"
        >
          Reset
        </button>
      }
    >
      <ScrollArea
        className={SHEET_SCROLL_BLEED.inner}
        outerClassName={SHEET_SCROLL_BLEED.outer}
      >
        <div className="flex flex-col gap-18">
          <div>
            <div className="mb-10 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Colours
            </div>
            <div className="mb-10 flex gap-8">
              {COLORS.map((color) => (
                <ColorCell
                  key={color}
                  color={color}
                  selected={draft.colors.includes(color)}
                  onClick={() => toggleColor(color)}
                />
              ))}
            </div>
            <div className="flex gap-3 rounded-chip bg-surface-2 p-3">
              {COLOR_MATCH_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={draft.colorMatch === option.value}
                  onClick={() => setDraft((d) => ({ ...d, colorMatch: option.value }))}
                  className={`flex-1 rounded-row-icon py-8 text-chip font-bold ${
                    draft.colorMatch === option.value
                      ? 'bg-accent text-on-accent'
                      : 'bg-transparent text-text-2'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-8 flex gap-6">
              <Chip
                label="Multicolour only"
                variant="toggle"
                selected={draft.multicolourOnly}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    multicolourOnly: !d.multicolourOnly,
                    monoOnly: false,
                  }))
                }
              />
              <Chip
                label="Mono only"
                variant="toggle"
                selected={draft.monoOnly}
                onClick={() =>
                  setDraft((d) => ({ ...d, monoOnly: !d.monoOnly, multicolourOnly: false }))
                }
              />
            </div>
          </div>

          <div>
            <div className="mb-10 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Type
            </div>
            <div className="flex flex-wrap gap-6">
              {TYPE_CHIPS.map((label) => (
                <Chip
                  key={label}
                  label={label}
                  selected={draft.types.includes(label)}
                  onClick={() => toggleType(label)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-10 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Rarity · finish · condition
            </div>
            <div className="flex flex-wrap gap-6">
              {RARITY_CHIPS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={draft.rarities.includes(option.value)}
                  onClick={() => toggleRarity(option.value)}
                />
              ))}
              <Chip
                label="Foil only"
                selected={draft.finishes.includes('foil')}
                onClick={toggleFoilOnly}
              />
              <Chip
                label="Non-foil"
                selected={draft.finishes.includes('nonfoil')}
                onClick={toggleNonfoilOnly}
              />
              {CONDITION_CHIPS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={draft.conditions.includes(option.value)}
                  onClick={() => toggleCondition(option.value)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-9">
            <div className="relative flex items-center gap-12 rounded-control border border-border bg-surface-2 px-13 py-12">
              <Package
                width={17}
                height={17}
                className="flex-shrink-0 text-text-2"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 text-row-value font-semibold text-text">
                Set
              </span>
              <span className="text-body font-semibold text-text-2">
                {selectedSet ? selectedSet.name : 'Any'}
              </span>
              <ChevronRight
                width={16}
                height={16}
                className="flex-shrink-0 text-text-3"
                strokeWidth={1.75}
              />
              <select
                aria-label="Set"
                value={draft.setCode ?? ''}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    setCode: event.target.value === '' ? null : event.target.value,
                  }))
                }
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                <option value="">Any</option>
                {sets.map((set) => (
                  <option key={set.code} value={set.code}>
                    {set.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Ligne `Binder` (voir le commentaire de tête de
                `listHoldings`, `holdings-data.ts`) : visible UNIQUEMENT sur
                le container racine (`showBinderFilter`,
                calculé par `CommandBar` depuis `searchScope`) — un binder/deck/
                liste ouvert directement reste un container unique, filtrer «
                par binder » y serait toujours un no-op. Même
                gabarit que la ligne `Set` juste au-dessus : `<select>` natif
                superposé en overlay transparent sur tout le rectangle,
                l'affichage fermé lit `selectedBinder?.name`. `listHoldingBindersAction`
                rend déjà la racine sous le nom « No binder » — sélectionnable
                au même titre qu'un binder précis, aucun cas spécial ici. */}
            {showBinderFilter && (
              <div className="relative flex items-center gap-12 rounded-control border border-border bg-surface-2 px-13 py-12">
                <BookCopy
                  width={17}
                  height={17}
                  className="flex-shrink-0 text-text-2"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1 text-row-value font-semibold text-text">
                  Binder
                </span>
                <span className="text-body font-semibold text-text-2">
                  {selectedBinder ? selectedBinder.name : 'Any'}
                </span>
                <ChevronRight
                  width={16}
                  height={16}
                  className="flex-shrink-0 text-text-3"
                  strokeWidth={1.75}
                />
                <select
                  aria-label="Binder"
                  value={draft.binderId ?? ''}
                  onChange={(event) =>
                    setDraft((d) => ({
                      ...d,
                      binderId: event.target.value === '' ? null : event.target.value,
                    }))
                  }
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                  <option value="">Any</option>
                  {binders.map((binder) => (
                    <option key={binder.id} value={binder.id}>
                      {binder.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-10 rounded-control border border-border bg-surface-2 px-13 py-12">
              <BadgeDollarSign
                width={17}
                height={17}
                className="flex-shrink-0 text-text-2"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 text-row-value font-semibold text-text">
                Price
              </span>
              <input
                inputMode="decimal"
                value={priceField('priceMinMinor')}
                onChange={(event) => setPriceField('priceMinMinor', event.target.value)}
                className="w-price-input rounded-filter-input border border-border bg-surface-sunken px-9 py-7 text-right text-body text-text"
              />
              <span className="text-body text-text-3">to</span>
              <input
                inputMode="decimal"
                placeholder="∞"
                value={priceField('priceMaxMinor')}
                onChange={(event) => setPriceField('priceMaxMinor', event.target.value)}
                className="w-price-input rounded-filter-input border border-border bg-surface-sunken px-9 py-7 text-right text-body text-text placeholder:text-text-3"
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <div className="bg-surface-3 pt-18">
        <button
          type="button"
          onClick={() => {
            onApply(draft)
            onOpenChange(false)
          }}
          className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent"
        >
          {count === null
            ? 'Show cards'
            : `Show ${count} ${count === 1 ? 'card' : 'cards'}`}
        </button>
      </div>
    </ResponsiveSheet>
  )
}
