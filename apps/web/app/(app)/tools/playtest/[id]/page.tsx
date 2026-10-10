// Playtest d'un deck. Composant serveur : garde de session, garde d'outil,
// puis autorisation du deck — un identifiant mal formé, un deck d'une autre
// collection ou un container qui n'est pas un deck répondent tous 404.
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'

import { getPlaytestDeck } from '../playtest-data'
import { Playtest } from './playtest'

const idSchema = z.uuid()

export default async function PlaytestDeckPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.playtest) notFound()

  const parsed = idSchema.safeParse((await params).id)
  if (!parsed.success) notFound()

  const detail = await getPlaytestDeck(session.id, parsed.data)
  if (!detail) notFound()

  return (
    <Playtest name={detail.name} formatLabel={detail.formatLabel} deck={detail.deck} />
  )
}
