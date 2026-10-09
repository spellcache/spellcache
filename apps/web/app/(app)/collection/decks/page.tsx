// `Collection › Decks` (composant serveur) : la moitié « inventaire » des
// deux zones de decks — `listDecks(..., { built: true })` ne ramène que les
// decks montés, dont les cartes comptent dans la collection. L'onglet
// `Decks` interroge la même fonction avec `built: false` ; c'est le seul
// paramètre qui sépare les deux écrans.
import { listDecks } from '@/app/(app)/decks/decks-data'
import { requireSession } from '@/lib/auth-guards'

import { CollectionDecksView } from './collection-decks-view'

export default async function CollectionDecksPage() {
  const user = await requireSession()
  const data = await listDecks(user.id, { built: true })
  return <CollectionDecksView initial={data} />
}
