'use client'

// Réglages de scan, ouverts depuis l'en-tête de l'écran de revue : retour
// d'une carte comptée (son, vibration), cartes reçues en foil, et filtre de
// sets, langue proposée à l'ajout. Enregistrés sur le compte à chaque
// changement (`updateScannerSettingsAction`), relus par l'app Android à
// l'ouverture du scanner ; le filtre est appliqué par le serveur à chaque
// lecture.
import { Check, Languages, Layers, ListFilter, Music, Pencil, ShieldCheck, Smartphone, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { listSetsAction, type SetSummary } from '@/app/(app)/search/actions'
import { SetIcon } from '@/components/cards/set-icon'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { PickerSheet } from '@/components/ui/picker-sheet'
import { SearchField } from '@/components/ui/search-field'
import { Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { languageLabel, SCAN_LANGUAGES } from '@/lib/scanner/languages'
import type { ScannerSettings } from '@/lib/scanner/settings'
import type { Condition } from '@spellcache/db/schema'

import { updateScannerSettingsAction } from './actions'

type ScanLanguage = NonNullable<ScannerSettings['language']>

// Valeurs par défaut des réglages absents du compte (même défaut que l'app
// Android, `CameraSettings.java`).
export interface ScanOptions {
  sound: boolean
  vibration: boolean
  foilDefault: boolean
  language: ScanLanguage
  condition: Condition
  sets: string[]
}

export function scanOptionsOf(settings: ScannerSettings): ScanOptions {
  return {
    sound: settings.sound ?? true,
    vibration: settings.vibration ?? true,
    foilDefault: settings.foilDefault ?? false,
    language: settings.language ?? 'auto',
    condition: settings.condition ?? 'nm',
    sets: settings.sets ?? [],
  }
}

const LANGUAGE_OPTIONS: Array<{ value: ScanLanguage; label: string; hint?: string }> = [
  { value: 'auto', label: 'Detected on the cards', hint: 'The language printed on each card' },
  ...SCAN_LANGUAGES.map((language) => ({ value: language.value as ScanLanguage, label: language.label })),
]

// Libellés longs, comme l'édition groupée (`bulk-edit-sheet.tsx`).
const CONDITION_OPTIONS: Array<{ value: Condition; label: string }> = [
  { value: 'nm', label: 'Near mint' },
  { value: 'lp', label: 'Lightly played' },
  { value: 'mp', label: 'Moderately played' },
  { value: 'hp', label: 'Heavily played' },
  { value: 'dmg', label: 'Damaged' },
]

// Le plus récent d'abord, comme l'onglet Sets ; le texte cherche dans le nom
// et le code.
function matchesQuery(set: SetSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return set.name.toLowerCase().includes(needle) || set.code.toLowerCase() === needle
}

const MAX_RESULTS = 60

function SetPickerSheet({
  open,
  onClose,
  sets,
  selected,
  onToggle,
}: {
  open: boolean
  onClose: () => void
  sets: SetSummary[] | null
  selected: string[]
  onToggle: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(
    () => (sets ?? []).filter((set) => matchesQuery(set, query)).slice(0, MAX_RESULTS),
    [sets, query],
  )

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title="Filter by sets" closeLabel="Done">
      <div className="flex flex-col gap-10">
        <SearchField placeholder="Set name or code..." onSearch={setQuery} debounceMs={150} autoFocus />
        {sets === null && <p className="px-2 text-meta text-text-2">Loading sets...</p>}
        {sets !== null && results.length === 0 && <p className="px-2 text-meta text-text-2">No sets found.</p>}
        <SettingsGroup>
          {results.map((set) => {
            const chosen = selected.includes(set.code)
            return (
              <SettingRow
                key={set.code}
                icon={<SetIcon uri={set.iconSvgUri} />}
                label={set.name}
                subtitle={`${set.code.toUpperCase()}${set.releasedAt ? ` · ${set.releasedAt.slice(0, 4)}` : ''}`}
                onClick={() => onToggle(set.code)}
                chevron={false}
                control={
                  chosen ? (
                    <Check width={18} height={18} strokeWidth={2} className="text-accent-text" aria-label="Selected" />
                  ) : null
                }
              />
            )
          })}
        </SettingsGroup>
      </div>
    </Sheet>
  )
}

export function ScanSettingsSheet({
  open,
  onClose,
  options,
  onChange,
}: {
  open: boolean
  onClose: () => void
  options: ScanOptions
  onChange: (options: ScanOptions) => void
}) {
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [conditionOpen, setConditionOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  // Catalogue des sets chargé à la première ouverture : noms et icônes des
  // sets choisis, et la liste où en ajouter.
  useEffect(() => {
    if (!open || sets !== null) return
    listSetsAction()
      .then(setSets)
      .catch(() => setSets([]))
  }, [open, sets])

  // Optimiste, annulé si l'écriture échoue.
  async function update(patch: Partial<ScanOptions>) {
    const previous = options
    const next = { ...options, ...patch }
    onChange(next)
    setFailed(false)
    const result = await updateScannerSettingsAction(patch).catch(() => ({ ok: false as const }))
    if (!result.ok) {
      onChange(previous)
      setFailed(true)
    }
  }

  function toggleSet(code: string) {
    const chosen = options.sets.includes(code)
    void update({ sets: chosen ? options.sets.filter((set) => set !== code) : [...options.sets, code] })
  }

  const byCode = new Map((sets ?? []).map((set) => [set.code, set]))

  return (
    <>
      <Sheet
        open={open && !pickerOpen && !languageOpen && !conditionOpen}
        onOpenChange={(next) => !next && onClose()}
        title="Scan settings"
      >
        <div className="flex flex-col gap-18">
          <SettingsGroup label="When a card is scanned">
            <SettingRow
              icon={<Music width={18} height={18} strokeWidth={1.75} />}
              label="Sound"
              control={<Switch label="Sound" checked={options.sound} onChange={(sound) => void update({ sound })} />}
            />
            <SettingRow
              icon={<Smartphone width={18} height={18} strokeWidth={1.75} />}
              label="Vibration"
              control={
                <Switch
                  label="Vibration"
                  checked={options.vibration}
                  onChange={(vibration) => void update({ vibration })}
                />
              }
            />
            <SettingRow
              icon={<Sparkles width={18} height={18} strokeWidth={1.75} />}
              label="Foil by default"
              subtitle="For a pile of foils; cards without a foil version stay non-foil"
              control={
                <Switch
                  label="Foil by default"
                  checked={options.foilDefault}
                  onChange={(foilDefault) => void update({ foilDefault })}
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup label="Adding cards">
            <SettingRow
              icon={<Languages width={18} height={18} strokeWidth={1.75} />}
              label="Default language"
              value={options.language === 'auto' ? 'Detected' : languageLabel(options.language)}
              onClick={() => setLanguageOpen(true)}
            />
            <SettingRow
              icon={<ShieldCheck width={18} height={18} strokeWidth={1.75} />}
              label="Default condition"
              value={CONDITION_OPTIONS.find((option) => option.value === options.condition)?.label}
              onClick={() => setConditionOpen(true)}
            />
          </SettingsGroup>

          <SettingsGroup
            label="Sets"
            hint={
              options.sets.length === 0
                ? 'Every set is scanned. Choose sets to scan only their cards; a doubtful reading is then matched within them.'
                : 'Only cards of these sets are counted; a doubtful reading is matched within them.'
            }
          >
            {options.sets.map((code) => {
              const set = byCode.get(code)
              return (
                <SettingRow
                  key={code}
                  icon={set ? <SetIcon uri={set.iconSvgUri} /> : <Layers width={18} height={18} strokeWidth={1.75} />}
                  label={set?.name ?? code.toUpperCase()}
                  subtitle={code.toUpperCase()}
                  control={
                    <button
                      type="button"
                      onClick={() => toggleSet(code)}
                      aria-label={`Remove ${set?.name ?? code.toUpperCase()}`}
                      className="flex h-touch-target w-touch-target items-center justify-center text-text-2"
                    >
                      <X width={17} height={17} strokeWidth={1.75} />
                    </button>
                  }
                />
              )
            })}
            <SettingRow
              icon={
                options.sets.length === 0 ? (
                  <ListFilter width={18} height={18} strokeWidth={1.75} />
                ) : (
                  <Pencil width={18} height={18} strokeWidth={1.75} />
                )
              }
              label={options.sets.length === 0 ? 'Filter by sets' : 'Edit sets'}
              onClick={() => setPickerOpen(true)}
            />
            {options.sets.length > 0 && (
              <SettingRow
                icon={<X width={18} height={18} strokeWidth={1.75} />}
                label="Clear filters"
                onClick={() => void update({ sets: [] })}
                chevron={false}
              />
            )}
          </SettingsGroup>

          {failed && <p className="px-2 text-meta text-danger">Could not save this setting. Please try again.</p>}
        </div>
      </Sheet>

      <PickerSheet
        open={open && languageOpen}
        onClose={() => setLanguageOpen(false)}
        title="Default language"
        options={LANGUAGE_OPTIONS}
        value={options.language}
        onPick={(language) => void update({ language })}
      />

      <PickerSheet
        open={open && conditionOpen}
        onClose={() => setConditionOpen(false)}
        title="Default condition"
        options={CONDITION_OPTIONS}
        value={options.condition}
        onPick={(condition) => void update({ condition })}
      />

      <SetPickerSheet
        open={open && pickerOpen}
        onClose={() => setPickerOpen(false)}
        sets={sets}
        selected={options.sets}
        onToggle={toggleSet}
      />
    </>
  )
}
