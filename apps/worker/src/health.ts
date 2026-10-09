// Healthcheck HTTP du conteneur `worker` (comme `web`). Le worker n'expose
// aucune route applicative : ce petit serveur `node:http` est le seul port
// qu'il ouvre, et il n'est joignable que depuis le réseau du Compose (aucune
// publication de port dans `docker-compose.example.yml`).
//
// Il répond `200` tant que la boucle de consommation a donné signe de vie
// récemment, `503` sinon — un process vivant dont la boucle est bloquée sur un
// Redis injoignable doit être redémarré, pas déclaré sain.
import { createServer, type Server } from 'node:http'

export const DEFAULT_HEALTH_PORT = 8081

// La boucle repart au plus tard toutes les `POP_TIMEOUT_SECONDS` (5 s) quand
// la file est vide, mais un job long (import bulk) la tient occupée sans
// battement. Le seuil doit donc couvrir la durée d'un job, pas celle d'un tour
// de boucle : un import bulk dépasse rarement l'heure.
export const HEARTBEAT_TIMEOUT_MS = 90 * 60 * 1000

export interface HealthState {
  lastBeatAt: number
  startedAt: number
}

export function createHealthState(now: number = Date.now()): HealthState {
  return { lastBeatAt: now, startedAt: now }
}

export function beat(state: HealthState, now: number = Date.now()): void {
  state.lastBeatAt = now
}

export function isHealthy(state: HealthState, now: number = Date.now()): boolean {
  return now - state.lastBeatAt <= HEARTBEAT_TIMEOUT_MS
}

function resolvePort(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_HEALTH_PORT
}

export function startHealthServer(
  state: HealthState,
  port: number = resolvePort(process.env.WORKER_HEALTH_PORT),
): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end()
      return
    }
    const healthy = isHealthy(state)
    response.writeHead(healthy ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    })
    response.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'stalled',
        lastBeatAt: new Date(state.lastBeatAt).toISOString(),
        startedAt: new Date(state.startedAt).toISOString(),
      }),
    )
  })

  server.listen(port, () => {
    console.log(`[worker] health server listening on :${port}/health`)
  })
  // Ne retient pas la boucle d'événements : le process vit par sa boucle de
  // consommation, pas par ce serveur.
  server.unref()
  return server
}
