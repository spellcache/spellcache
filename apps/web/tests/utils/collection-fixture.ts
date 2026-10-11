// Montage commun des tests d'intégration de la collection : comptes,
// catalogue minimal, prix, et agrégats indépendants recalculés directement
// sur `holdings` pour vérifier ce que l'app lit dans `container_stats`.
//
// Les modules de l'app sont importés dynamiquement par l'appelant, après la
// réécriture de `DATABASE_URL` (même contrainte que les autres tests
// d'intégration) : ce fichier ne touche qu'au `Pool` qu'on lui passe.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export const TRUNCATE_ALL =
  'TRUNCATE import_lists, deck_folders, holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE'

export interface CardFixture {
  name: string
  // Deux impressions d'une même carte partagent leur `oracle_id`.
  oracleId?: string
  setCode?: string
  collectorNumber?: string
  priceEur?: number
  priceEurFoil?: number
  finishes?: string[]
  typeLine?: string
}

export async function insertCard(pool: Pool, fixture: CardFixture): Promise<string> {
  const id = randomUUID()
  const setCode = fixture.setCode ?? 'tst'
  await pool.query(
    `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
    [setCode],
  )
  await pool.query(
    `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
     VALUES ($1, $2, $3, $4, $5, 'common', 1, $6, '{}', '{}', $7, '{"commander":"legal","modern":"legal"}'::jsonb)`,
    [
      id,
      fixture.oracleId ?? randomUUID(),
      fixture.name,
      setCode,
      fixture.collectorNumber ?? id.slice(0, 8),
      fixture.typeLine ?? 'Artifact',
      fixture.finishes ?? ['nonfoil', 'foil'],
    ],
  )
  if (fixture.priceEur !== undefined || fixture.priceEurFoil !== undefined) {
    await pool.query(
      `INSERT INTO card_prices (card_id, day, eur, eur_foil, usd, usd_foil) VALUES ($1, current_date, $2, $3, $2, $3)`,
      [id, fixture.priceEur ?? null, fixture.priceEurFoil ?? null],
    )
  }
  return id
}

export async function insertUser(pool: Pool, username: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, username) VALUES ($1, $2) RETURNING id`,
    [`${username}@example.com`, username],
  )
  return rows[0]!.id
}

export interface Aggregate {
  cards: number
  unique: number
  valueEurMinor: number
}

// Recalcul indépendant de `recomputeContainerStats` : même règle de prix
// (jour de référence unique, colonne foil pour foil/etched), écrite à part
// pour qu'une régression de la requête de l'app ne se vérifie pas elle-même.
export async function aggregateHoldings(
  pool: Pool,
  containerIds: string[],
): Promise<Aggregate> {
  const { rows } = await pool.query<{ cards: string; unique: string; value: string }>(
    `SELECT coalesce(sum(h.qty), 0) AS cards,
            count(h.id) AS unique,
            coalesce(sum(round(h.qty * coalesce(CASE WHEN h.finish = 'nonfoil' THEN p.eur ELSE p.eur_foil END, 0) * 100)), 0) AS value
       FROM holdings h
       LEFT JOIN card_prices p ON p.card_id = h.card_id AND p.day = (SELECT max(day) FROM card_prices)
      WHERE h.container_id = ANY($1::uuid[])`,
    [containerIds],
  )
  return {
    cards: Number(rows[0]!.cards),
    unique: Number(rows[0]!.unique),
    valueEurMinor: Number(rows[0]!.value),
  }
}

export async function readStats(pool: Pool, containerId: string): Promise<Aggregate> {
  const { rows } = await pool.query<{
    card_count: number
    unique_count: number
    value_eur_minor: string
  }>(
    `SELECT card_count, unique_count, value_eur_minor FROM container_stats WHERE container_id = $1`,
    [containerId],
  )
  // Une ligne absente n'équivaut pas à un container vide : tout container
  // vivant en porte une, un chemin d'écriture qui l'oublie doit échouer ici.
  const row = rows[0]
  if (!row) throw new Error(`No container_stats row for ${containerId}.`)
  return {
    cards: row.card_count,
    unique: row.unique_count,
    valueEurMinor: Number(row.value_eur_minor),
  }
}

// Containers dont le contenu est du stock possédé : racine et binders. Une
// liste n'en fait jamais partie, un deck non plus (il réclame, il ne détient
// pas).
export async function ownedContainerIds(
  pool: Pool,
  collectionId: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM containers WHERE collection_id = $1 AND kind IN ('collection', 'binder')`,
    [collectionId],
  )
  return rows.map((row) => row.id)
}

// Instantané comparable des holdings d'une collection, sans les colonnes
// qui changent légitimement d'une écriture à l'autre (`id`, horodatages).
export async function snapshotHoldings(
  pool: Pool,
  collectionId: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ line: string }>(
    `SELECT concat_ws('|', c.name, h.card_id, h.finish, h.condition, h.language, h.zone, h.qty) AS line
       FROM holdings h
       JOIN containers c ON c.id = h.container_id
      WHERE c.collection_id = $1
      ORDER BY 1`,
    [collectionId],
  )
  return rows.map((row) => row.line)
}
