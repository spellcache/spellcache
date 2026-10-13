// Réglages du scanner Android sur le compte (`lib/scanner/settings.ts`),
// lus et écrits par l'activité native avec le cookie de session de la
// WebView, comme `/api/scanner/lookup`.
import { auth } from '@/lib/auth'
import { getScannerSettings, saveScannerSettings, scannerSettingsSchema } from '@/lib/scanner/settings'
import { getToolFlags } from '@/lib/tools/tool-flags'

const MAX_BODY_BYTES = 4 * 1024

async function scannerUser(): Promise<string | Response> {
  const session = await auth()
  const user = session?.user
  if (!user?.id || !user.username) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tools = await getToolFlags(user.id)
  if (!tools.card_scanner) return Response.json({ error: 'not_found' }, { status: 404 })
  return user.id
}

export async function GET(): Promise<Response> {
  const userId = await scannerUser()
  if (userId instanceof Response) return userId
  return Response.json({ settings: await getScannerSettings(userId) }, { headers: { 'Cache-Control': 'no-store' } })
}

// JSON seulement : un formulaire d'un autre site ne peut pas envoyer ce
// type sans requête préalable (CORS), que ce serveur n'autorise pas.
export async function PUT(request: Request): Promise<Response> {
  const userId = await scannerUser()
  if (userId instanceof Response) return userId
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'unsupported_media_type' }, { status: 415 })
  }
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return Response.json({ error: 'too_large' }, { status: 413 })

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return Response.json({ error: 'invalid' }, { status: 400 })
  }
  const parsed = scannerSettingsSchema.safeParse(json)
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 })

  return Response.json({ settings: await saveScannerSettings(userId, parsed.data) })
}
