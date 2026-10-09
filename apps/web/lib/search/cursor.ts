// Curseur opaque de pagination : encode le triplet `(rank, name,
// cardId)` qui positionne la dernière ligne vue. `cardId` est le discriminant
// qui empêche la pagination de boucler quand deux cartes partagent le même
// rang et le même nom.
//
// `rank`/`name` sont génériques (`lib/search/search-cards.ts`) : le
// régime `'search'` y met le score de pertinence et le nom de la carte, le
// régime `'set'` y met le numéro de collectionneur (encodé, croissant) et sa
// forme texte — les deux régimes partagent la même formule de seek
// pagination sans dupliquer ce module.
import { z } from 'zod'

export interface SearchCursor {
  rank: number
  name: string
  cardId: string
}

const cursorSchema = z.object({
  rank: z.number(),
  name: z.string(),
  cardId: z.uuid(),
})

export class InvalidCursorError extends Error {}

export function encodeCursor(c: SearchCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): SearchCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    return cursorSchema.parse(JSON.parse(json))
  } catch {
    throw new InvalidCursorError(`Invalid search cursor: ${raw}`)
  }
}
