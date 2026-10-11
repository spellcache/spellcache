'use client'

// Ajustement de la valeur d'un côté : un pourcentage (« je prends tes cartes
// à 90 % ») parmi des paliers courants, ou une valeur fixe (« tes cartes
// valent 20 € pour moi »). La valeur en cours s'affiche même quand elle
// n'est pas un palier ; « Custom » ouvre la saisie libre.
import { Chip } from '@/components/ui/chip'
import { formatMoney, type Currency } from '@/lib/format/money'
import { RATE_PRESETS_PCT } from '@/lib/trades/pricing'

export function RateChips({
  value,
  fixedMinor,
  currency,
  disabled,
  onChange,
  onCustom,
}: {
  value: number
  fixedMinor: number | null
  currency: Currency
  disabled: boolean
  onChange: (ratePct: number) => void
  onCustom: () => void
}) {
  const fixed = fixedMinor !== null
  const presets: number[] = [...RATE_PRESETS_PCT]
  const options =
    fixed || presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b)
  return (
    <div
      className="flex flex-wrap items-center gap-6"
      role="group"
      aria-label="Value adjustment"
    >
      {options.map((rate) => (
        <Chip
          key={rate}
          label={`${rate}%`}
          selected={!fixed && rate === value}
          disabled={disabled}
          variant="toggle"
          onClick={() => (fixed || rate !== value) && onChange(rate)}
        />
      ))}
      {fixed && (
        <Chip
          label={formatMoney(fixedMinor, currency)}
          selected
          disabled={disabled}
          variant="toggle"
          onClick={onCustom}
        />
      )}
      <Chip
        label="Custom"
        selected={false}
        disabled={disabled}
        variant="toggle"
        onClick={onCustom}
      />
    </div>
  )
}
