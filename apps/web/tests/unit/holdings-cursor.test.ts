// Régression — trois défauts fermés dans `holdings-data.ts`,
// couverts ici comme fonctions pures (aucune connexion Postgres nécessaire),
// même précédent que `tests/unit/cursor.test.ts` : `encodeCursor`/
// `decodeCursor` et les fonctions de normalisation de tri sont exportées
// exprès pour ce test, la lecture réelle (`listHoldings`/`countHoldings`)
// reste couverte par `tests/integration/filters.test.ts`.
//
// 1. Le curseur de groupement (`groupRank`) doit accepter aussi bien un rang
//    entier (`type`/`colour`/`rarity`) qu'un code de set textuel (`set`) —
//    `cursorSchema` ne validait auparavant que `number`, si bien qu'un
//    groupement par `set` produisait un curseur que son propre schéma
//    rejetait.
// 2. Le tri `added` ne doit plus jamais transiter par un objet `Date` : le
//    pilote `pg` interprète `timestamp without time zone` (OID 1114) avec le
//    fuseau du *process*, pas de la session Postgres — sérialiser en UTC
//    (`toISOString`) puis recaster `::timestamp` (naïf) décale le curseur de
//    l'offset local (reproduit sous `TZ=Europe/Paris` ; `SortKey` inclut
//    `added`).
// 3. La chaîne `FROM`/`JOIN` (`HOLDINGS_JOIN_CHAIN`) est l'unique point qui
//    définit l'alias `p` que `buildWhereConditions` référence pour le filtre
//    Price — `countHoldings` et `listHoldings` interpolent le même export,
//    ils ne peuvent plus diverger (une seule requête, jointure construite en
//    un point).
import { randomUUID } from 'node:crypto'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  buildWhereConditions,
  castCursorValue,
  decodeCursor,
  encodeCursor,
  HOLDINGS_JOIN_CHAIN,
  InvalidHoldingCursorError,
  normalizeSortValue,
  rawSortExpr,
  SORT_VALUE_KIND,
  type HoldingCursor,
} from '@/app/(app)/container/[id]/holdings-data'
import { EMPTY_FILTERS } from '@/lib/view-state/parse'

const dialect = new PgDialect()

describe('holdings-data cursor (defect 2 — groupRank type mismatch)', () => {
  it('round-trips a textual groupRank (grouping by set, e.g. "neo")', () => {
    const cursor: HoldingCursor = {
      groupRank: 'neo',
      sortValue: 'Lightning Bolt',
      holdingId: randomUUID(),
    }

    const decoded = decodeCursor(encodeCursor(cursor))
    expect(decoded).toEqual(cursor)
  })

  it('still round-trips a numeric groupRank (grouping by type/colour/rarity)', () => {
    const cursor: HoldingCursor = {
      groupRank: 3,
      sortValue: 42,
      holdingId: randomUUID(),
    }

    const decoded = decodeCursor(encodeCursor(cursor))
    expect(decoded).toEqual(cursor)
  })

  it('still round-trips a null groupRank (no grouping)', () => {
    const cursor: HoldingCursor = {
      groupRank: null,
      sortValue: 'Lightning Bolt',
      holdingId: randomUUID(),
    }

    const decoded = decodeCursor(encodeCursor(cursor))
    expect(decoded).toEqual(cursor)
  })

  it('rejects a garbage groupRank type (e.g. a boolean) rather than silently coercing it', () => {
    const json = JSON.stringify({ groupRank: true, sortValue: 'x', holdingId: randomUUID() })
    const bad = Buffer.from(json, 'utf8').toString('base64url')
    expect(() => decodeCursor(bad)).toThrow(InvalidHoldingCursorError)
  })
})

describe('holdings-data sort value normalization (defect 3 — added_at timezone shift)', () => {
  it('classifies "added" as text, not a separate timestamp kind', () => {
    // Une troisième valeur `'timestamp'` réintroduirait le chemin qui
    // convertissait la valeur pg en `Date` — voir la régression ci-dessous.
    expect(SORT_VALUE_KIND.added).toBe('text')
  })

  it('passes a Postgres-formatted timestamp string through unchanged, independent of TZ', () => {
    // Format que produit `holdings.added_at::text` (aucun offset, aucun
    // suffixe de fuseau — c'est justement ce qui rend l'ancien passage par
    // `Date`/`toISOString()` incorrect : il n'y a pas de fuseau à convertir).
    const raw = '2026-08-25 10:00:00.123456'
    expect(normalizeSortValue(raw, SORT_VALUE_KIND.added)).toBe(raw)
  })

  it('re-injects the cursor value as ::text, byte-identical, never ::timestamp', () => {
    const raw = '2026-08-25 08:00:00.123456'
    const { sql, params } = dialect.sqlToQuery(castCursorValue(raw, SORT_VALUE_KIND.added))

    expect(sql).toContain('::text')
    expect(sql).not.toContain('::timestamp')
    expect(params).toEqual([raw])
  })

  it('casts holdings.added_at to text at the SQL level, so the pg driver never parses it as a Date (OID 1114)', () => {
    const { sql } = dialect.sqlToQuery(rawSortExpr('added', 'eur'))
    expect(sql).toContain('holdings.added_at::text')
  })
})

describe('holdings-data join chain (defect 1 — countHoldings missing the price join)', () => {
  it('HOLDINGS_JOIN_CHAIN defines the alias "p" that the Price filter depends on', () => {
    const { sql } = dialect.sqlToQuery(HOLDINGS_JOIN_CHAIN)
    expect(sql).toContain('left join lateral')
    expect(sql).toContain('as p on true')
  })

  it('buildWhereConditions references p.eur for a Price filter — only resolvable against HOLDINGS_JOIN_CHAIN', () => {
    const conditions = buildWhereConditions({
      containerId: randomUUID(),
      query: '',
      filters: { ...EMPTY_FILTERS, priceMinMinor: 100 },
      currency: 'eur',
    })

    const rendered = conditions.map((c) => dialect.sqlToQuery(c).sql).join(' and ')
    expect(rendered).toContain('p.eur')

    // La même chaîne `FROM`/`JOIN` (identité, pas juste un texte
    // équivalent) doit être interpolée par `countHoldings` et `listHoldings`
    // — un second `left join lateral` copié-collé romprait cette garantie,
    // exactement le piège à éviter.
    const { sql: joinSql } = dialect.sqlToQuery(HOLDINGS_JOIN_CHAIN)
    expect(joinSql).toContain('as p on true')
  })
})
