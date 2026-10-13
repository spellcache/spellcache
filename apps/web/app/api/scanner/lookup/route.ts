// Lecture du scanner Android : le texte reconnu sur une carte (code de set,
// numéro, lignes candidates au nom) contre le catalogue local. Appelée par
// l'activité native avec le cookie de session de la WebView, hors de toute
// page : une route plutôt qu'une Server Action.
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/redis'
import { confirmedByName, lookupScannedCardIn, MAX_SCANNED_NAMES } from '@/lib/scanner/lookup'
import { getScannerSettings } from '@/lib/scanner/settings'
import { holdingLanguageOf } from '@/lib/scanner/scan-text'
import { getToolFlags } from '@/lib/tools/tool-flags'

const querySchema = z.object({
  set: z.string().trim().max(8).optional(),
  number: z.string().trim().max(12).optional(),
  lang: z.string().trim().max(4).optional(),
  names: z.array(z.string().max(160)).max(MAX_SCANNED_NAMES),
  // `1` : rareté `T` lue, un jeton.
  token: z.literal('1').optional(),
})

// Le scanner limite déjà ses lectures (une par texte stable) : ce plafond ne
// coupe qu'un client qui boucle.
const LOOKUPS_PER_WINDOW = 600
const WINDOW_SECONDS = 600

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  const user = session?.user
  if (!user?.id || !user.username) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const tools = await getToolFlags(user.id)
  if (!tools.card_scanner) return Response.json({ error: 'not_found' }, { status: 404 })

  const params = new URL(request.url).searchParams
  const parsed = querySchema.safeParse({
    set: params.get('set') ?? undefined,
    number: params.get('number') ?? undefined,
    lang: params.get('lang') ?? undefined,
    names: params.getAll('name'),
    token: params.get('token') ?? undefined,
  })
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 })

  if (!(await rateLimit(`ratelimit:scanner:${user.id}`, LOOKUPS_PER_WINDOW, WINDOW_SECONDS))) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_SECONDS) } },
    )
  }

  // Filtre de sets des réglages du compte : le même pour toutes les lectures.
  const { sets = [] } = await getScannerSettings(user.id)
  const { match, outsideSets } = await lookupScannedCardIn(
    {
      setCode: parsed.data.set,
      collectorNumber: parsed.data.number,
      names: parsed.data.names,
      token: parsed.data.token === '1',
    },
    sets,
  )
  // Langue du holding déduite du code imprimé, proposée par l'écran de revue.
  return Response.json(
    {
      match: match && { ...match, language: holdingLanguageOf(parsed.data.lang) },
      confirmed: match !== null && confirmedByName(match, parsed.data.names),
      outsideSets,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
