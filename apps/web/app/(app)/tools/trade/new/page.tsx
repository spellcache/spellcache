// Parcours de création d'un échange, étape 1 : avec qui. Composant serveur :
// mêmes gardes que les autres pages de l'outil ; l'échange n'existe qu'une
// fois cette étape validée.
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'

import { WhoStep } from './who-step'

export default async function NewTradePage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.trading_mode) notFound()

  return <WhoStep />
}
