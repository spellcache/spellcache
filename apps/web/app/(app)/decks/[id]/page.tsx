// Écran `Planning deck · commander backdrop`, en composant serveur : deux
// requêtes agrégées hydratent directement `DeckView`, même patron que
// `app/(app)/container/[id]/page.tsx`. `getContainerHeader` reste la seule
// source de `coverGradient`/`coverCardId`/`coverArtUrl`/`coverIntensity` —
// `getDeck` ne duplique pas ces champs (le contrat de `DeckDetail` ne les
// porte pas).
import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { isToolEnabled } from '@/lib/tools/tools'
import { CollectionAccessProvider } from '@/lib/collections/access-context'

import { DeckView } from './deck-view'
import { getDeck } from './deck-data'
import { getContainerHeader } from '@/app/(app)/container/[id]/holdings-data'

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession()
  const { id } = await params

  const [deck, header, tools] = await Promise.all([
    getDeck(user.id, id),
    getContainerHeader(user.id, id),
    getToolFlags(user.id),
  ])

  // `canEdit` de la collection de CE deck, pas de l'active (lien direct).
  return (
    <CollectionAccessProvider canEdit={header.canEdit}>
      <DeckView
        deckId={id}
        initialDeck={deck}
        initialHeader={header}
        playtestEnabled={isToolEnabled('playtest', tools)}
      />
    </CollectionAccessProvider>
  )
}
