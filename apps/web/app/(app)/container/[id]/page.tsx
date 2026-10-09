// Écran de container (`searchParams` lu côté serveur pour que la première
// page reflète déjà la vue partagée par l'URL), en composant
// serveur : une requête d'en-tête et une première page de holdings filtrée
// hydratent directement `ContainerView`, même patron que
// `app/(app)/collection/page.tsx`. `ContainerView` appelle
// `useSearchParams` (qui force le rendu client) —
// encapsulé dans `<Suspense>` ici, sinon le build de production échoue sur
// les pages statiques.
import { Suspense } from 'react'

import { requireSession } from '@/lib/auth-guards'
import { CollectionAccessProvider } from '@/lib/collections/access-context'
import { parseViewState } from '@/lib/view-state/parse'

import { ContainerView } from './container-view'
import { getContainerHeader, listHoldings } from './holdings-data'

function ContainerErrorState() {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-16 pt-20 pb-28 desktop:px-20 desktop:pt-30 desktop:pb-40">
      <p className="px-16 py-16 text-center text-body text-danger">
        Something went wrong. Try again.
      </p>
    </div>
  )
}

// `searchParams` de Next.js (valeurs uniques ou répétées) converti en
// `URLSearchParams` — l'unique format que `parseViewState` accepte —
// première valeur seulement pour un paramètre répété,
// jamais castée sans passer par `parseViewState` ensuite.
function toURLSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    params.set(key, Array.isArray(value) ? (value[0] ?? '') : value)
  }
  return params
}

export default async function ContainerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireSession()
  const { id } = await params
  const rawSearchParams = await searchParams
  const viewState = parseViewState(toURLSearchParams(rawSearchParams))

  try {
    const [header, page] = await Promise.all([
      getContainerHeader(user.id, id),
      listHoldings(user.id, id, {
        query: viewState.query,
        filters: viewState.filters,
        sort: viewState.sort,
        groupBy: viewState.groupBy,
      }),
    ])

    // `canEdit` de la collection de CE container, pas de l'active (lien direct).
    return (
      <CollectionAccessProvider canEdit={header.canEdit}>
        <Suspense>
          <ContainerView containerId={id} initial={{ header, page }} />
        </Suspense>
      </CollectionAccessProvider>
    )
  } catch {
    return <ContainerErrorState />
  }
}
