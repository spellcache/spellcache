'use client'

// Puce sélectionnable générique, réutilisée pour `Type`,
// `Rarity · finish · condition` et les deux bascules `Multicolour only` /
// `Mono only` de la feuille `Filters`. Rayon du design validé
// (`border-radius:20px`) — même famille que `--radius-pill` (badges
// condition/foil/qty de `CardRow`/`GridTile`), pas les 9-12px des puces
// « segment » distinctes (`--radius-row-icon`/`--radius-segment`, composant
// `Segmented`). Hauteur constante quel que soit l'état (une puce qui grandit à
// la sélection décalerait toute la rangée) — le même padding et la même
// épaisseur de bordure (1px) dans les deux états, seule la couleur change.
//
// `variant` distingue les trois gabarits du design (même patron que le
// `gap` de `ManaCost`, `components/cards/mana-cost.tsx`) : `value` (`Type`,
// `Rarity · finish · condition`, padding 7px 12px, `--text-chip`), `toggle`
// (`Multicolour only` / `Mono only`, padding 6px 11px, `--text-chip-toggle`)
// et `group` (`Group by`, padding 8px 13px, `--text-chip-group`) — trois
// tailles de police et de padding distinctes au pixel, pas une approximation
// commune.
export function Chip({
  label,
  selected,
  onClick,
  variant = 'value',
  disabled = false,
  // `quiet` : l'état « Mixed / inchangé » de l'édition groupée — texte
  // en `text-3`, jamais sélectionnable visuellement plus fort qu'une valeur
  // réelle.
  tone = 'normal',
}: {
  label: string
  selected: boolean
  onClick: () => void
  variant?: 'value' | 'toggle' | 'group'
  disabled?: boolean
  tone?: 'normal' | 'quiet'
}) {
  const sizeClass =
    variant === 'toggle'
      ? 'px-11 py-6 text-chip-toggle'
      : variant === 'group'
        ? 'px-13 py-8 text-chip-group'
        : 'px-12 py-7 text-chip'

  const stateClass = selected
    ? 'border-border-accent-subtle bg-accent-bg text-accent-text'
    : tone === 'quiet'
      ? 'border-border bg-surface-2 text-text-3'
      : 'border-border bg-surface-2 text-text-2'

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-pill border font-bold ${sizeClass} ${stateClass} disabled:opacity-60`}
    >
      {label}
    </button>
  )
}
