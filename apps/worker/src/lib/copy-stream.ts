// Flux `COPY … FROM STDIN` vers une table de staging.
// `pg-copy-streams` plutôt qu'un `INSERT` par ligne : seul moyen de charger un
// bulk de plusieurs millions de lignes sans jamais le tenir en mémoire.
import type { PoolClient } from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// `COPY` échoue silencieusement sur une valeur nulle mal échappée
// → encodage CSV explicite : `null` devient un champ vide non guillemeté
// (NULL implicite du format csv), toute autre valeur contenant une virgule,
// un guillemet ou un retour à la ligne est guillemetée avec les guillemets
// internes doublés.
export function csvField(value: string | null): string {
  if (value === null) return ''
  if (value === '' || /["\n\r,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function csvRow(fields: Array<string | null>): string {
  return fields.map(csvField).join(',') + '\n'
}

export async function copyRowsToStaging(
  client: PoolClient,
  copySql: string,
  rows: AsyncIterable<Array<string | null>>,
): Promise<number> {
  const copyStream = client.query(copyFrom(copySql))
  let count = 0

  async function* lines(): AsyncGenerator<string> {
    for await (const row of rows) {
      count++
      yield csvRow(row)
    }
  }

  await pipeline(Readable.from(lines()), copyStream)
  return count
}
