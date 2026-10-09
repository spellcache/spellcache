// Test d'intégration : importe l'échantillon
// de 200 cartes (apps/worker/tests/fixtures/scryfall-bulk-sample.jsonl) contre la base
// éphémère `postgres-test` (voir packages/db/testing/global-setup.ts). Se saute
// lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible).
//
// `fetch` est stubbé pour servir la réponse `/bulk-data/default_cards` et le
// fichier gzippé lui-même — aucun appel réseau réel vers Scryfall.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { importBulk } from '../../src/import-bulk.ts'

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/scryfall-bulk-sample.jsonl')
const BULK_UPDATED_AT = '2024-01-01T00:00:00Z'
const DOWNLOAD_URI = 'https://data.scryfall.io/fixtures/default-cards-sample.jsonl.gz'
const WOE_ICON_URI = 'https://svgs.scryfall.io/sets/woe.svg?1700000000'

describe.skipIf(!process.env.TEST_DATABASE_URL)('worker/import-bulk', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  let pool: Pool

  beforeAll(() => {
    // importBulk() lit DATABASE_URL — on le pointe vers la base éphémère de test.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
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
        // `GET /sets` : seul `woe` est listé — `otj`, `mkm` et `blb` (aussi
        // dans l'échantillon) restent sans icône.
        if (url === 'https://api.scryfall.com/sets') {
          return new Response(
            JSON.stringify({
              object: 'list',
              has_more: false,
              data: [{ code: 'woe', icon_svg_uri: WOE_ICON_URI, parent_set_code: null }],
            }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected fetch in test: ${url}`)
      }),
    )
  }

  it('imports the 200-card sample and upserts without duplicating on a second pass', async () => {
    stubFetch()

    const first = await importBulk()
    expect(first.skipped).toBe(false)
    expect(first.rowsUpserted).toBe(200)

    const { rows: cardRows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM cards',
    )
    expect(cardRows[0]?.count).toBe(200)

    const { rows: priceRows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM card_prices WHERE day = CURRENT_DATE',
    )
    expect(priceRows[0]?.count).toBe(200)

    const { rows: runRows } = await pool.query<{ status: string; rows_upserted: number }>(
      "SELECT status, rows_upserted FROM import_runs WHERE status = 'success'",
    )
    expect(runRows).toHaveLength(1)
    expect(runRows[0]?.rows_upserted).toBe(200)

    // L'icône vient de `GET /sets` quand le set y figure (cache-buster
    // conservé) ; aucune URL composée sinon.
    const { rows: setRows } = await pool.query<{ code: string; icon_svg_uri: string | null }>(
      "SELECT code, icon_svg_uri FROM sets WHERE code IN ('woe', 'otj') ORDER BY code",
    )
    expect(setRows).toEqual([
      { code: 'otj', icon_svg_uri: null },
      { code: 'woe', icon_svg_uri: WOE_ICON_URI },
    ])

    // Second passage, forcé pour contourner le skip sur updated_at inchangé —
    // vérifie l'upsert (pas de doublon) sur le même fichier.
    stubFetch()
    const second = await importBulk({ force: true })
    expect(second.skipped).toBe(false)
    expect(second.rowsUpserted).toBe(200)

    const { rows: cardRowsAfter } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM cards',
    )
    expect(cardRowsAfter[0]?.count).toBe(200)
  })

  it('skips when the bulk updated_at is not newer than the last successful import', async () => {
    stubFetch()
    await importBulk()

    stubFetch()
    const result = await importBulk()

    expect(result.skipped).toBe(true)
    expect(result.rowsUpserted).toBe(0)

    const { rows: cardRows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM cards',
    )
    expect(cardRows[0]?.count).toBe(200)
  })
})
