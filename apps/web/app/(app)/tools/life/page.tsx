// Compteur de vie — setup et partie. Composant serveur : garde de session
// puis garde d'outil — `/tools/life` répond 404 exactement comme `/tools`
// tant qu'aucun outil n'est actif, le prédicat venant de `lib/tools/tools.ts`.
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { anyToolEnabled } from '@/lib/tools/tools'

import { LifeTracker } from './life-tracker'

export default async function LifeTrackerPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!anyToolEnabled(tools) || !tools.lifeTracker) notFound()

  return <LifeTracker />
}
