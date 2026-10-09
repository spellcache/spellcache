// Revalorisation nocturne de tous les containers : une
// seule requête `UPDATE … FROM (…)` agrégée recalcule `container_stats`
// pour tous les containers à la fois — jamais une boucle TypeScript par
// container (1 284 cartes en boucle tient en local puis s'effondre).
//
// Exécuté par `apps/worker/src/index.ts`, sans bundler (résolution ESM native de
// Node, comme `apps/worker/src/import-bulk.ts`) : tous les
// imports internes sont relatifs avec extension `.ts` explicite, jamais
// l'alias `@/`.
import { Pool, type PoolClient } from 'pg'

const SOURCE = 'revalue-containers'

// Fenêtre de rattrapage du J-7 : deux exigences la bornent — un J-6
// disponible doit être utilisé quand le J-7 exact manque, un historique de
// 3 jours seulement doit rendre `null` plutôt qu'une comparaison trompeuse.
// Trois jours de tolérance de part et d'autre de la cible satisfont les deux
// sans jamais confondre « hier » et « il y a une semaine ».
const TARGET_OFFSET_DAYS = 7
const TOLERANCE_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export interface RevalueResult {
  containersUpdated: number
  durationMs: number
  referenceDay: string // YYYY-MM-DD du jour de prix utilisé
  comparisonDay: string | null // le J-7 réellement trouvé, ou null si historique trop court
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

// UTC pur (dates et fuseaux horaires sont le piège spécifique de ce job) :
// jamais `getFullYear()`/`getDate()`, qui
// lisent le fuseau local du process et peuvent décaler le jour d'un jour
// entier selon l'hébergement. Exportée pour un test unitaire dédié
// (`tests/unit/to-day-string.test.ts`) — le point exact où ce piège serait
// démontrable sans dépendre de Postgres.
export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Fonction pure, testable sans base de données : sélectionne, parmi les
// jours réellement disponibles, celui le plus proche de J-7 — jamais un
// jour ≥ `referenceDay` (quantités du jour, prix des deux jours, jamais un
// jour futur). `referenceDay`/`availableDays` sont des
// chaînes `YYYY-MM-DD`, jamais des `Date`, pour ne jamais réintroduire de
// fuseau horaire dans la comparaison.
export function pickComparisonDay(referenceDay: string, availableDays: string[]): string | null {
  const targetMs = Date.parse(`${referenceDay}T00:00:00Z`) - TARGET_OFFSET_DAYS * DAY_MS

  let best: { day: string; ms: number; delta: number } | null = null
  for (const day of availableDays) {
    if (day >= referenceDay) continue
    const ms = Date.parse(`${day}T00:00:00Z`)
    const delta = Math.abs(ms - targetMs)
    if (delta > TOLERANCE_DAYS * DAY_MS) continue
    if (!best || delta < best.delta || (delta === best.delta && ms > best.ms)) {
      best = { day, ms, delta }
    }
  }
  return best?.day ?? null
}

// Le jour de référence est le jour de prix le plus récent connu à `asOf`
// près (spec `opts.asOf`, utilisé par les tests pour fixer une date sans
// dépendre de l'horloge réelle) — pas nécessairement le calendrier du jour
// : si l'import a été sauté (bulk inchangé), aucune nouvelle ligne
// `card_prices` n'existe pour aujourd'hui et le dernier jour connu reste le
// bon jour à valoriser.
async function resolveReferenceDay(conn: PoolClient, asOf: Date): Promise<string> {
  const asOfDay = toDayString(asOf)
  const { rows } = await conn.query<{ day: string | null }>(
    `SELECT max(day)::text AS day FROM card_prices WHERE day <= $1::date`,
    [asOfDay],
  )
  return rows[0]?.day ?? asOfDay
}

async function resolveComparisonDay(conn: PoolClient, referenceDay: string): Promise<string | null> {
  const { rows } = await conn.query<{ day: string }>(
    `SELECT DISTINCT day::text AS day FROM card_prices
     WHERE day < $1::date AND day >= ($1::date - $2::int)`,
    [referenceDay, TARGET_OFFSET_DAYS + TOLERANCE_DAYS],
  )
  return pickComparisonDay(
    referenceDay,
    rows.map((row) => row.day),
  )
}

// Requête agrégée unique : `container_stats`
// pour TOUS les containers en une seule instruction `UPDATE … FROM (…)`.
// `LEFT JOIN` part de `containers`, jamais de `holdings` : un binder vidé
// depuis la dernière exécution doit retomber à zéro/`null` plutôt que de
// rester inchangé (les mutations de holdings recalculent déjà ce cas
// immédiatement — mais la revalorisation nocturne ne doit pas le
// contredire au run suivant si elle ne le retouchait jamais).
//
// Quantités toujours du jour courant (`holdings.qty`, table utilisateur),
// prix des deux jours (`card_prices`, catalogue) — la variation compare des
// valeurs à quantités constantes : appliquer les quantités d'il y a sept
// jours transformerait un achat en hausse de marché.
//
// `day_prices`/`cmp_prices` sont chacune bornées à un seul jour : la clé
// primaire `(card_id, day)` garantit au plus une ligne par carte dans
// chacune, donc aucun `LEFT JOIN` ici ne peut dupliquer une ligne de
// `holdings`.
async function runRevalue(
  conn: PoolClient,
  referenceDay: string,
  comparisonDay: string | null,
): Promise<number> {
  const result = await conn.query(
    `
    WITH day_prices AS (
      SELECT card_id, usd, usd_foil, eur, eur_foil
      FROM card_prices
      WHERE day = $1::date
    ),
    cmp_prices AS (
      SELECT card_id, usd, usd_foil, eur, eur_foil
      FROM card_prices
      WHERE $2::date IS NOT NULL AND day = $2::date
    ),
    agg AS (
      SELECT
        c.id AS container_id,
        coalesce(sum(h.qty), 0)::int AS card_count,
        count(h.id)::int AS unique_count,
        coalesce(sum(round(h.qty * coalesce(
          case when h.finish = 'nonfoil' then dp.usd else dp.usd_foil end, 0
        )::numeric * 100)), 0)::bigint AS value_usd_minor,
        coalesce(sum(round(h.qty * coalesce(
          case when h.finish = 'nonfoil' then dp.eur else dp.eur_foil end, 0
        )::numeric * 100)), 0)::bigint AS value_eur_minor,
        coalesce(sum(round(h.qty * coalesce(
          case when h.finish = 'nonfoil' then cp.usd else cp.usd_foil end, 0
        )::numeric * 100)), 0)::bigint AS value_usd_minor_cmp,
        coalesce(sum(round(h.qty * coalesce(
          case when h.finish = 'nonfoil' then cp.eur else cp.eur_foil end, 0
        )::numeric * 100)), 0)::bigint AS value_eur_minor_cmp
      FROM containers c
      LEFT JOIN holdings h ON h.container_id = c.id
      LEFT JOIN day_prices dp ON dp.card_id = h.card_id
      LEFT JOIN cmp_prices cp ON cp.card_id = h.card_id
      GROUP BY c.id
    )
    UPDATE container_stats cs SET
      card_count = agg.card_count,
      unique_count = agg.unique_count,
      value_usd_minor = agg.value_usd_minor,
      value_eur_minor = agg.value_eur_minor,
      -- Un jour de comparaison manquant est traité comme « pas de
      -- comparaison », jamais comme une valeur nulle (sinon la
      -- variation afficherait -100 %). Un dénominateur nul (container qui
      -- valait 0 il y a sept jours) est gardé de la même façon.
      delta_usd_7d = CASE
        WHEN $2::date IS NULL OR agg.value_usd_minor_cmp = 0 THEN NULL
        ELSE round(((agg.value_usd_minor - agg.value_usd_minor_cmp)::numeric / agg.value_usd_minor_cmp) * 100, 1)
      END,
      delta_eur_7d = CASE
        WHEN $2::date IS NULL OR agg.value_eur_minor_cmp = 0 THEN NULL
        ELSE round(((agg.value_eur_minor - agg.value_eur_minor_cmp)::numeric / agg.value_eur_minor_cmp) * 100, 1)
      END,
      computed_at = now()
    FROM agg
    WHERE agg.container_id = cs.container_id
    `,
    [referenceDay, comparisonDay],
  )
  return result.rowCount ?? 0
}

export async function revalueAllContainers(opts?: { asOf?: Date }): Promise<RevalueResult> {
  const asOf = opts?.asOf ?? new Date()
  const startedAt = new Date()
  // `-c TimeZone=UTC` (même raison que `apps/worker/src/import-bulk.ts`) : cette
  // requête ne dépend d'aucune horloge de session Postgres pour résoudre
  // `referenceDay`/`comparisonDay` (chaînes UTC calculées côté worker), mais
  // la fixe quand même sur la connexion qui écrit `import_runs` pour ne
  // jamais dépendre implicitement du fuseau du serveur.
  const pool = new Pool({ connectionString: requireDatabaseUrl(), options: '-c TimeZone=UTC' })

  try {
    const conn = await pool.connect()
    try {
      const referenceDay = await resolveReferenceDay(conn, asOf)
      const comparisonDay = await resolveComparisonDay(conn, referenceDay)

      // Transaction explicite : une erreur
      // pendant la revalorisation ne doit laisser aucune trace dans
      // `container_stats`, même si l'`UPDATE` a partiellement échoué avant
      // de lever — la ligne `import_runs` en erreur, elle, est écrite après
      // le `ROLLBACK`, sur une transaction neuve.
      await conn.query('BEGIN')
      try {
        const containersUpdated = await runRevalue(conn, referenceDay, comparisonDay)
        const finishedAt = new Date()
        // `bulk_updated_at` reste `NULL` ici : ces
        // lignes n'ont pas de fichier bulk associé, contrairement à celles
        // de `source = 'default_cards'` — écrire `startedAt` y ferait
        // doublon avec `started_at` et détournerait le sens de la colonne.
        await conn.query(
          `INSERT INTO import_runs (source, bulk_updated_at, started_at, finished_at, rows_upserted, status)
           VALUES ($1, NULL, $2, $3, $4, 'success')`,
          [SOURCE, startedAt, finishedAt, containersUpdated],
        )
        await conn.query('COMMIT')

        return {
          containersUpdated,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          referenceDay,
          comparisonDay,
        }
      } catch (error) {
        await conn.query('ROLLBACK')
        const message = error instanceof Error ? error.message : String(error)
        await conn.query(
          `INSERT INTO import_runs (source, bulk_updated_at, started_at, finished_at, rows_upserted, status, error_message)
           VALUES ($1, NULL, $2, now(), 0, 'error', $3)`,
          [SOURCE, startedAt, message],
        )
        throw error
      }
    } finally {
      conn.release()
    }
  } finally {
    await pool.end()
  }
}
