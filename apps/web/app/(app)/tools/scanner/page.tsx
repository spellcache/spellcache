// Scanner de cartes : revue des cartes scannées par l'app Android avant leur
// ajout. Composant serveur : garde de session puis garde d'outil, comme les
// autres routes de `/tools`.
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/auth-guards'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { requireCollectionAccess, canWrite } from '@/lib/collections/authorize'
import { listScanDestinations } from '@/lib/scanner/review'
import { getScannerSettings } from '@/lib/scanner/settings'
import { getToolFlags } from '@/lib/tools/tool-flags'

import { ScannerView } from './scanner-view'

export default async function ScannerPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.card_scanner) notFound()

  const { collectionId, containerId } = await bootstrapCollection(session.id, {
    username: session.username,
    displayName: null,
  })
  const access = await requireCollectionAccess(session.id, collectionId)
  const destinations = await listScanDestinations(collectionId)
  const settings = await getScannerSettings(session.id)

  return (
    <ScannerView
      destinations={destinations}
      defaultDestinationId={containerId}
      canEdit={canWrite(access.role)}
      initialSettings={settings}
    />
  )
}
