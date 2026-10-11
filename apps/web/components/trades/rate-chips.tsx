'use client'

// Ajustement de la valeur d'un côté (« je prends tes cartes à 90 % ») : des
// paliers courants, la valeur en cours quand elle n'en est pas un, et une
// saisie libre bornée par `RATE_MIN_PCT`/`RATE_MAX_PCT`.
import { Chip } from '@/components/ui/chip'
import { RATE_PRESETS_PCT } from '@/lib/trades/pricing'

export function RateChips({
  value,
  disabled,
  onChange,
  onCustom,
}: {
  value: number
  disabled: boolean
  onChange: (ratePct: number) => void
  onCustom: () => void
}) {
  const presets: number[] = [...RATE_PRESETS_PCT]
  const options = presets.includes(value)
    ? presets
    : [...presets, value].sort((a, b) => a - b)
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
          selected={rate === value}
          disabled={disabled}
          variant="toggle"
          onClick={() => rate !== value && onChange(rate)}
        />
      ))}
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
