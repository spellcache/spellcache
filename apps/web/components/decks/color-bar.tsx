// Composant `ColorBar` du design — une barre de la barre d'identité colorée
// de l'écran `Planning deck`, posée sous le bandeau de couverture.
//
// Le remplissage et le libellé n'ont pas de valeur d'exemple concrète dans le
// design : ce composant les résout lui-même depuis la seule correspondance WUBRG déjà
// établie par le projet (`gradientKeyForIdentity`, `lib/decks/identity.ts` —
// W → gold, U → blue, B → purple, R → red, G → green, déjà utilisée par
// `DeckRow`) plutôt que d'inventer une seconde palette de couleurs de
// mana.
import type { GradientKey } from '@/lib/binders/gradients'
import { BINDER_GRADIENTS } from '@/lib/binders/gradients'
import { gradientKeyForIdentity } from '@/lib/decks/identity'

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

const COLOR_LABELS: Record<ManaColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

function fillFor(color: ManaColor): string {
  // `C` : les incolores n'ont pas de clé de dégradé d'identité — le neutre
  // `slate` de la palette des pips.
  const key: GradientKey = color === 'C' ? 'grey' : gradientKeyForIdentity([color])
  return BINDER_GRADIENTS[key]
}

export function ColorBar({ color, count, pct }: { color: ManaColor; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/ */}
      <img src={`/mana/${color}.svg`} width={20} height={20} alt="" className="flex-shrink-0" />
      <span className="w-color-bar-label flex-shrink-0 text-identity-bar-label text-text-2">{COLOR_LABELS[color]}</span>
      <div className="h-bar-track flex-1 overflow-hidden rounded-bar bg-bar-track-bg">
        <div className="h-full rounded-bar" style={{ width: `${pct}%`, backgroundImage: fillFor(color) }} />
      </div>
      <span className="w-bar-count flex-shrink-0 text-right text-identity-bar-label text-text">{count}</span>
    </div>
  )
}
