// Puce de statut d'un deck, quatre variantes. `DeckStatus.kind` porte
// quatre valeurs (`built`, `legal`,
// `needsWork`, `noFormat`, `lib/decks/legality.ts`) mais seulement trois
// habillages visuels : `built` et `legal` partagent le même style « ok »
// (vert) — le design validé montre un deck `built` et pleinement légal
// affichant le même libellé « Legal for Modern » qu'un deck `legal`
// non-`built` — seul le
// libellé, calculé par `evaluateDeck`, distingue jamais les deux au-delà de
// la mention `· built` de la ligne parente. Couleurs reprises des rangées
// illustrée/dégradé de l'écran `Deck lists` — voir
// `--color-status-warn-bg`/`--color-status-ok-bg` (app/globals.css) pour la
// raison de ne pas reprendre tels quels les alphas du composant de statut
// d'origine.
import { Check, CircleHelp, TriangleAlert } from 'lucide-react'

import type { DeckStatus } from '@/lib/decks/legality'

const ICON_SIZE = 13
const STROKE_WIDTH = 2

export function StatusChip({ status }: { status: DeckStatus }) {
  // Format sans règles (tout sauf Commander) : rien à dire, pas de puce.
  if (status.kind === 'noRules') return null

  if (status.kind === 'needsWork') {
    return (
      <span className="flex items-center gap-6 rounded-pill bg-status-warn-bg px-9 py-5 text-deck-status font-bold text-warning">
        <TriangleAlert width={ICON_SIZE} height={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
        {status.label}
      </span>
    )
  }

  if (status.kind === 'noFormat') {
    return (
      <span className="flex items-center gap-6 rounded-pill bg-surface-2 px-9 py-5 text-deck-status font-bold text-text-2">
        <CircleHelp width={ICON_SIZE} height={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
        {status.label}
      </span>
    )
  }

  // `built` et `legal`.
  return (
    <span className="flex items-center gap-6 rounded-pill bg-status-ok-bg px-9 py-5 text-deck-status font-bold text-success">
      <Check width={ICON_SIZE} height={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
      {status.label}
    </span>
  )
}
