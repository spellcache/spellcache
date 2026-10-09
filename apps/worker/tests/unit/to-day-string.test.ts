// `toDayString` — dates et fuseaux horaires, le piège spécifique de cette
// feature. Fonction pure, testable sans base de données : c'est le point
// exact où un bug de fuseau horaire est démontrable en fonction pure,
// contrairement à la comparaison Postgres `CURRENT_DATE` (session Postgres)
// faite par `apps/worker/src/import-bulk.ts`, hors de portée d'un test
// unitaire.
import { afterEach, describe, expect, it } from 'vitest'

import { toDayString } from '../../src/jobs/revalue-containers.ts'

describe('apps/worker/src/jobs/revalue-containers — toDayString', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('always resolves the UTC calendar day, never the local one', () => {
    // UTC+14 : le calendrier local déborde déjà sur le lendemain alors que
    // le jour UTC reste la veille — une régression vers
    // `getFullYear()`/`getMonth()`/`getDate()` (qui lisent le fuseau local
    // du process) ferait échouer cette assertion.
    process.env.TZ = 'Pacific/Kiritimati'
    const date = new Date('2024-01-08T23:30:00Z')

    expect(toDayString(date)).toBe('2024-01-08')
  })

  it('stays on the earlier UTC day near a negative-offset midnight too', () => {
    // UTC-11 : le calendrier local est encore la veille alors que le jour
    // UTC est déjà passé au lendemain.
    process.env.TZ = 'Pacific/Midway'
    const date = new Date('2024-01-09T00:15:00Z')

    expect(toDayString(date)).toBe('2024-01-09')
  })
})
