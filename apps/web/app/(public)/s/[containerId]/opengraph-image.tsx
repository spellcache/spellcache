// Image de partage : l'`art_crop` de la carte de couverture, ou une image de
// repli si aucune.
//
// Cette route **ne fabrique pas** d'image : elle redirige vers le proxy de
// vignettes déjà livré (`app/api/card-image/[cardId]/[variant]/route.ts`),
// seul endroit du projet autorisé à servir une illustration de carte.
// Trois raisons de ne pas composer l'image ici :
//
//  - le proxy porte déjà le cache disque, le repli 404 et l'en-tête
//    `immutable` ; le dupliquer ferait deux chemins de cache à maintenir, et
//    la variante `art_crop` serait retéléchargée à chaque scrutation d'un
//    robot social ;
//  - le recadrage `art_crop` vient du fichier bulk, l'URL n'est jamais
//    construite à la main et l'image n'est jamais recoupée (docs/development.md) ;
//  - composer une image (fond, texte, typographie) demanderait des couleurs
//    littérales, qu'aucun composant n'a le droit de porter (docs/development.md — seuls
//    `app/globals.css` et `lib/binders/gradients.ts` en portent), et
//    inventerait un langage visuel absent du design validé.
//
// Les robots sociaux (et `APIRequestContext` de Playwright) suivent les
// redirections d'`og:image`.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { thumbUrl } from '@spellcache/core/images'
import { getPublicCoverCard } from '@/lib/sharing/public-container'

// Jamais mise en cache : un container repassé `private` doit rendre son
// image inaccessible aussi vite que sa page. La cible de
// la redirection, elle, reste `immutable` — l'illustration d'une carte ne
// change pas, et son URL ne dit rien du container.
const NO_STORE = 'no-store, max-age=0, must-revalidate'

export const dynamic = 'force-dynamic'
export const alt = 'Shared list on spellcache'

// Image de repli : l'icône de l'application déjà livrée
// (`public/icons/`), servie telle
// quelle. Aucun asset nouveau, aucun pixel dessiné ici.
const FALLBACK_PATH = ['public', 'icons', 'spellcache-icon-512.png']

const paramsSchema = z.object({ containerId: z.uuid() })

export default async function OpengraphImage({
  params,
}: {
  params: { containerId: string }
}): Promise<Response> {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return notFound()

  const cover = await getPublicCoverCard(parsed.data.containerId)
  // Privé, inexistant ou non partageable : 404, comme la page.
  if (!cover) return notFound()

  if (cover.coverCardId) {
    return new Response(null, {
      status: 307,
      headers: {
        Location: thumbUrl(cover.coverCardId, 'art_crop'),
        'Cache-Control': NO_STORE,
      },
    })
  }

  const bytes = await readFile(join(process.cwd(), ...FALLBACK_PATH))
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': NO_STORE },
  })
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': NO_STORE } })
}
