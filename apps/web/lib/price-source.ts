// Dérivation pure de `priceSource` : Currency et Price source dérivent tous
// deux de `priceSource` par `currencyOf` et `marketLabelOf`. Séparé de
// `lib/preferences.ts` — celui-ci importe `packages/db/src/client.ts` (`pg`),
// ce qui casserait le bundle navigateur si
// `components/settings/preference-controls.tsx` (`'use client'`) l'importait
// pour ces deux fonctions pures (piège vérifié par `pnpm build`). Réexporté tel
// quel par `lib/preferences.ts`, qui reste le point d'import attendu.
import type { Preferences } from '@/lib/preferences'

export function currencyOf(p: Pick<Preferences, 'priceSource'>): 'usd' | 'eur' {
  return p.priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

export function marketLabelOf(
  p: Pick<Preferences, 'priceSource'>,
): 'TCGplayer market' | 'Cardmarket trend' {
  return p.priceSource === 'tcgplayer_usd' ? 'TCGplayer market' : 'Cardmarket trend'
}
