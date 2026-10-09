'use server'

// Données de la feuille `Import & export` unifiée : la liste des
// destinations d'import/portées d'export (binders + listes de la
// collection), et l'extraction des lignes à exporter. Toute entrée externe
// est validée par Zod à la frontière (docs/development.md).
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { containers, containerStats, type Condition, type Finish } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { ContainerAccessError, requireContainerAccess } from '@/lib/collections/authorize'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { db } from '@spellcache/db'
import { currencyOf } from '@/lib/price-source'
import { getPreferences } from '@/lib/preferences'
import { uuidArray } from '@spellcache/db/array-param'

// Destinations d'import / portées d'export — binders et listes de la
// collection de l'appelant, le container racine à part (`Collection (no
// binder)`, jamais dans ces deux tableaux). Même forme que
// `BulkMoveTarget` (`bulk-actions.ts`), sans les decks : ni destination
// d'import, ni portée d'export au sens de cette feuille.
export interface ImportExportDestination {
  id: string
  name: string
  cardCount: number
}

export interface ImportExportDestinations {
  rootContainerId: string
  binders: ImportExportDestination[]
  lists: ImportExportDestination[]
}

export async function listImportExportDestinationsAction(): Promise<ImportExportDestinations> {
  const user = await requireSession()
  const { collectionId, containerId: rootContainerId } = await bootstrapCollection(user.id, {
    username: user.username,
    displayName: null,
  })

  const rows = await db
    .select({
      id: containers.id,
      kind: containers.kind,
      name: containers.name,
      cardCount: containerStats.cardCount,
    })
    .from(containers)
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .where(eq(containers.collectionId, collectionId))
    .orderBy(containers.sortOrder, containers.createdAt)

  const binders: ImportExportDestination[] = []
  const lists: ImportExportDestination[] = []
  for (const row of rows) {
    const target = row.kind === 'binder' ? binders : row.kind === 'list' ? lists : null
    if (target) target.push({ id: row.id, name: row.name, cardCount: row.cardCount })
  }

  return { rootContainerId, binders, lists }
}

// ------------------------------------------------------------------ export

export interface ExportRow {
  name: string
  set: string
  collectorNumber: string
  qty: number
  finish: Finish
  condition: Condition
  language: string
  // Prix unitaire courant, dans la devise du compte (`price_source`,
  // docs/development.md) — `null` quand le catalogue n'a aucun prix connu pour cette
  // impression.
  price: number | null
}

const exportScopeSchema = z.discriminatedUnion('scope', [
  // « All collection » : le container racine ET tous les binders de la
  // collection combinés — seuls les listes et les decks sont exclus, jamais
  // un binder. Distinct de l'étagère « All collection » de l'accueil
  // Shelves, qui ne montre que le container racine seul.
  z.object({ scope: z.literal('collection') }),
  z.object({ scope: z.literal('container'), containerId: z.uuid() }),
])

interface ExportSqlRow extends Record<string, unknown> {
  name: string
  setCode: string
  collectorNumber: string
  qty: number
  finish: Finish
  condition: Condition
  language: string
  priceMinor: string | number | null
}

function priceExprMinor(currency: 'usd' | 'eur') {
  const nonfoilCol = currency === 'usd' ? sql`p.usd` : sql`p.eur`
  const foilCol = currency === 'usd' ? sql`p.usd_foil` : sql`p.eur_foil`
  return sql`round((case when h.finish = 'nonfoil' then ${nonfoilCol} else ${foilCol} end) * 100)`
}

export async function exportRowsAction(
  input: unknown,
): Promise<{ ok: true; rows: ExportRow[] } | { ok: false; error: string }> {
  const parsed = exportScopeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const currency = currencyOf(await getPreferences(user.id))

  try {
    let containerIds: string[]
    if (parsed.data.scope === 'collection') {
      const { collectionId } = await bootstrapCollection(user.id, {
        username: user.username,
        displayName: null,
      })
      const scoped = await db
        .select({ id: containers.id })
        .from(containers)
        .where(
          and(eq(containers.collectionId, collectionId), inArray(containers.kind, ['collection', 'binder'])),
        )
      containerIds = scoped.map((row) => row.id)
    } else {
      await requireContainerAccess(user.id, parsed.data.containerId, 'read')
      containerIds = [parsed.data.containerId]
    }

    if (containerIds.length === 0) return { ok: true, rows: [] }

    const price = priceExprMinor(currency)
    const { rows } = await db.execute<ExportSqlRow>(sql`
      select
        cd.name as "name",
        cd.set_code as "setCode",
        cd.collector_number as "collectorNumber",
        h.qty as "qty",
        h.finish as "finish",
        h.condition as "condition",
        h.language as "language",
        ${price} as "priceMinor"
      from holdings h
      join cards cd on cd.id = h.card_id
      left join lateral (
        select usd, usd_foil, eur, eur_foil from card_prices
        where card_prices.card_id = h.card_id
        order by day desc
        limit 1
      ) p on true
      where h.container_id = any(${uuidArray(containerIds)})
      order by cd.name asc, cd.set_code asc, cd.collector_number asc
    `)

    return {
      ok: true,
      rows: rows.map((row) => ({
        name: row.name,
        set: row.setCode,
        collectorNumber: row.collectorNumber,
        qty: row.qty,
        finish: row.finish,
        condition: row.condition,
        language: row.language,
        price: row.priceMinor === null ? null : Number(row.priceMinor) / 100,
      })),
    }
  } catch (error) {
    if (error instanceof ContainerAccessError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
