// Impressions de la carte scannée (`?cardId=`), pour le choix d'édition du
// scanner Android, avec le cookie de session de la WebView comme
// `/api/scanner/lookup`.
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { listPrintingsOf } from '@/lib/scanner/lookup'
import { getToolFlags } from '@/lib/tools/tool-flags'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  const user = session?.user
  if (!user?.id || !user.username) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tools = await getToolFlags(user.id)
  if (!tools.card_scanner) return Response.json({ error: 'not_found' }, { status: 404 })

  const cardId = z.uuid().safeParse(new URL(request.url).searchParams.get('cardId'))
  if (!cardId.success) return Response.json({ error: 'invalid' }, { status: 400 })

  return Response.json(
    { printings: await listPrintingsOf(cardId.data) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
