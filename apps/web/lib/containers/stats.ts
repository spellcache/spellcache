// Recalcul de `container_stats` à l'écriture : une requête
// agrégée par container touché, jamais à la lecture — un bandeau de valeur
// lit une ligne, il n'agrège jamais les holdings au chargement (docs/development.md).
import { eq, sql } from 'drizzle-orm'

import { containerStats } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

// N'importe quel exécuteur portant `.execute` (le singleton `db` ou un `tx`
// de `db.transaction`) : permet aux mutations de holdings d'appeler ce
// recalcul dans leur propre transaction (un recalcul par
// ligne modifiée effondrerait les actions groupées, donc une fois par
// container touché, à la fin de la transaction), sans changer la signature
// documentée par le contrat (`recomputeContainerStats(containerId)` reste un
// appel valide à un seul argument, le second est optionnel).
type Executor = Pick<typeof db, 'execute'>

// Les deux colonnes de valeur sont remplies dès l'écriture depuis les prix du
// jour les plus récents, avec la même logique que la requête agrégée nocturne
// (`apps/worker/src/jobs/revalue-containers.ts`) — un seul jour de référence pour
// tout le catalogue (`max(day)` de `card_prices`), jamais le dernier jour
// connu par carte indépendamment les unes des autres : sinon une carte dont
// le prix le plus récent précède ce jour de référence vaudrait sa dernière
// valeur connue ici, et zéro dans `revalueAllContainers()` la nuit suivante
// — la même carte changerait de valeur selon que c'est une mutation de
// holding ou le job nocturne qui a écrit `container_stats` en dernier.
// - `finish = 'foil'` ou `'etched'` valorisée sur les colonnes `_foil` (ce
//   schéma n'a pas de colonne dédiée à `etched` — `packages/db/src/schema.ts`) ;
// - une carte sans prix pour ce jour de référence compte pour 0 sans
//   annuler le total.
export async function recomputeContainerStats(
  containerId: string,
  executor: Executor = db,
): Promise<void> {
  await executor.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    select
      ${containerId}::uuid,
      coalesce(sum(h.qty), 0)::int,
      count(*)::int,
      coalesce(sum(round(h.qty * coalesce(
        case when h.finish = 'nonfoil' then p.usd else p.usd_foil end, 0
      ) * 100)), 0)::bigint,
      coalesce(sum(round(h.qty * coalesce(
        case when h.finish = 'nonfoil' then p.eur else p.eur_foil end, 0
      ) * 100)), 0)::bigint,
      now()
    from holdings h
    left join card_prices p
      on p.card_id = h.card_id
      and p.day = (select max(day) from card_prices)
    where h.container_id = ${containerId}::uuid
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      value_usd_minor = excluded.value_usd_minor,
      value_eur_minor = excluded.value_eur_minor,
      computed_at = excluded.computed_at
  `)
}

// Lecture typée d'une ligne `container_stats` dans une devise : les deux
// colonnes de valeur et de delta sont toujours tenues à jour dans les deux
// devises (stocker une seule valeur dans la devise préférée obligerait à tout
// recalculer au changement de préférence), ce point de lecture choisit juste
// la paire de colonnes à renvoyer, sans jamais déclencher d'écriture.
export interface ContainerValue {
  cardCount: number
  uniqueCount: number
  valueMinor: number
  delta7d: number | null
  currency: 'usd' | 'eur'
}

export async function readContainerValue(
  containerId: string,
  currency: 'usd' | 'eur',
): Promise<ContainerValue> {
  const [row] = await db
    .select({
      cardCount: containerStats.cardCount,
      uniqueCount: containerStats.uniqueCount,
      valueUsdMinor: containerStats.valueUsdMinor,
      valueEurMinor: containerStats.valueEurMinor,
      deltaUsd7d: containerStats.deltaUsd7d,
      deltaEur7d: containerStats.deltaEur7d,
    })
    .from(containerStats)
    .where(eq(containerStats.containerId, containerId))
    .limit(1)

  if (!row) throw new Error(`No container_stats row for container ${containerId}.`)

  // `numeric` de Postgres revient en chaîne dans `pg` :
  // conversion explicite avant tout usage, jamais une addition directe sur
  // la valeur brute renvoyée par le driver.
  const rawDelta = currency === 'usd' ? row.deltaUsd7d : row.deltaEur7d

  return {
    cardCount: row.cardCount,
    uniqueCount: row.uniqueCount,
    valueMinor: currency === 'usd' ? row.valueUsdMinor : row.valueEurMinor,
    delta7d: rawDelta === null || rawDelta === undefined ? null : Number(rawDelta),
    currency,
  }
}
