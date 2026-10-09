// Healthcheck HTTP du conteneur `web` (comme `worker`, pour que les cinq
// services apparaissent `healthy`). Sondé toutes les 15 s par Docker, donc
// délibérément bon marché : un aller-retour `select 1` prouve que le pool
// Postgres répond, rien de plus.
//
// Publique et sans donnée : la sonde tourne à l'intérieur du réseau du
// Compose, avant toute session. Aucune information de compte n'y transite, et
// `middleware.ts` ne couvre pas `/api/*`.
import { sql } from 'drizzle-orm'

import { db } from '@spellcache/db'

// Jamais prérendue ni mise en cache : une sonde qui répond depuis un cache
// statique dirait « sain » d'un process qui ne l'est plus.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

  try {
    await db.execute(sql`select 1`)
  } catch (error) {
    console.error('[health] database unreachable', error)
    return new Response(JSON.stringify({ status: 'error', database: 'unreachable' }), {
      status: 503,
      headers,
    })
  }

  return new Response(JSON.stringify({ status: 'ok', database: 'ok' }), {
    status: 200,
    headers,
  })
}
