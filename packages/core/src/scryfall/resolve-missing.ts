// Résolution par lot des deux cas où un appel direct à Scryfall est autorisé :
// la sortie d'un set le jour même, et une carte absente du
// catalogue local. Toujours côté serveur, jamais depuis le navigateur — et
// toujours via `ScryfallClient`, seul point du code qui parle à Scryfall.
import type { CardIdentifier, ScryfallClient } from './client.ts'
import type { ScryfallCard } from './schemas.ts'

const BATCH_SIZE = 75

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export async function resolveMissingCards(
  client: ScryfallClient,
  identifiers: CardIdentifier[],
): Promise<ScryfallCard[]> {
  const resolved: ScryfallCard[] = []
  for (const batch of chunk(identifiers, BATCH_SIZE)) {
    resolved.push(...(await client.postCardCollection(batch)))
  }
  return resolved
}
