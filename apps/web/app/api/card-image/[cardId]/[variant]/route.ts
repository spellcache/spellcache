// Proxy de vignettes : sert `small` et `art_crop`, écrit sur le
// volume disque à la première demande, répond ensuite en cache immuable sans
// requête sortante. Les grandes images (`normal`, `png`) ne passent pas par
// ici — servies directement par le CDN Scryfall (`packages/core/src/images.ts#largeUrl`).
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { cards } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { auth } from '@/lib/auth'
import { fetchScryfallImage, isScryfallImageUrl, UpstreamImageError } from '@/lib/images/upstream'
import { rateLimit } from '@/lib/redis'

// L'image telle quelle : jamais recadrée, le copyright et l'artiste doivent
// rester visibles (docs/development.md).
const THUMBNAIL_VARIANTS = ['small', 'art_crop'] as const
type ThumbnailVariant = (typeof THUMBNAIL_VARIANTS)[number]

// Assainit le `cardId` avant de construire un chemin disque — sinon
// traversée de répertoire.
const paramsSchema = z.object({
  cardId: z.uuid(),
  variant: z.enum(THUMBNAIL_VARIANTS),
})

// Les vignettes `small` et `art_crop` de Scryfall sont toujours du JPEG ; seule
// la variante `png` (hors scope du proxy) ne l'est pas.
const CONTENT_TYPE = 'image/jpeg'
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

function thumbnailsDir(): string {
  return process.env.THUMBNAILS_DIR ?? join(process.cwd(), 'thumbs')
}

function diskPath(cardId: string, variant: ThumbnailVariant): string {
  return join(thumbnailsDir(), variant, `${cardId}.jpg`)
}

// Téléchargements déclenchés sans compte, par IP : les pages partagées
// (`/s/<id>`) restent lisibles par tous, mais parcourir tout le catalogue
// remplirait le disque et ferait bannir l'IP du serveur par Scryfall.
const ANONYMOUS_MISSES_PER_WINDOW = 300
const ANONYMOUS_WINDOW_SECONDS = 600

async function allowDownload(request: Request): Promise<boolean> {
  if (await auth()) return true
  // Dernière entrée : celle qu'écrit le reverse proxy
  // (docs/self-hosting/reverse-proxy.mdx).
  const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown'
  return rateLimit(`ratelimit:card-image:${ip}`, ANONYMOUS_MISSES_PER_WINDOW, ANONYMOUS_WINDOW_SECONDS)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cardId: string; variant: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return new Response('Invalid card image request', { status: 400 })
  }
  const { cardId, variant } = parsed.data
  const path = diskPath(cardId, variant)

  const cached = await readFile(path).catch(() => null)
  if (cached) {
    return new Response(new Uint8Array(cached), {
      status: 200,
      headers: { 'Content-Type': CONTENT_TYPE, 'Cache-Control': CACHE_CONTROL },
    })
  }

  if (!(await allowDownload(request))) {
    return new Response('Too many card image requests', {
      status: 429,
      headers: { 'Retry-After': String(ANONYMOUS_WINDOW_SECONDS) },
    })
  }

  const [card] = await db
    .select({ imageUris: cards.imageUris })
    .from(cards)
    .where(eq(cards.id, cardId))
  const sourceUrl = card?.imageUris?.[variant]
  if (!sourceUrl || !isScryfallImageUrl(sourceUrl)) {
    return new Response('Card image not found', { status: 404 })
  }

  // Téléchargement plafonné, partagé entre demandes simultanées et réessayé
  // sur 429/5xx (lib/images/upstream.ts), avec le `User-Agent` de l'app : le
  // CDN de Scryfall répond `400` à celui que Node envoie par défaut.
  let bytes: Uint8Array
  try {
    bytes = await fetchScryfallImage(sourceUrl)
  } catch (error) {
    const status = error instanceof UpstreamImageError ? `HTTP ${error.status}` : 'unreachable'
    return new Response(`Card image unavailable (upstream ${status})`, { status: 502 })
  }

  // Fichier temporaire puis renommage : un arrêt en pleine écriture ne laisse
  // jamais une vignette tronquée, servie ensuite en cache immuable.
  await mkdir(join(thumbnailsDir(), variant), { recursive: true })
  const partial = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(partial, bytes)
    await rename(partial, path)
  } catch {
    await rm(partial, { force: true })
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': CONTENT_TYPE, 'Cache-Control': CACHE_CONTROL },
  })
}
