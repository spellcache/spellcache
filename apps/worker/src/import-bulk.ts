// Pipeline d'import du catalogue Scryfall : lecture de
// `/bulk-data/default_cards`, comparaison de `updated_at`, téléchargement du
// bulk, streaming ligne par ligne (jamais `JSON.parse` du fichier entier),
// `COPY` vers une table de staging, puis `INSERT … ON CONFLICT DO UPDATE` vers
// `sets` et `cards`, et une ligne `card_prices` par carte pour le jour courant.
//
// Exécuté directement par Node (`pnpm import:bulk` → `node
// apps/worker/src/import-bulk.ts`), sans bundler : tous les imports internes portent
// une extension `.ts` explicite (résolution ESM native de Node), jamais
// l'alias `@/`.
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { pathToFileURL } from 'node:url'
import { createGunzip } from 'node:zlib'
import { Pool, type PoolClient } from 'pg'

import { ScryfallClient, ScryfallUnavailableError } from '@spellcache/core/scryfall/client'
import { scryfallCardSchema, type ScryfallCard } from '@spellcache/core/scryfall/schemas'
import { copyRowsToStaging } from './lib/copy-stream.ts'

const SOURCE = 'default_cards'
const BATCH_SIZE = 2000
const SETS_BATCH_SIZE = 500

// Le téléchargement du `.jsonl.gz` reste hors de `ScryfallClient` (son
// contrat n'expose aucune méthode de streaming), mais c'est toujours une
// requête vers l'infrastructure Scryfall : même en-tête `User-Agent` et même
// backoff exponentiel sur 429/5xx qu'un appel du client. Le CDN de bulk ne sert
// qu'un seul fichier par run, donc pas de plafond de débit à faire respecter
// ici.
const DOWNLOAD_USER_AGENT = 'spellcache/1.0'
const DOWNLOAD_MAX_ATTEMPTS = 5
const DOWNLOAD_INITIAL_BACKOFF_MS = 250

function imageUrisOf(card: ScryfallCard): string | null {
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null
  return uris ? JSON.stringify(uris) : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchBulkFile(downloadUri: string): Promise<Response> {
  for (let attempt = 0; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    let response: Response
    try {
      response = await fetch(downloadUri, {
        headers: { 'User-Agent': DOWNLOAD_USER_AGENT },
      })
    } catch (error) {
      if (attempt === DOWNLOAD_MAX_ATTEMPTS) {
        throw new ScryfallUnavailableError(
          `Bulk download unreachable: ${(error as Error).message}`,
        )
      }
      await sleep(DOWNLOAD_INITIAL_BACKOFF_MS * 2 ** attempt)
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === DOWNLOAD_MAX_ATTEMPTS) return response
      const retryAfter = Number(response.headers.get('retry-after'))
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : DOWNLOAD_INITIAL_BACKOFF_MS * 2 ** attempt
      await sleep(delay)
      continue
    }

    return response
  }
  throw new ScryfallUnavailableError('Bulk download unreachable')
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export type ImportBulkResult = {
  skipped: boolean
  bulkUpdatedAt: Date
  rowsUpserted: number
  pricesInserted: number
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

// Un élément par ligne de bulk pretty-imprimé par Scryfall (`[` d'ouverture,
// une carte compacte par ligne suivie d'une virgule, `]` de fermeture) — on
// dépouille ces artefacts plutôt que d'exiger du NDJSON strict.
function extractJsonFromLine(rawLine: string): string | null {
  let line = rawLine.trim()
  if (line.length === 0 || line === '[' || line === ']') return null
  if (line.startsWith('[')) line = line.slice(1)
  if (line.endsWith(',')) line = line.slice(0, -1)
  if (line.endsWith(']')) line = line.slice(0, -1)
  line = line.trim()
  return line.length > 0 ? line : null
}

// Littéral de tableau Postgres (`{a,b}`) pour les colonnes `text[]` de la
// table de staging — chaque élément est guillemeté par prudence.
function pgArrayLiteral(values: string[]): string {
  const items = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return `{${items.join(',')}}`
}

function cardToStagingRow(card: ScryfallCard): Array<string | null> {
  return [
    card.id,
    card.oracle_id,
    card.name,
    card.set,
    card.set_name ?? null,
    card.set_type ?? null,
    card.layout ?? null,
    card.released_at ?? null,
    card.collector_number,
    card.rarity,
    card.mana_cost ?? null,
    String(card.cmc),
    card.type_line,
    card.oracle_text ?? null,
    pgArrayLiteral(card.colors),
    pgArrayLiteral(card.color_identity),
    pgArrayLiteral(card.finishes),
    // Repli sur la première face : c'est celle qu'on montre partout (la
    // vignette d'une ligne, le fond d'un binder), et la seule que le modèle
    // sache adresser — `image_uris` est un objet par carte, pas par face.
    imageUrisOf(card),
    JSON.stringify(card.legalities),
    card.artist ?? null,
    card.prices?.usd ?? null,
    card.prices?.usd_foil ?? null,
    card.prices?.eur ?? null,
    card.prices?.eur_foil ?? null,
  ]
}

// `https → gunzip → readline` : le fichier décompressé dépasse le
// gigaoctet, jamais bufferisé en entier.
async function* streamBulkRows(
  downloadUri: string,
): AsyncGenerator<Array<string | null>> {
  const response = await fetchBulkFile(downloadUri)
  if (!response.ok || !response.body) {
    throw new ScryfallUnavailableError(`Bulk download failed: HTTP ${response.status}`)
  }

  const nodeStream = Readable.fromWeb(response.body as unknown as NodeWebReadableStream)
  const rl = createInterface({
    input: nodeStream.pipe(createGunzip()),
    crlfDelay: Infinity,
  })

  for await (const rawLine of rl) {
    const json = extractJsonFromLine(rawLine)
    if (!json) continue

    let card: ScryfallCard
    try {
      card = scryfallCardSchema.parse(JSON.parse(json))
    } catch (error) {
      console.warn(`[import-bulk] skipping malformed line: ${(error as Error).message}`)
      continue
    }
    yield cardToStagingRow(card)
  }
}

// Icônes officielles de `GET /sets`, par code de set. Vide si l'appel a
// échoué : l'import n'en dépend pas, les icônes déjà stockées sont conservées.
type SetIconIndex = ReadonlyMap<string, string>

async function fetchSetIconIndex(client: ScryfallClient): Promise<SetIconIndex> {
  try {
    const sets = await client.listSets()
    return new Map(sets.map((set) => [set.code, set.icon_svg_uri]))
  } catch (error) {
    console.warn(
      `[import-bulk] GET /sets failed, keeping previously stored set icons: ${(error as Error).message}`,
    )
    return new Map()
  }
}

async function runImport(
  conn: PoolClient,
  downloadUri: string,
  setIcons: SetIconIndex,
): Promise<{ rowsUpserted: number; pricesInserted: number }> {
  await conn.query('DROP TABLE IF EXISTS staging_cards')
  await conn.query(`
    CREATE TEMP TABLE staging_cards (
      id uuid,
      oracle_id uuid,
      name text,
      set_code text,
      set_name text,
      set_type text,
      layout text,
      released_at date,
      collector_number text,
      rarity text,
      mana_cost text,
      cmc numeric,
      type_line text,
      oracle_text text,
      colors text[],
      color_identity text[],
      finishes text[],
      image_uris jsonb,
      legalities jsonb,
      artist text,
      usd numeric,
      usd_foil numeric,
      eur numeric,
      eur_foil numeric
    )
  `)

  const copySql = `COPY staging_cards (
    id, oracle_id, name, set_code, set_name, set_type, layout, released_at, collector_number, rarity,
    mana_cost, cmc, type_line, oracle_text, colors, color_identity, finishes,
    image_uris, legalities, artist, usd, usd_foil, eur, eur_foil
  ) FROM STDIN WITH (FORMAT csv)`

  const streamedCount = await copyRowsToStaging(
    conn,
    copySql,
    streamBulkRows(downloadUri),
  )

  // Vérifier le compte de lignes de staging avant l'upsert.
  const { rows: countRows } = await conn.query<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM staging_cards',
  )
  const stagingCount = Number(countRows[0]?.count ?? 0)
  if (stagingCount !== streamedCount) {
    throw new Error(
      `staging row count mismatch: streamed ${streamedCount}, staged ${stagingCount}`,
    )
  }

  await conn.query('CREATE INDEX ON staging_cards (id)')

  // `sets` avant `cards` (contrainte de clé étrangère `cards.set_code`). Le
  // bulk `default_cards` ne porte pas l'icône de set : elle vient de
  // `GET /sets` (`setIcons`), dont l'URI porte un cache-buster
  // (`frc.svg?1788148800`) sans lequel le CDN de Scryfall répond 404 pour les
  // sets récents — et qui règle aussi les sets dont l'icône n'est ni leur
  // code ni celui du parent. Aucune URL n'est jamais composée à la main : si
  // l'appel a échoué ou si un set manque à la liste, l'icône déjà stockée est
  // conservée (`coalesce` ci-dessous), sinon elle reste `null` et l'interface
  // n'affiche rien.
  const { rows: setRows } = await conn.query<{
    set_code: string
    name: string
    set_type: string | null
    released_at: string | null
    card_count: number
  }>(`
    SELECT
      set_code,
      max(set_name) AS name,
      max(set_type) AS set_type,
      min(released_at) AS released_at,
      count(*)::int AS card_count
    FROM staging_cards
    GROUP BY set_code
  `)

  for (const batch of chunk(setRows, SETS_BATCH_SIZE)) {
    const values: unknown[] = []
    const placeholders = batch.map((row, i) => {
      const base = i * 6
      values.push(
        row.set_code,
        row.name,
        row.set_type,
        row.released_at,
        setIcons.get(row.set_code) ?? null,
        row.card_count,
      )
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
    })

    await conn.query(
      `
      INSERT INTO sets (code, name, set_type, released_at, icon_svg_uri, card_count)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (code) DO UPDATE SET
        name = excluded.name,
        set_type = excluded.set_type,
        released_at = excluded.released_at,
        icon_svg_uri = coalesce(excluded.icon_svg_uri, sets.icon_svg_uri),
        card_count = excluded.card_count
      `,
      values,
    )
  }

  // Upsert de `cards` par lots en transactions courtes : l'app reste servie
  // pendant l'import, jamais un TRUNCATE + rechargement complet.
  let rowsUpserted = 0
  let lastId: string | null = null
  for (;;) {
    const batchResult: { rows: { id: string }[] } = lastId
      ? await conn.query<{ id: string }>(
          'SELECT id FROM staging_cards WHERE id > $1 ORDER BY id LIMIT $2',
          [lastId, BATCH_SIZE],
        )
      : await conn.query<{ id: string }>(
          'SELECT id FROM staging_cards ORDER BY id LIMIT $1',
          [BATCH_SIZE],
        )
    const batchRows = batchResult.rows
    if (batchRows.length === 0) break

    const firstId = batchRows[0]!.id
    const nextLastId = batchRows[batchRows.length - 1]!.id

    const result = await conn.query(
      `
      INSERT INTO cards (
        id, oracle_id, name, set_code, collector_number, rarity, mana_cost, cmc,
        type_line, oracle_text, colors, color_identity, finishes, image_uris,
        legalities, artist, layout
      )
      SELECT
        id, oracle_id, name, set_code, collector_number, rarity, mana_cost, cmc,
        type_line, oracle_text, colors, color_identity, finishes, image_uris,
        legalities, artist, layout
      FROM staging_cards
      WHERE id >= $1 AND id <= $2
      ON CONFLICT (id) DO UPDATE SET
        oracle_id = excluded.oracle_id,
        name = excluded.name,
        set_code = excluded.set_code,
        collector_number = excluded.collector_number,
        rarity = excluded.rarity,
        mana_cost = excluded.mana_cost,
        cmc = excluded.cmc,
        type_line = excluded.type_line,
        oracle_text = excluded.oracle_text,
        colors = excluded.colors,
        color_identity = excluded.color_identity,
        finishes = excluded.finishes,
        image_uris = excluded.image_uris,
        legalities = excluded.legalities,
        artist = excluded.artist,
        layout = excluded.layout
      `,
      [firstId, nextLastId],
    )
    rowsUpserted += result.rowCount ?? 0
    lastId = nextLastId
  }

  // Une ligne par carte et par jour — jamais quand les quatre prix sont nuls.
  const pricesResult = await conn.query(`
    INSERT INTO card_prices (card_id, day, eur, eur_foil, usd, usd_foil)
    SELECT id, CURRENT_DATE, eur, eur_foil, usd, usd_foil
    FROM staging_cards
    WHERE eur IS NOT NULL OR eur_foil IS NOT NULL OR usd IS NOT NULL OR usd_foil IS NOT NULL
    ON CONFLICT (card_id, day) DO UPDATE SET
      eur = excluded.eur,
      eur_foil = excluded.eur_foil,
      usd = excluded.usd,
      usd_foil = excluded.usd_foil
  `)

  await conn.query('DROP TABLE IF EXISTS staging_cards')

  return { rowsUpserted, pricesInserted: pricesResult.rowCount ?? 0 }
}

export async function importBulk(opts?: { force?: boolean }): Promise<ImportBulkResult> {
  const client = new ScryfallClient()
  // `-c TimeZone=UTC` :
  // `CURRENT_DATE` ci-dessous, utilisée pour écrire une ligne `card_prices`
  // par jour, dépend sinon du fuseau de session Postgres — qui peut différer
  // de l'UTC dont dépend `toDayString()` côté worker
  // (`apps/worker/src/jobs/revalue-containers.ts`). Sans cette option, un serveur en
  // fuseau non-UTC pourrait dater cette ligne un jour plus tôt ou plus tard
  // que le jour de référence résolu par la revalorisation nocturne, près de
  // minuit.
  const pool = new Pool({ connectionString: requireDatabaseUrl(), options: '-c TimeZone=UTC' })

  try {
    const entry = await client.getBulkDataEntry('default_cards')

    const { rows: lastRuns } = await pool.query<{ bulk_updated_at: Date }>(
      `SELECT bulk_updated_at FROM import_runs
       WHERE source = $1 AND status = 'success'
       ORDER BY started_at DESC LIMIT 1`,
      [SOURCE],
    )
    const lastBulkUpdatedAt = lastRuns[0]?.bulk_updated_at ?? null

    if (!opts?.force && lastBulkUpdatedAt && lastBulkUpdatedAt >= entry.updatedAt) {
      console.log(
        `[import-bulk] skipped — bulk updated_at (${entry.updatedAt.toISOString()}) is not ` +
          `newer than the last successful import (${lastBulkUpdatedAt.toISOString()})`,
      )
      return {
        skipped: true,
        bulkUpdatedAt: entry.updatedAt,
        rowsUpserted: 0,
        pricesInserted: 0,
      }
    }

    // Après le test de skip : pas d'appel `/sets` pour un import qui ne fera rien.
    const setIcons = await fetchSetIconIndex(client)

    const conn = await pool.connect()
    const startedAt = new Date()
    try {
      const { rowsUpserted, pricesInserted } = await runImport(
        conn,
        entry.downloadUri,
        setIcons,
      )
      await conn.query(
        `INSERT INTO import_runs (source, bulk_updated_at, started_at, finished_at, rows_upserted, status)
         VALUES ($1, $2, $3, now(), $4, 'success')`,
        [SOURCE, entry.updatedAt, startedAt, rowsUpserted],
      )
      return {
        skipped: false,
        bulkUpdatedAt: entry.updatedAt,
        rowsUpserted,
        pricesInserted,
      }
    } catch (error) {
      await conn.query(
        `INSERT INTO import_runs (source, bulk_updated_at, started_at, finished_at, rows_upserted, status)
         VALUES ($1, $2, $3, now(), 0, 'error')`,
        [SOURCE, entry.updatedAt, startedAt],
      )
      throw error
    } finally {
      conn.release()
    }
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `--force` : rejoue l'import même si le bulk n'a pas bougé depuis la
  // dernière réussite. C'est ce qu'il faut après un changement de *notre*
  // côté (une colonne qu'on ne lisait pas, un champ renommé chez Scryfall) —
  // le fichier distant est identique, ce qu'on en extrait ne l'est plus.
  importBulk({ force: process.argv.includes('--force') })
    .then((result) => {
      console.log('[import-bulk] done', result)
      process.exit(result.skipped ? 0 : 0)
    })
    .catch((error) => {
      console.error('[import-bulk] failed', error)
      process.exit(1)
    })
}
