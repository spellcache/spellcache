// Pastille de dégradé de la feuille `Binder look`, au pixel du design validé :
// 52×52, rayon 16, et l'anneau double
// `0 0 0 2px #181b22, 0 0 0 4px #3d7bff` sur la pastille sélectionnée — posé
// via `box-shadow` en style inline (une composition à deux couches, hors du
// namespace `--shadow-*` de `@theme`, même patron que `binderRowBackground`
// consommé en `style={{ backgroundImage }}` par `binder-row.tsx`), pas
// une classe Tailwind arbitraire (`shadow-[...]`, interdite par docs/development.md).
import { BINDER_GRADIENTS, type GradientKey } from '@/lib/binders/gradients'

// Reprend `--color-surface-3`/`--color-accent` (app/globals.css) — recopiés
// ici en constantes de style inline plutôt qu'en littéraux d'un second
// fichier : `gradient-swatch.tsx` ne porte aucune valeur hex propre, ces deux
// teintes existent déjà comme tokens ailleurs dans le thème.
const SELECTED_RING_SHADOW = '0 0 0 2px var(--color-surface-3), 0 0 0 4px var(--color-accent)'

export function GradientSwatch({
  gradientKey,
  selected,
  onSelect,
}: {
  gradientKey: GradientKey
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-label={gradientKey}
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        backgroundImage: BINDER_GRADIENTS[gradientKey],
        boxShadow: selected ? SELECTED_RING_SHADOW : undefined,
      }}
      className="h-swatch w-swatch flex-shrink-0 rounded-swatch"
    />
  )
}
