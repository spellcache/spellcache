// Écran d'un set (`Search › Sets › <code>`), composant serveur : il ne lit
// que l'entête du set, ses cartes venant de la même recherche de catalogue que
// l'onglet `Search` — un set *est* une recherche, restreindre l'écran revient
// donc à poser une question plus étroite au serveur, jamais à masquer des
// lignes déjà chargées.
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'

import { sets } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { db } from '@spellcache/db'

import { SetDetailView } from './set-detail-view'

export default async function SetPage({ params }: { params: Promise<{ code: string }> }) {
  await requireSession()
  const { code } = await params

  const [row] = await db
    .select({
      code: sets.code,
      name: sets.name,
      releasedAt: sets.releasedAt,
      iconSvgUri: sets.iconSvgUri,
      cardCount: sets.cardCount,
      setType: sets.setType,
    })
    .from(sets)
    .where(eq(sets.code, code.toLowerCase()))
    .limit(1)

  if (!row) notFound()

  return <SetDetailView set={row} />
}
