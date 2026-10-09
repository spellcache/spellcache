'use client'

// Segmenté générique, partagé par plusieurs écrans. Ne porte aucune marge
// externe : la mise en page (espacement autour) revient à
// l'écran qui l'utilise, pas à ce composant partagé.
//
// `size="compact"` (segmenté `None | Colour | Card art` de la feuille
// `Binder look`) reprend le même gabarit à un pixel différent (conteneur
// `padding:3px;border-radius:12px`, segment `border-radius:9px;
// font-size:12.5px;font-weight:700`) — un second jeu de tokens
// (`--radius-control-compact`/`--radius-segment-compact`/
// `--text-segment-compact`, app/globals.css), jamais les valeurs par défaut
// (14/11px) réutilisées à l'approximation près (le design validé prime pour
// les valeurs de pixel).
//
// `size="drawer"` (segmenté de zone `Main | Side | Cmdr` du tiroir d'ajout
// persistant) reprend le conteneur/rayon de segment `default` (mêmes
// 14px/11px) mais un padding vertical et une police propres
// (`padding:8px 0;font-size:12.5px;font-weight:700`, pas `py-9`/`text-body`/
// `font-semibold`) — troisième jeu de tokens plutôt qu'une approximation.
export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'default',
}: {
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  size?: 'default' | 'compact' | 'drawer'
}) {
  const containerClass =
    size === 'compact'
      ? 'flex gap-3 rounded-control-compact bg-surface-2 p-3'
      : 'flex gap-4 rounded-control bg-surface-2 p-4'
  const segmentClass =
    size === 'compact'
      ? 'flex-1 rounded-segment-compact py-9 text-segment-compact font-bold'
      : size === 'drawer'
        ? 'flex-1 rounded-segment py-8 text-segment-drawer font-bold'
        : 'flex-1 rounded-segment py-9 text-body font-semibold'

  return (
    <div className={containerClass}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`${segmentClass} ${active ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
