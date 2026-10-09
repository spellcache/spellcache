// Page publique en lecture seule. Elle se compose **exclusivement** des
// blocs et des tokens déjà livrés — le bloc d'en-tête
// illustré des binders (`components/binders/binder-header.tsx`, sans ses quatre
// commandes), la puce de statut des decks (`components/decks/status-chip.tsx`)
// et la ligne de liste du builder (`components/decks/slot-row.tsx`). Aucune
// couleur, aucun rayon, aucun espacement hors des tokens `@theme`.
//
// Composant serveur de bout en bout : le seul enfant client est le bouton de
// copie, qui ne reçoit **aucune** donnée du container (il lit
// `window.location.href`). La charge utile RSC de cette page ne peut donc
// porter que ce que le rendu affiche — pas une colonne lue en chemin.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { z } from 'zod'

import { ArtCredit } from '@/components/cards/art-credit'
import { StatusChip } from '@/components/decks/status-chip'
import { SlotRow } from '@/components/decks/slot-row'
import {
  BACKDROP_FADE_MASK,
  BACKDROP_SCRIM,
  binderBackdropGradient,
  isGradientKey,
} from '@/lib/binders/gradients'
import { FORMAT_LABELS } from '@/lib/decks/legality'
import { formatCount, formatMoney } from '@/lib/format/money'
import { getPublicContainer, type PublicContainer } from '@/lib/sharing/public-container'

import { CopyLinkButton } from './copy-link-button'

// Rendue à chaque requête : aucune entrée de cache de route complète, donc
// aucune page à purger quand le container repasse `private`. Next émet
// alors `Cache-Control: private, no-cache, no-store,
// max-age=0, must-revalidate` sur la réponse — ni le navigateur ni un CDN
// intermédiaire ne peuvent resservir une page dépubliée. `setVisibilityAction`
// appelle en plus `revalidatePath('/s/<id>')`, ceinture et bretelles.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const paramsSchema = z.object({ containerId: z.uuid() })

// `cache()` dédoublonne la lecture entre `generateMetadata` et le rendu :
// une seule paire de requêtes par requête HTTP, pas deux.
const loadPublicContainer = cache(
  async (containerId: string): Promise<PublicContainer | null> => {
    return getPublicContainer(containerId)
  },
)

async function resolveContainer(
  params: Promise<{ containerId: string }>,
): Promise<PublicContainer | null> {
  // Le segment d'URL est une entrée externe : validé par Zod avant toute
  // requête (docs/development.md), jamais casté.
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) return null
  return loadPublicContainer(parsed.data.containerId)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ containerId: string }>
}): Promise<Metadata> {
  const container = await resolveContainer(params)
  // Un container privé ou inexistant ne se décrit pas : même titre neutre
  // que n'importe quelle 404, aucune fuite par les métadonnées.
  if (!container) return { title: 'Not found' }

  const cardCount = totalCards(container)
  const kindLabel = container.kind === 'deck' ? 'Deck' : 'Binder'
  const formatLabel = container.format ? FORMAT_LABELS[container.format] : kindLabel
  const description = `${formatLabel} · ${formatCount(cardCount)} cards · shared by @${container.ownerUsername}`

  return {
    // Sans `metadataBase`, Next résout l'URL de l'image Open Graph sur
    // `http://localhost:3000` — un lien mort pour tout robot social dès que
    // l'application est servie ailleurs. L'origine
    // est déduite de la requête elle-même plutôt que d'une variable
    // d'environnement à tenir à jour : la page est déjà `force-dynamic`,
    // lire les en-têtes ne coûte donc aucun rendu statique perdu.
    metadataBase: await requestOrigin(),
    title: `${container.name} · spellcache`,
    description,
    // `openGraph.images` est volontairement absent : Next y place lui-même
    // l'image produite par `opengraph-image.tsx` du même segment. La
    // renseigner ici l'écraserait.
    openGraph: {
      type: 'article',
      title: container.name,
      description,
    },
  }
}

async function requestOrigin(): Promise<URL | undefined> {
  const list = await headers()
  const host = list.get('x-forwarded-host') ?? list.get('host')
  if (!host) return undefined
  const protocol =
    list.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  try {
    return new URL(`${protocol}://${host}`)
  } catch {
    return undefined
  }
}

function totalCards(container: PublicContainer): number {
  return container.cards.reduce((sum, card) => sum + card.qty, 0)
}

export default async function PublicContainerPage({
  params,
}: {
  params: Promise<{ containerId: string }>
}) {
  const container = await resolveContainer(params)
  // Privé, inexistant, non partageable ou identifiant malformé : une seule
  // et même réponse 404. L'URL ne dit jamais
  // si un container existe.
  if (!container) notFound()

  const gradient =
    container.coverGradient && isGradientKey(container.coverGradient)
      ? container.coverGradient
      : null
  const hasCover = container.coverArtUrl !== null || gradient !== null

  return (
    <main className="h-dvh overflow-y-auto px-16 py-20">
      {/* Même construction que l'écran de binder (`binder-header.tsx`) : le
          bloc ne fait que la hauteur de son titre, le fond est un calque
          posé derrière qui déborde sous la liste en s'effaçant. */}
      <div className="relative -mx-16 -mt-20 mb-14">
        {hasCover && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-binder-backdrop overflow-hidden"
          >
            {container.coverArtUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne */}
                <img
                  src={container.coverArtUrl}
                  alt=""
                  className="h-binder-backdrop-image w-full object-cover opacity-50"
                />
                <div className="absolute inset-0 bg-gradient-binder-backdrop-art" />
              </>
            ) : gradient ? (
              <>
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: binderBackdropGradient(gradient),
                    maskImage: BACKDROP_FADE_MASK,
                    WebkitMaskImage: BACKDROP_FADE_MASK,
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{ backgroundImage: BACKDROP_SCRIM }}
                />
              </>
            ) : null}
          </div>
        )}

        <div className="relative flex flex-col px-16 pt-binder-title-gap">
          <h1 className="text-title-binder font-extrabold tracking-title-binder text-shadow-binder-title text-text">
            {container.name}
          </h1>
          <div className="mt-4 text-body text-text/75">
            {formatCount(totalCards(container))} cards ·{' '}
            {formatMoney(container.valueMinor, container.currency)}
          </div>
          <div className="mt-4 text-meta text-text-2">
            Shared by @{container.ownerUsername}
          </div>
          {container.coverArtUrl && <ArtCredit artist={container.coverArtist} />}
        </div>
      </div>

      {container.status && (
        <div className="mb-14 flex items-center gap-8">
          <StatusChip status={container.status} />
        </div>
      )}

      <CopyLinkButton />

      <div className="mx-4 mb-10 mt-22 flex items-baseline justify-between">
        <div className="text-section-label font-semibold uppercase tracking-section-label text-text-2">
          Cards
        </div>
        <div className="text-meta text-text-2">
          {formatCount(container.cards.length)} unique
        </div>
      </div>

      {container.cards.length === 0 ? (
        <p className="px-16 py-16 text-center text-body text-text-2">
          This list is empty.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {container.cards.map((card, index) => (
            <SlotRow
              key={`${card.setCode}-${card.collectorNumber}-${index}`}
              thumbUrl={card.thumbUrl}
              name={card.name}
              manaCost={card.manaCost}
              setLine={`${card.setCode.toUpperCase()} #${card.collectorNumber}`}
              need={card.qty}
              // Aucune affirmation de possession sur une page publique
              // — voir `SlotRow`.
              state="unknown"
              priceLabel={
                card.priceMinor === null
                  ? '—'
                  : formatMoney(card.priceMinor, container.currency)
              }
            />
          ))}
        </div>
      )}

      {/* Page lisible sans compte, donc hors de Settings › About : la source
          des données et des images y est créditée directement. */}
      <p className="mt-22 text-center text-meta text-text-3">
        Card data and images by{' '}
        <a href="https://scryfall.com" className="text-text-2" rel="noopener noreferrer">
          Scryfall
        </a>
      </p>
    </main>
  )
}
