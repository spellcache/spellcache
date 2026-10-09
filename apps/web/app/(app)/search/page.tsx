// Garde de session : toute route de `app/(app)/` exige une session valide et
// un username défini — cet onglet est un composant client (debounce/état
// local), scindé pour porter la garde côté serveur.
import { requireSession } from '@/lib/auth-guards'

import { SearchView } from './search-view'

export default async function SearchPage() {
  await requireSession()
  return <SearchView />
}
