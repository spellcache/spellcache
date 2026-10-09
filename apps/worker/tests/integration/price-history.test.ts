// Test d'intégration : `card_prices` porte bien une ligne par carte et par
// jour — la réexécution du même jour met à jour plutôt que de dupliquer
// (contrat hérité de l'import bulk, `apps/worker/src/import-bulk.ts`, exercé
// ici via `importBulk()`), et des jours distincts coexistent comme des
// lignes séparées — c'est
// cette coexistence que `revalueAllContainers()` lit pour J et J-7. Contre
// la base éphémère `postgres-test` (voir packages/db/testing/global-setup.ts)
// ; se saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/scryfall-bulk-sample.jsonl')
const BULK_UPDATED_AT = '2024-01-01T00:00:00Z'
const DOWNLOAD_URI = 'https://data.scryfall.io/fixtures/price-history-sample.jsonl.gz'

describe.skipIf(!process.env.TEST_DATABASE_URL)('card_prices history', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let importBulk: typeof import('../../src/import-bulk.ts').importBulk

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ importBulk } = await import('../../src/import-bulk.ts'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await pool.query('TRUNCATE card_prices, cards, sets, import_runs CASCADE')
  })

  function stubFetch(): void {
    const gz = gzipSync(readFileSync(FIXTURE_PATH))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === 'https://api.scryfall.com/bulk-data/default_cards') {
          return new Response(
            JSON.stringify({
              object: 'bulk_data',
              id: 'fixture-bulk',
              type: 'default_cards',
              updated_at: BULK_UPDATED_AT,
              download_uri: DOWNLOAD_URI,
              size: gz.byteLength,
            }),
            { status: 200 },
          )
        }
        if (url === DOWNLOAD_URI) {
          return new Response(new Uint8Array(gz), { status: 200 })
        }
        // `GET /sets` (icônes de set, lu à chaque import) : une liste vide
        // suffit, les icônes ne sont pas l'objet de ce fichier. Sans réponse,
        // le client Scryfall réessayait avec backoff au-delà du délai du test.
        if (url === 'https://api.scryfall.com/sets') {
          return new Response(JSON.stringify({ object: 'list', has_more: false, data: [] }), {
            status: 200,
          })
        }
        throw new Error(`unexpected fetch in test: ${url}`)
      }),
    )
  }

  it('writes exactly one card_prices row per card for the day, updated (not duplicated) on a same-day rerun', async () => {
    stubFetch()
    await importBulk()

    const { rows: firstPass } = await pool.query<{ card_id: string; usd: string | null; count: string }>(
      `SELECT card_id::text, usd, count(*)::text AS count FROM card_prices WHERE day = CURRENT_DATE GROUP BY card_id, usd`,
    )
    expect(firstPass.length).toBeGreaterThan(0)
    for (const row of firstPass) {
      expect(row.count).toBe('1')
    }

    const [{ card_id: sampleCardId, usd: originalUsd }] = firstPass
    expect(sampleCardId).toBeDefined()

    // Sentinelle écrite directement en base (changer le prix depuis la
    // fixture demanderait un second fichier de staging) : si le second
    // import ne faisait qu'un `INSERT` sans `ON CONFLICT DO UPDATE`, il
    // échouerait sur la clé primaire `(card_id, day)` plutôt que d'écraser
    // cette valeur — la preuve qu'il l'écrase bien, pas seulement que le
    // nombre de lignes reste stable.
    await pool.query(`UPDATE card_prices SET usd = '999.99' WHERE card_id = $1 AND day = CURRENT_DATE`, [
      sampleCardId,
    ])
    const { rows: sentinelRows } = await pool.query<{ usd: string }>(
      `SELECT usd FROM card_prices WHERE card_id = $1 AND day = CURRENT_DATE`,
      [sampleCardId],
    )
    expect(sentinelRows[0]?.usd).toBe('999.99')

    // Réexécuter le même import (forcé pour contourner le skip sur
    // `updated_at` inchangé) doit à la fois laisser une seule ligne pour ce
    // jour et restaurer la valeur du second passage — l'upsert écrase la
    // sentinelle, il ne l'ignore pas.
    stubFetch()
    await importBulk({ force: true })

    const { rows: secondPass } = await pool.query<{ count: string; usd: string | null }>(
      `SELECT count(*)::text AS count, usd FROM card_prices WHERE day = CURRENT_DATE AND card_id = $1 GROUP BY usd`,
      [sampleCardId],
    )
    expect(secondPass[0]?.count).toBe('1')
    expect(secondPass[0]?.usd).not.toBe('999.99')
    expect(secondPass[0]?.usd).toBe(originalUsd)

    const { rows: totalRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM card_prices WHERE day = CURRENT_DATE`,
    )
    expect(Number(totalRows[0]?.count)).toBe(firstPass.length)
  })

  it('keeps distinct days as separate rows under the same (card_id, day) primary key, never merging them', async () => {
    stubFetch()
    await importBulk()

    const { rows: cardRows } = await pool.query<{ id: string }>('SELECT id::text FROM cards LIMIT 1')
    const cardId = cardRows[0]?.id
    expect(cardId).toBeDefined()

    // Un jour synthétique antérieur, distinct de `CURRENT_DATE` posé par
    // l'import — la variation à 7 jours de `revalueAllContainers()` dépend
    // de cette coexistence (J et J-7 comme deux lignes séparées, pas une
    // ligne réécrite).
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
       VALUES ($1, CURRENT_DATE - 7, '1.00', '2.00', '0.90', '1.80')`,
      [cardId],
    )

    const { rows } = await pool.query<{ day: string }>(
      `SELECT day::text FROM card_prices WHERE card_id = $1 ORDER BY day`,
      [cardId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.day).not.toBe(rows[1]?.day)

    // Réimporter le même jour ne doit toujours affecter que la ligne de ce
    // jour, jamais celle vieille de sept jours (aucune écriture ne porte sur
    // `day <> CURRENT_DATE`).
    stubFetch()
    await importBulk({ force: true })

    const { rows: afterRerun } = await pool.query<{ day: string; usd: string }>(
      `SELECT day::text, usd FROM card_prices WHERE card_id = $1 AND day = CURRENT_DATE - 7`,
      [cardId],
    )
    expect(afterRerun).toHaveLength(1)
    expect(afterRerun[0]?.usd).toBe('1.00')
  })
})
