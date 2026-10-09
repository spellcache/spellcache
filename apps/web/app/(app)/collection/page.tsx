// Écran d'accueil `Collection home · Compact`, en composant serveur : une
// seule requête agrégée (`getCollectionHome`, collection-data.ts) hydrate
// directement `CollectionView`, jamais un second aller-retour côté client.
import { requireSession } from '@/lib/auth-guards'
import { isTestMailTransport } from '@/lib/mail/resend'

import { CollectionView } from './collection-view'
import { getCollectionHome, getCollectionShelves, getCollectionStyle } from './collection-data'
import { ShelvesView } from './shelves-view'

function CollectionErrorState() {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40">
      <p className="px-16 py-16 text-center text-body text-danger">
        Something went wrong. Try again.
      </p>
    </div>
  )
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | Array<string> | undefined>>
}) {
  const user = await requireSession()

  try {
    // `__forceError` (jamais actif en production, sauf sur le build servi aux
    // tests e2e, reconnaissable à son transport de mail de test) : un composant serveur ne
    // peut pas voir sa panne simulée par interception réseau côté
    // Playwright (« erreur serveur simulée ») — même patron que
    // `MAGIC_LINK_DEBUG_FILE` pour rendre un
    // parcours serveur testable de bout en bout sans affaiblir la garde de
    // production.
    const params = await searchParams
    if (
      (process.env.NODE_ENV !== 'production' || isTestMailTransport()) &&
      params.__forceError !== undefined
    ) {
      throw new Error('Forced error for e2e test.')
    }

    // `getCollectionStyle` (une requête dédiée, `collection-data.ts`) plutôt
    // que de lire `collectionStyle` sur `getCollectionHome` : ce dernier
    // agrège binders/lists/decks/compteurs (2 requêtes SQL) qui seraient
    // entièrement jetées ici quand le style vaut `'shelves'`. `'shelves'`
    // charge `getCollectionShelves` (son propre budget de requêtes SQL) et
    // rend `ShelvesView` ; toute autre valeur charge `getCollectionHome` et
    // reste sur `CollectionView`.
    const style = await getCollectionStyle(user.id)
    if (style === 'shelves') {
      const shelves = await getCollectionShelves(user.id)
      return <ShelvesView initial={shelves} />
    }
    const data = await getCollectionHome(user.id)
    return <CollectionView initial={data} />
  } catch {
    return <CollectionErrorState />
  }
}
