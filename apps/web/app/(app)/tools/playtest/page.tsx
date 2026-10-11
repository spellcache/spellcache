// Playtest — choix du deck à tester. Composant serveur : garde de session
// puis garde d'outil, `/tools/playtest` répond 404 comme `/tools` tant que
// l'outil est éteint (prédicat de `lib/tools/tools.ts`). La liste est celle
// de l'écran `Decks`, sans requête propre.
import { notFound } from 'next/navigation'

import { DeckRow } from '@/components/decks/deck-row'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { listDecks } from '@/app/(app)/decks/decks-data'
import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { isToolEnabled } from '@/lib/tools/tools'

export default async function PlaytestPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!isToolEnabled('playtest', tools)) notFound()

  const { decks, currency } = await listDecks(session.id)

  return (
    <Screen header={<ScreenHeader title="Playtest" breadcrumb="Tools" backHref="/tools" />}>
      {decks.length === 0 ? (
        <p className="px-4 text-body leading-normal text-text-2">
          No deck yet. Create one in the Decks tab, then come back to test it.
        </p>
      ) : (
        <div className="flex flex-col gap-11">
          {decks.map((deck) => (
            <DeckRow key={deck.id} deck={deck} currency={currency} href={`/tools/playtest/${deck.id}`} />
          ))}
        </div>
      )}
    </Screen>
  )
}
