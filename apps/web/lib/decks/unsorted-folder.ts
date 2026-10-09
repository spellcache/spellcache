// Le dossier virtuel `Unsorted` des decks sans `folder_id` — ici,
// sans aucune dépendance serveur, pour être importable par les îlots client
// (`folders-view.tsx`) comme par les composants serveur (`folders-data.ts`,
// `folders/[id]/page.tsx`) sans tirer `pg` dans le bundle navigateur.

// Nom de l'étagère finale, la seule sans `folderId`. Exporté pour que la vue
// et les tests n'en recopient pas la chaîne.
export const UNSORTED_SHELF_NAME = 'Unsorted'

// Segment d'URL de son `See all` (`/decks/folders/unsorted`) : jamais un
// UUID, résolu par `unsortedFolderPage()` plutôt que par `getFolder()`.
export const UNSORTED_FOLDER_SLUG = 'unsorted'
