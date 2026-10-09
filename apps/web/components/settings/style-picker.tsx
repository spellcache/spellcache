'use client'

// Sélecteur à deux vignettes (bloc `Collection home` de Settings). Réutilisé
// tel quel pour la ligne `Decks home`, cloné sur le sélecteur `Collection
// home` existant — donc la même icône, la même mise en forme, seuls `label`,
// `hint`, `value` et `onChange` varient d'un appel à l'autre (balisage
// identique au libellé et à la valeur près). Le contrat ne porte pas d'icône :
// elle est donc fixe, pas paramétrable par l'appelant.
//
// Couleurs des deux états, valeurs du design validé
// (`pickCompactBorder`/`pickCompactBg`/`pickShelvesBorder`/
// `pickShelvesBg`) : sélectionné = bordure `#3d7bff` pleine (`border-accent`,
// pas `border-border-accent` qui est un alpha 0.55 réservé à un autre rôle)
// et fond `#161d2e` (`bg-accent-bg`) ; non sélectionné = bordure
// `rgba(255,255,255,0.07)` (`border-border-style-picker`, distincte de
// `border-border` à 0.05) et fond `#141821` (`bg-surface-2`).
//
// Groupe de deux boutons radio accessibles (`role="radiogroup"`) : ce n'est
// pas un `<select>`, le clavier et les lecteurs d'écran
// doivent pouvoir le piloter comme n'importe quel groupe de radios.
import { LayoutDashboard } from 'lucide-react'

type StyleValue = 'compact' | 'shelves'

// Vignettes uniformes (Compact = 4 barres identiques h9 ; Shelves = 2×3
// tuiles identiques h22) : des paliers accent/muted laisseraient croire
// qu'une rangée ou une tuile porte un sens (sélection, art manquant) que la
// vignette n'a pas — c'est un aperçu de forme, pas de contenu, les
// quatre/six blocs sont donc rendus dans la même teinte
// (`--color-style-preview-uniform`).
function CompactPreview() {
  return (
    <div className="mb-9 flex flex-col gap-4">
      <div className="h-style-preview-bar rounded-style-preview bg-style-preview-uniform" />
      <div className="h-style-preview-bar rounded-style-preview bg-style-preview-uniform" />
      <div className="h-style-preview-bar rounded-style-preview bg-style-preview-uniform" />
      <div className="h-style-preview-bar rounded-style-preview bg-style-preview-uniform" />
    </div>
  )
}

function ShelvesPreview() {
  return (
    <div className="mb-9 flex flex-col gap-7">
      <div className="flex gap-3">
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
      </div>
      <div className="flex gap-3">
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
        <div className="h-style-preview-tile w-style-preview-tile rounded-style-preview bg-style-preview-uniform" />
      </div>
    </div>
  )
}

const OPTIONS: Array<{ value: StyleValue; text: string; Preview: () => React.ReactElement }> = [
  { value: 'compact', text: 'Compact', Preview: CompactPreview },
  { value: 'shelves', text: 'Shelves', Preview: ShelvesPreview },
]

export function StylePicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: StyleValue
  onChange: (v: StyleValue) => void
}) {
  return (
    <div className="px-14 pb-4 pt-14">
      <div className="mb-12 flex items-center gap-12">
        <span className="flex h-row-icon w-row-icon flex-shrink-0 items-center justify-center rounded-row-icon text-text-2">
          <LayoutDashboard width={18} height={18} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-row-label font-semibold text-text">{label}</span>
          <span className="mt-2 block text-row-subtitle text-text-2">{hint}</span>
        </span>
      </div>
      <div role="radiogroup" aria-label={label} className="flex gap-10 pb-14">
        {OPTIONS.map(({ value: optionValue, text, Preview }) => {
          const active = optionValue === value
          return (
            <button
              key={optionValue}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(optionValue)}
              className={`min-w-0 flex-1 rounded-control border-thin p-10 text-left ${
                active ? 'border-accent bg-accent-bg' : 'border-border-style-picker bg-surface-2'
              }`}
            >
              <Preview />
              <span className="flex items-center gap-6">
                <span
                  className={`h-style-dot w-style-dot flex-shrink-0 rounded-full border-thin ${
                    active ? 'border-accent bg-accent' : 'border-text-3 bg-transparent'
                  }`}
                />
                <span
                  className={`text-segment-compact font-bold ${active ? 'text-text' : 'text-text-2'}`}
                >
                  {text}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
