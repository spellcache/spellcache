// Sélection du jour de comparaison J-7, rattrapage compris. Fonction pure —
// aucune base nécessaire, contraste volontaire avec le reste de cette feature
// qui dépend de Postgres : c'est le point exact où un bug de date/fuseau
// horaire (le piège spécifique de cette feature) est démontrable sans
// dépendre de Docker.
import { describe, expect, it } from 'vitest'

import { pickComparisonDay } from '../../src/jobs/revalue-containers.ts'

describe('apps/worker/src/jobs/revalue-containers — pickComparisonDay', () => {
  it('picks the exact J-7 day when it is available', () => {
    const referenceDay = '2024-01-08'
    const available = ['2024-01-08', '2024-01-07', '2024-01-01']

    expect(pickComparisonDay(referenceDay, available)).toBe('2024-01-01')
  })

  it('falls back to J-6 when the exact J-7 day is missing', () => {
    const referenceDay = '2024-01-08'
    // J-7 = 2024-01-01, absent ; J-6 = 2024-01-02, présent.
    const available = ['2024-01-08', '2024-01-02']

    expect(pickComparisonDay(referenceDay, available)).toBe('2024-01-02')
  })

  it('returns null when only a 3-day history exists, far outside the tolerance window', () => {
    const referenceDay = '2024-01-08'
    const available = ['2024-01-08', '2024-01-07', '2024-01-06']

    expect(pickComparisonDay(referenceDay, available)).toBeNull()
  })

  it('never picks a day on or after referenceDay', () => {
    const referenceDay = '2024-01-08'
    const available = ['2024-01-08', '2024-01-09']

    expect(pickComparisonDay(referenceDay, available)).toBeNull()
  })

  it('prefers the closest day when two candidates are within tolerance', () => {
    const referenceDay = '2024-01-10'
    // Cible J-7 = 2024-01-03. Candidats à égale distance seraient 01-02 et
    // 01-04 ; ici 01-04 est strictement plus proche.
    const available = ['2024-01-10', '2024-01-05', '2024-01-04']

    expect(pickComparisonDay(referenceDay, available)).toBe('2024-01-04')
  })
})
