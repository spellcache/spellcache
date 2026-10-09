// Écran `Decks`, en composant serveur : une requête agrégée
// (`getFolderShelves`, folders-data.ts) hydrate directement `FoldersView`,
// même patron que `app/(app)/collection/page.tsx`.
//
// Un seul rendu : la pile d'étagères, une par dossier de decks, plus
// `Unsorted` à la fin. Le réglage `Decks home` de Settings et la colonne
// `users.deck_style` qui le portait ont été retirés — un onglet dont la
// liste plate n'était qu'un second habillage du même contenu, jamais
// demandé par le design.
import { requireSession } from '@/lib/auth-guards'

import { FoldersView } from './folders-view'
import { getFolderShelves } from './folders-data'

export default async function DecksPage() {
  const user = await requireSession()
  const shelves = await getFolderShelves(user.id)
  return <FoldersView initial={shelves} />
}
