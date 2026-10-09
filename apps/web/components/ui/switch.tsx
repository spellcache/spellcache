'use client'

// Interrupteur générique, valeurs du design validé : piste 44×26, rayon 20,
// poignée 20px ; l'état inactif (`--color-switch-off`) vient de la ligne
// `Trading mode`, seul interrupteur dessiné `off`. Un `<button role="switch">`,
// jamais une case à cocher stylée : même patron d'accessibilité que le
// `role="radiogroup"` de `StylePicker`.
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-switch w-switch flex-shrink-0 items-center rounded-switch p-3 disabled:opacity-60 ${
        checked ? 'justify-end bg-accent' : 'justify-start bg-switch-off'
      }`}
    >
      {/* Poignée grise à l'état off : une poignée blanche dans les deux
          états rend l'état illisible. */}
      <span
        className={`h-switch-knob w-switch-knob rounded-full ${checked ? 'bg-on-accent' : 'bg-text-2'}`}
      />
    </button>
  )
}
