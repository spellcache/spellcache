// Partie de test d'un deck. Composant serveur : garde de session, garde
// d'outil, puis lecture du deck — introuvable, hors de portée ou pas un
// deck, la route répond 404.
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { isToolEnabled } from '@/lib/tools/tools'

import { getPlaytestDeck } from '../playtest-data'
import { Playtest } from './playtest'

export default async function PlaytestDeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!isToolEnabled('playtest', tools)) notFound()

  const { deckId } = await params
  const deck = await getPlaytestDeck(session.id, deckId)
  if (!deck) notFound()

  return <Playtest deck={deck} />
}
