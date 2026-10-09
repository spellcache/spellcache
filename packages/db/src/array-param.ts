// Paramètre tableau pour un gabarit `sql` de Drizzle.
//
// Un tableau JS interpolé directement — `` sql`... = any(${keys}::text[])` `` —
// n'est **pas** un paramètre tableau : Drizzle rend chaque élément comme un
// placeholder distinct séparé par des virgules, et Postgres lit le résultat
// comme un constructeur de ligne.
//
//   sql`any(${['a','b','c']}::text[])`  →  any(($1, $2, $3)::text[])
//                                          cannot cast type record to text[]
//   sql`any(${['a']}::text[])`          →  any(($1)::text[])
//                                          malformed array literal: "a"
//
// `sql.param(values)` rend un placeholder unique dont la valeur est le
// tableau lui-même (`any($1::text[])`), que `pg` sérialise en littéral de
// tableau Postgres. Le cast reste nécessaire : le paramètre part sans type.
//
// Passer par ces deux fonctions plutôt que par `sql.param` nu rend le motif
// correct greppable, et le motif fautif détectable — voir
// `tests/unit/sql-array-params.test.ts`, qui rend chaque requête concernée
// par le `PgDialect` et échoue sur la présence d'un constructeur de ligne.
import { sql, type SQL } from 'drizzle-orm'

export function textArray(values: readonly string[]): SQL {
  return sql`${sql.param([...values])}::text[]`
}

export function uuidArray(values: readonly string[]): SQL {
  return sql`${sql.param([...values])}::uuid[]`
}
