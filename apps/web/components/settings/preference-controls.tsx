'use client'

// Contrôles connectés de Settings : chacun tient son
// propre état local, initialisé depuis les props serveur (`page.tsx`), et
// appelle `updatePreferenceAction` — jamais `localStorage` (docs/development.md). Mise
// à jour optimiste avec retour arrière sur échec (même patron que les
// quantités de holding). Des îlots clients minces, pas un wrapper qui
// rendrait tout `Appearance`/`Preferences` côté client.
import {
  BadgeDollarSign,
  Check,
  Contrast,
  FlaskConical,
  HeartPulse,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Paintbrush,
  Palette,
  PanelRight,
  Rows3,
  SunMoon,
  Sun,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'

import { updatePreferenceAction } from '@/app/(app)/settings/preferences-actions'
import { SettingRow } from '@/components/settings/setting-row'
import { StylePicker } from '@/components/settings/style-picker'
import { Switch } from '@/components/ui/switch'
import type { AccentColor, ColorScheme, Density, LayoutStyle, PriceSource } from '@spellcache/db/schema'
import { currencyOf, marketLabelOf } from '@/lib/price-source'
import { applyAccentColor, applyColorScheme, applyPureBlack } from '@/lib/theme-attributes'

export function StyleRow({
  field,
  label,
  hint,
  initialValue,
}: {
  field: 'collectionStyle'
  label: string
  hint: string
  initialValue: LayoutStyle
}) {
  const [value, setValue] = useState(initialValue)

  async function handleChange(next: LayoutStyle) {
    const previous = value
    setValue(next)
    const result = await updatePreferenceAction({ [field]: next })
    if (!result.ok) setValue(previous)
  }

  return <StylePicker label={label} hint={hint} value={value} onChange={(v) => void handleChange(v)} />
}

const DENSITY_OPTIONS: Array<{ value: Density; label: string; Icon: typeof Rows3 }> = [
  { value: 'rows', label: 'Rows', Icon: Rows3 },
  { value: 'compact', label: 'Compact', Icon: List },
  { value: 'grid', label: 'Grid', Icon: LayoutGrid },
]

// Distinct du `DensityPicker` de la barre de commande (celui-là écrase la vue
// courante sans jamais toucher
// `users.density`). Ici, à l'inverse, la seule ligne qui écrit la
// préférence de compte elle-même.
export function DensityRow({ initialValue }: { initialValue: Density }) {
  const [value, setValue] = useState(initialValue)

  async function handleChange(next: Density) {
    const previous = value
    setValue(next)
    const result = await updatePreferenceAction({ density: next })
    if (!result.ok) setValue(previous)
  }

  return (
    <SettingRow
      icon={<Rows3 width={18} height={18} strokeWidth={1.75} />}
      label="Card list density"
      control={
        <div className="flex flex-shrink-0 gap-3 rounded-control-compact bg-surface-2 p-3">
          {DENSITY_OPTIONS.map(({ value: optionValue, label, Icon }) => {
            const active = optionValue === value
            return (
              <button
                key={optionValue}
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={() => void handleChange(optionValue)}
                className={`flex h-settings-density-button w-settings-density-button items-center justify-center rounded-row-icon ${
                  active ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'
                }`}
              >
                {/* Icônes de densité en 16px, pas 15. */}
                <Icon width={16} height={16} strokeWidth={1.75} />
              </button>
            )
          })}
        </div>
      }
    />
  )
}

// `toolLifeTracker` et `toolPlaytest` rejoignent ici les bascules d'apparence :
// c'est une préférence de compte comme les autres, écrite par la même
// `updatePreferenceAction` — aucune Server Action propre aux outils
// n'existe, et rien ne passe par `localStorage` (docs/development.md).
type ToggleField =
  | 'previewPane'
  | 'pricesOnArt'
  | 'binderBackdrops'
  | 'toolLifeTracker'
  | 'toolPlaytest'
  | 'pureBlack'

const TOGGLE_ICON: Record<ToggleField, React.ReactNode> = {
  previewPane: <PanelRight width={18} height={18} strokeWidth={1.75} />,
  pricesOnArt: <BadgeDollarSign width={18} height={18} strokeWidth={1.75} />,
  binderBackdrops: <Palette width={18} height={18} strokeWidth={1.75} />,
  toolLifeTracker: <HeartPulse width={18} height={18} strokeWidth={1.75} />,
  toolPlaytest: <FlaskConical width={18} height={18} strokeWidth={1.75} />,
  pureBlack: <Contrast width={18} height={18} strokeWidth={1.75} />,
}

const COLOR_SCHEME_OPTIONS: Array<{ value: ColorScheme; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

// Même contrôle segmenté que `DensityRow`, appliqué sur `<html>` tout de
// suite (optimiste), annulé si l'écriture échoue.
export function ColorSchemeRow({ initialValue }: { initialValue: ColorScheme }) {
  const [value, setValue] = useState(initialValue)

  async function handleChange(next: ColorScheme) {
    const previous = value
    setValue(next)
    applyColorScheme(next)
    const result = await updatePreferenceAction({ colorScheme: next })
    if (!result.ok) {
      setValue(previous)
      applyColorScheme(previous)
    }
  }

  return (
    <SettingRow
      icon={<SunMoon width={18} height={18} strokeWidth={1.75} />}
      label="Theme"
      control={
        <div className="flex flex-shrink-0 gap-3 rounded-control-compact bg-surface-2 p-3">
          {COLOR_SCHEME_OPTIONS.map(({ value: optionValue, label, Icon }) => {
            const active = optionValue === value
            return (
              <button
                key={optionValue}
                type="button"
                aria-label={label}
                aria-pressed={active}
                title={label}
                onClick={() => void handleChange(optionValue)}
                className={`flex h-settings-density-button w-settings-density-button items-center justify-center rounded-row-icon ${
                  active ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'
                }`}
              >
                <Icon width={16} height={16} strokeWidth={1.75} />
              </button>
            )
          })}
        </div>
      }
    />
  )
}

// Bascules qui changent le thème : appliquées sur `<html>` tout de suite
// (optimiste, comme la valeur du Switch), annulées si l'écriture échoue.
const TOGGLE_APPLY: Partial<Record<ToggleField, (value: boolean) => void>> = {
  pureBlack: applyPureBlack,
}

// Libellés et classes de pastille, dans l'ordre d'affichage. Les classes
// pointent sur des tokens fixes (`--color-swatch-*`), jamais sur
// `--color-accent` : chaque pastille montre sa propre couleur.
const ACCENT_OPTIONS: Array<{ value: AccentColor; label: string; swatchClass: string }> = [
  { value: 'gold', label: 'Gold', swatchClass: 'bg-swatch-gold' },
  { value: 'blue', label: 'Blue', swatchClass: 'bg-swatch-blue' },
  { value: 'violet', label: 'Violet', swatchClass: 'bg-swatch-violet' },
  { value: 'silver', label: 'Silver', swatchClass: 'bg-swatch-silver' },
]

export function AccentRow({ initialValue }: { initialValue: AccentColor }) {
  const [value, setValue] = useState(initialValue)

  async function handleChange(next: AccentColor) {
    const previous = value
    setValue(next)
    applyAccentColor(next)
    const result = await updatePreferenceAction({ accentColor: next })
    if (!result.ok) {
      setValue(previous)
      applyAccentColor(previous)
    }
  }

  return (
    <SettingRow
      icon={<Paintbrush width={18} height={18} strokeWidth={1.75} />}
      label="Accent color"
      control={
        <div role="radiogroup" aria-label="Accent color" className="flex flex-shrink-0 gap-10">
          {ACCENT_OPTIONS.map(({ value: optionValue, label, swatchClass }) => {
            const active = optionValue === value
            return (
              <button
                key={optionValue}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                title={label}
                onClick={() => void handleChange(optionValue)}
                className={`flex h-accent-swatch w-accent-swatch items-center justify-center rounded-full ${swatchClass} ${
                  active ? 'ring-2 ring-text ring-offset-2 ring-offset-surface-1' : ''
                }`}
              >
                {active && <Check width={14} height={14} strokeWidth={3.5} className="text-on-accent" />}
              </button>
            )
          })}
        </div>
      }
    />
  )
}

export function ToggleRow({
  field,
  label,
  subtitle,
  initialValue,
  phoneHidden = false,
  darkOnly = false,
}: {
  field: ToggleField
  label: string
  subtitle?: string
  initialValue: boolean
  // Masquée sous `--breakpoint-tablet` par `SettingsGroup` (réglage sans
  // effet sur un téléphone).
  phoneHidden?: boolean
  // Masquée par `SettingsGroup` en thème clair (réglage sans effet hors du
  // sombre).
  darkOnly?: boolean
}) {
  const [value, setValue] = useState(initialValue)

  async function handleChange(next: boolean) {
    const previous = value
    setValue(next)
    TOGGLE_APPLY[field]?.(next)
    const result = await updatePreferenceAction({ [field]: next })
    if (!result.ok) {
      setValue(previous)
      TOGGLE_APPLY[field]?.(previous)
    }
  }

  const row = (
    <SettingRow
      icon={TOGGLE_ICON[field]}
      label={label}
      subtitle={subtitle}
      control={<Switch checked={value} onChange={(v) => void handleChange(v)} label={label} />}
    />
  )

  if (phoneHidden) return <div data-phone-hidden>{row}</div>
  if (darkOnly) return <div data-dark-only>{row}</div>
  return row
}

// `Currency` et `Price source` dérivent tous deux du même état `priceSource`
// — jamais deux états locaux qui pourraient se désynchroniser.
const CURRENCY_LABEL: Record<'usd' | 'eur', string> = { usd: 'USD ($)', eur: 'EUR (€)' }

export function CurrencyRow({ initialValue }: { initialValue: PriceSource }) {
  const [priceSource, setPriceSource] = useState(initialValue)

  async function handleChange(next: PriceSource) {
    const previous = priceSource
    setPriceSource(next)
    const result = await updatePreferenceAction({ priceSource: next })
    if (!result.ok) setPriceSource(previous)
  }

  const selectClassName =
    'rounded-control border border-border bg-surface-2 px-10 py-7 text-row-value font-semibold text-text'

  return (
    // Racine unique plutôt qu'un `<>...</>` (séparateur
    // `1px solid rgba(255,255,255,0.05)` entre lignes) :
    // `SettingsGroup` insère la bordure haute entre ses enfants directs,
    // `CurrencyRow` en est un seul (composant connecté, état `priceSource`
    // partagé) — la bordure entre `Currency` et `Price source`
    // doit donc être posée ici, pas déléguée au conteneur. `value` des deux
    // `<select>` reste `priceSource` (pas `currencyOf(...)`) : c'est la
    // même valeur d'énumération qu'écrit `updatePreferenceAction`, testée
    // telle quelle par `tests/e2e/settings.spec.ts` —
    // `currencyOf` sert seulement à produire le libellé `USD ($)`/`EUR (€)`
    // ci-dessous, pas à choisir un second domaine de valeurs.
    <div>
      <SettingRow
        icon={<Wallet width={18} height={18} strokeWidth={1.75} />}
        label="Currency"
        control={
          <select
            aria-label="Currency"
            value={priceSource}
            onChange={(event) => void handleChange(event.target.value as PriceSource)}
            className={selectClassName}
          >
            {/* Libellés produits par `currencyOf`. */}
            <option value="tcgplayer_usd">
              {CURRENCY_LABEL[currencyOf({ priceSource: 'tcgplayer_usd' })]}
            </option>
            <option value="cardmarket_eur">
              {CURRENCY_LABEL[currencyOf({ priceSource: 'cardmarket_eur' })]}
            </option>
          </select>
        }
      />
      <div className="border-t border-border">
        <SettingRow
          icon={<BadgeDollarSign width={18} height={18} strokeWidth={1.75} />}
          label="Price source"
          subtitle="Which market the values come from"
          control={
            <select
              aria-label="Price source"
              value={priceSource}
              onChange={(event) => void handleChange(event.target.value as PriceSource)}
              className={selectClassName}
            >
              {/* Libellés produits par `marketLabelOf`,
                  pas des chaînes dupliquées à la main. */}
              <option value="tcgplayer_usd">{marketLabelOf({ priceSource: 'tcgplayer_usd' })}</option>
              <option value="cardmarket_eur">{marketLabelOf({ priceSource: 'cardmarket_eur' })}</option>
            </select>
          }
        />
      </div>
    </div>
  )
}
