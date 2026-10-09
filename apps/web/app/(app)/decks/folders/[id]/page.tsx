// Écran `See all` d'un dossier, en
// composant serveur : le paramètre d'URL est validé par Zod à la frontière
// (docs/development.md — jamais casté, sinon un `id` non-uuid atteindrait Postgres et
// lèverait `22P02`), puis le dossier est résolu **par la collection du
// compte** (`getFolder`), jamais par son seul identifiant : un `folderId`
// d'URL ne doit pas laisser lire le dossier d'une autre collection.
//
// Un dossier disparu (supprimé entre deux onglets, ou d'une autre
// collection) n'est plus un 404 générique :
// l'écran reste rendu, avec « This folder no longer exists. » à la place de
// la liste — un `notFound()` bloquant resterait justifié pour un `id` qui
// n'est même pas un UUID (une erreur de routage, pas un état de données).
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'

import { UNSORTED_FOLDER_SLUG, getFolder, unsortedFolderPage } from '../../folders-data'
import { listDecks } from '../../decks-data'
import { FolderDecksView } from './folder-decks-view'

const folderIdSchema = z.uuid()

export default async function FolderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireSession()
  const { id } = await params

  // `See all` de l'étagère `Unsorted` : le dossier virtuel des decks sans
  // `folder_id` — rien à résoudre en base, mêmes lignes et même `built:
  // false` que ci-dessous.
  if (id === UNSORTED_FOLDER_SLUG) {
    const data = await listDecks(user.id, { folderId: null, built: false })
    return (
      <FolderDecksView folderId={null} folder={unsortedFolderPage()} initial={data} />
    )
  }

  const parsed = folderIdSchema.safeParse(id)
  if (!parsed.success) notFound()

  const folder = await getFolder(user.id, parsed.data)
  if (!folder) {
    return <FolderDecksView folderId={parsed.data} folder={null} initial={null} />
  }

  // La **même** requête que l'onglet Decks, restreinte à ce dossier (avec
  // les mêmes lignes de deck) — jamais une seconde qui divergerait au
  // premier changement de statut ou de devise.
  // `built: false` comme l'étagère dont cet écran est le « See all » : un
  // deck monté a quitté l'atelier pour `Collection › Decks`, il ne doit pas
  // réapparaître ici (sinon le `See all` d'un dossier montrerait plus de
  // decks que l'étagère qu'il déplie).
  const data = await listDecks(user.id, { folderId: folder.folderId, built: false })
  return <FolderDecksView folderId={folder.folderId} folder={folder} initial={data} />
}
