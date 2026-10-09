'use client'

// Écran de container (barre de commande, filtres/tri/groupement portés par
// l'URL), en composant client scindé de `page.tsx` (composant serveur) — même
// patron que `search-view.tsx` et `collection-view.tsx`. Reçoit la première
// page de holdings et l'en-tête déjà chargés côté serveur en props
// (`initialData` de TanStack Query), pas de second aller-retour au montage —
// `page.tsx` lit désormais aussi les search params pour que ce premier
// rendu reflète déjà la vue partagée.
//
// `useSearchParams` est l'unique lecture/écriture des search params de cet
// écran (il force le rendu client, d'où le `<Suspense>` posé par
// `page.tsx`) — `CommandBar` et les feuilles ne détiennent aucun état d'URL,
// seulement `ViewState`/`onViewStateChange`.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ArrowDownUp } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  ContainerActionSheets,
  lookFromHeader,
} from '@/components/binders/container-action-sheets'
import {
  BinderHeader,
  BinderBackdropArt,
  BinderHeaderBackdrop,
  BinderTitleMeta,
  binderHasCover,
} from '@/components/binders/binder-header'
import { CardRow } from '@/components/cards/card-row'
import { CompactRow } from '@/components/cards/compact-row'
import { GridTile } from '@/components/cards/grid-tile'
import { CardSheet } from '@/components/cards/card-sheet'
import { EditCardSheet } from '@/components/cards/edit-card-sheet'
import { EditListCardSheet } from '@/components/cards/edit-list-card-sheet'
import { VirtualList } from '@/components/cards/virtual-list'
import { CommandBar } from '@/components/command-bar/command-bar'
import { PreviewPane } from '@/components/desktop/preview-pane'
import { useMinWidth } from '@/components/desktop/use-min-width'
import { ActionBar } from '@/components/selection/action-bar'
import {
  BulkEditSheet,
  type BulkEditFormValue,
} from '@/components/selection/bulk-edit-sheet'
import { rowVisualState } from '@/components/selection/row-visual-state'
import { useSelection } from '@/components/selection/selection-provider'
import { ImportExportSheet } from '@/components/collection/import-export-sheet'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import { UndoToast } from '@/components/ui/undo-toast'
import { updatePreferenceAction } from '@/app/(app)/settings/preferences-actions'
import { BREAKPOINTS } from '@/lib/breakpoints'
import { useCanEdit } from '@/lib/collections/access-context'
import type { BulkTarget } from '@/lib/containers/bulk'
import { formatCount, formatMoney } from '@/lib/format/money'
import { queryKeys } from '@/lib/query/keys'
import { countActiveFilters, parseViewState, toSearchParams, type ViewState } from '@/lib/view-state/parse'

import {
  countHoldingsAction,
  getCardPreviewAction,
  getContainerHeaderAction,
  listHoldingsAction,
  setQuantityAction,
  undoAction,
  updateHoldingAction,
} from './actions'
import { AddCardSheet } from './add-card-sheet'
import {
  bulkDeleteAction,
  bulkEditAction,
  bulkUndoAction,
  type BulkActionResult,
} from './bulk-actions'
import {
  createBulkDeleteMutationOptions,
  createBulkEditMutationOptions,
  createPatchMutationOptions,
  createQuantityMutationOptions,
  createUndoHandler,
} from './mutations'
import type { ContainerHeader, HoldingPage, HoldingRow } from './holdings-data'

function priceLabel(priceMinor: number | null, currency: 'usd' | 'eur'): string {
  return priceMinor === null ? '—' : formatMoney(priceMinor, currency)
}

interface UndoState {
  undoToken: string
  message: string
  // Les jetons d'action groupée (`lib/containers/bulk.ts`) vivent dans un
  // magasin distinct de ceux d'une mutation unique
  // (`lib/containers/holdings.ts`) — `kind` route `UndoToast.onUndo` vers le
  // bon rejoueur (`bulkUndoAction` contre `handleUndo`/`undoAction`), un seul
  // jeton actif à la fois quel que soit son type.
  kind: 'single' | 'bulk'
}

function bulkResultMessage(affected: number, verb: string): string {
  return `${affected} ${affected === 1 ? 'card' : 'cards'} ${verb}`
}

export function ContainerView({
  containerId,
  initial,
}: {
  containerId: string
  initial: { header: ContainerHeader; page: HoldingPage }
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Lecture seule (`viewer`), posée par `page.tsx` pour la collection de CE
  // container : ni ajout, ni menu, ni sélection groupée, ni stepper.
  const canEdit = useCanEdit()

  const viewState = useMemo(() => parseViewState(searchParams), [searchParams])
  const viewKey = useMemo(() => toSearchParams(viewState).toString(), [viewState])
  // Signature de la vue au tout premier rendu (`initial.page` vient de
  // `page.tsx`, filtré par les mêmes search params) — capturée une seule fois
  // (`useState`, jamais recalculée) pour ne servir d'`initialData` qu'à cette
  // vue précise ; toute autre combinaison de filtres/tri obtient sa propre clé
  // et va chercher sa propre première page.
  const [initialViewKey] = useState(viewKey)

  const handleViewStateChange = useCallback(
    (next: ViewState) => {
      const qs = toSearchParams(next).toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname],
  )

  const holdingsKey = useMemo(
    () => [...queryKeys.containerHoldings(containerId), viewKey],
    [containerId, viewKey],
  )
  const headerKey = queryKeys.containerHeader(containerId)

  const headerQuery = useQuery({
    queryKey: headerKey,
    queryFn: () => getContainerHeaderAction(containerId),
    initialData: initial.header,
  })
  const header = headerQuery.data

  const holdingsQuery = useInfiniteQuery({
    queryKey: holdingsKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      listHoldingsAction({
        containerId,
        cursor: pageParam,
        query: viewState.query,
        filters: viewState.filters,
        sort: viewState.sort,
        groupBy: viewState.groupBy,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => ('error' in lastPage ? null : lastPage.nextCursor),
    initialData:
      viewKey === initialViewKey
        ? { pages: [initial.page], pageParams: [null] }
        : undefined,
  })

  const items = useMemo(
    () =>
      holdingsQuery.data?.pages.flatMap((page) => ('error' in page ? [] : page.items)) ??
      [],
    [holdingsQuery.data],
  )

  // En-tête repliable puis collant d'un binder à fond (demande produit) :
  // le défilement replie d'abord la zone vide au-dessus du titre, puis fige
  // le bloc titre/méta + la barre de commande en haut — même geste que
  // `deck-view.tsx`, porté ici par le prop `scrollHeader` de `VirtualList`
  // puisque le défilement de cet écran est celui de la liste virtualisée, pas
  // un `ScrollArea` distinct. N'engage ce patron que s'il y a des lignes à
  // faire défiler : un binder vide n'a rien à replier, `BinderHeader` (non
  // collant, intact) reste alors utilisé tel quel, comme pour un binder sans
  // fond.
  const binderCoverActive = header.kind === 'binder' && binderHasCover(header)
  const showCollapsibleBinderHeader = binderCoverActive && items.length > 0

  const stickySentinelRef = useRef<HTMLDivElement | null>(null)
  const [headerStuck, setHeaderStuck] = useState(false)
  useEffect(() => {
    const node = stickySentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) =>
      setHeaderStuck(entry ? !entry.isIntersecting : false),
    )
    observer.observe(node)
    return () => observer.disconnect()
  })

  // Hauteur mesurée de la seule portion COLLANTE (titre/méta + barre de
  // commande), distincte de la zone repliable qui la précède dans
  // `scrollHeader` — passée à `VirtualList.scrollHeaderStickyOffset` pour
  // que son en-tête de groupe actif se pose sous ce bloc, jamais
  // dessous/derrière lui, une fois collé (voir le commentaire de ce prop,
  // `components/cards/virtual-list.tsx`).
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null)
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0)

  // Décalage vertical entre le haut du fond d'art (`BinderHeaderBackdrop`,
  // hors défilement) et le haut du bloc épinglé — mesuré quand le bloc se
  // colle, pour que la copie de l'art qu'il peint alors comme fond (demande
  // produit : « garder l'art », jamais un fond opaque) s'aligne au pixel
  // avec le fond réel derrière lui.
  const backdropRootRef = useRef<HTMLDivElement | null>(null)
  const [stuckArtOffset, setStuckArtOffset] = useState(0)
  useLayoutEffect(() => {
    if (!headerStuck) return
    const artEl = backdropRootRef.current
    const stickyEl = stickyHeaderRef.current
    if (!artEl || !stickyEl) return
    setStuckArtOffset(artEl.getBoundingClientRect().top - stickyEl.getBoundingClientRect().top)
  }, [headerStuck])
  useLayoutEffect(() => {
    const el = stickyHeaderRef.current
    if (!el || !showCollapsibleBinderHeader) {
      setStickyHeaderHeight(0)
      return
    }
    const measure = () => setStickyHeaderHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showCollapsibleBinderHeader])

  const [openHoldingId, setOpenHoldingId] = useState<string | null>(null)
  const openIndex = items.findIndex((item) => item.holdingId === openHoldingId)
  const openHolding = openIndex === -1 ? null : items[openIndex]!
  // Lignes voisines dans l'ordre affiché (tri et filtres compris), pour
  // passer d'une carte à l'autre sans refermer la feuille. Seules les pages
  // déjà chargées comptent : la dernière ligne chargée n'a pas de suivante.
  const previousHolding = openIndex > 0 ? items[openIndex - 1]! : null
  const nextHolding = openIndex !== -1 && openIndex < items.length - 1 ? items[openIndex + 1]! : null
  // Feuille d'édition — distincte de la feuille de détail
  // ci-dessus, ouverte par son bouton `Edit`.
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null)
  const editingHolding = items.find((item) => item.holdingId === editingHoldingId) ?? null

  // ── Panneau d'aperçu desktop ──────────────────────────────────────────
  //
  // `previewPane` est la préférence de compte (`users.preview_pane`), lue
  // avec l'en-tête et écrite aussi bien par Settings que par la bascule
  // `panel-right` de la barre de commande — une seule valeur. `paneWidth` est
  // le tri-état de largeur : `null` avant hydratation, ce qui laisse le CSS
  // (`hidden pane:flex` sur le panneau) décider seul de la première peinture,
  // puis `true`/`false`.
  const [previewPanePref, setPreviewPanePref] = useState(initial.header.previewPane)
  const paneWidth = useMinWidth(BREAKPOINTS.previewPane)
  // Rendu (donc présent dans le DOM) tant que la largeur n'a pas dit
  // « non » ; **actif** (la ligne cliquée le remplit au lieu d'ouvrir la
  // feuille) seulement quand elle a dit « oui ».
  const renderPane = previewPanePref && paneWidth !== false
  const paneActive = previewPanePref && paneWidth === true

  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null)
  // La ligne sélectionnée est relue dans `items` à chaque rendu : supprimée
  // de la liste, elle devient `null` et le panneau se vide de lui-même
  // (le panneau doit se vider proprement quand la ligne sélectionnée est
  // supprimée).
  const selectedHolding =
    items.find((item) => item.holdingId === selectedHoldingId) ?? null

  async function handlePreviewPaneChange(next: boolean) {
    const previous = previewPanePref
    setPreviewPanePref(next)
    // Panneau éteint : plus de ligne « courante » — sans quoi elle
    // resterait surlignée en accent dans une liste qui n'a plus de panneau
    // à remplir.
    if (!next) setSelectedHoldingId(null)
    // Écriture optimiste sur le compte, avec retour arrière — le même
    // `updatePreferenceAction` que la ligne `Card preview pane` de Settings
    // donc la même colonne : un rechargement retrouve l'état.
    const result = await updatePreferenceAction({ previewPane: next })
    if (!result.ok) setPreviewPanePref(previous)
  }

  // Contenu du panneau : une lecture par ligne **sélectionnée**, jamais par
  // ligne survolée. Désactivée tant que le panneau n'est pas actif : aucune
  // requête n'est émise sous 1280px ni panneau éteint.
  const previewQuery = useQuery({
    queryKey: ['container', containerId, 'preview', selectedHolding?.cardId ?? null],
    queryFn: () =>
      getCardPreviewAction({ cardId: selectedHolding?.cardId ?? '', containerId }),
    enabled: paneActive && selectedHolding !== null,
  })

  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  // Feuilles d'action d'un binder, pilotées ici plutôt que par `BinderHeader` :
  // cet en-tête ne se voit pas au-delà de 768px, où `MainHeader` prend le
  // relais — les deux `···` (et le bouton palette de l'en-tête mobile) ouvrent
  // donc le **même** état, sur le même jeu de feuilles.
  const [binderMenuOpen, setBinderMenuOpen] = useState(false)
  const [binderLookOpen, setBinderLookOpen] = useState(false)
  // Menu léger du container racine : une seule feuille, une
  // seule ligne « Import / Export » — jamais `ContainerActionSheets`, qui
  // n'a de sens que pour un binder/une liste renommables/supprimables.
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [collectionImportExportOpen, setCollectionImportExportOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  // Quel bouton d'`ActionBar` a ouvert la feuille —
  // `Binder`/`To deck` restreignent la ligne de destination à leur seul
  // type, `Edit` montre les deux (`null`).
  const [bulkEditDestinationKind, setBulkEditDestinationKind] = useState<
    'binder' | 'deck' | null
  >(null)
  // Cible de la feuille quand elle est ouverte depuis le panneau d'aperçu
  // (binder et deck y sont éditables sur place) : la seule ligne courante, et
  // non la sélection groupée. Les deux boutons du panneau entrent dans la
  // **même** `BulkEditSheet` que `Binder`/`To deck` de la barre d'action
  // (`bulkEdit` avec `targetContainerId` déplace par `moveHoldings`) — un
  // second flux de destination aurait divergé du premier en quelques
  // semaines. `null` : la feuille vise la sélection, comme avant.
  const [paneEditHoldingId, setPaneEditHoldingId] = useState<string | null>(null)

  // Sélection groupée : contexte éphémère monté au-dessus de `TabBar`
  // (`app/(app)/layout.tsx`) — cet écran n'en est qu'un consommateur, au même
  // titre que `CompactRow`/`VirtualList`.
  const selection = useSelection()

  // Total de la vue filtrée entière (« Select all » sur 98 résultats dont 40
  // chargés affiche 98) — même Server Action que le bouton `Show N cards` de
  // la feuille `Filters`. Toujours active : la barre de commande affiche
  // `N shown` comme le total **filtré**, jamais seulement la page chargée — pas
  // uniquement après « Select all ».
  const matchingCountQuery = useQuery({
    queryKey: [...holdingsKey, 'matching-count'],
    queryFn: () =>
      countHoldingsAction({
        containerId,
        query: viewState.query,
        filters: viewState.filters,
      }),
  })
  const selectedCount = selection.allMatching
    ? (matchingCountQuery.data?.count ?? selection.ids.size)
    : selection.ids.size
  // `N shown` : le total filtré une fois connu, la page déjà
  // chargée le temps qu'il arrive — jamais l'inverse, ce qui ferait
  // régresser un compte déjà correct pendant un changement de filtre.
  const shownCount = matchingCountQuery.data?.count ?? items.length

  const bulkTarget = useMemo<BulkTarget>(
    () =>
      selection.allMatching
        ? { containerId, matching: viewState }
        : { containerId, holdingIds: [...selection.ids] },
    [selection.allMatching, selection.ids, containerId, viewState],
  )

  // Cible et compteur effectifs de la feuille d'édition : la ligne du
  // panneau quand c'est elle qui l'a ouverte, la sélection sinon.
  const bulkEditTarget = useMemo<BulkTarget>(
    () =>
      paneEditHoldingId === null
        ? bulkTarget
        : { containerId, holdingIds: [paneEditHoldingId] },
    [paneEditHoldingId, bulkTarget, containerId],
  )
  const bulkEditCount = paneEditHoldingId === null ? selectedCount : 1
  // Sélection courante, réduite au strict nécessaire pour la valeur
  // partagée de condition/quantité — seulement ce qui est
  // déjà chargé côté client : `allMatching` (« Select all ») ne peut pas
  // faire mieux sans un aller-retour serveur dédié à cette seule
  // affichage, hors du contrat de la sélection groupée.
  const bulkEditEntries = useMemo(() => {
    if (paneEditHoldingId !== null) {
      const single = items.find((item) => item.holdingId === paneEditHoldingId)
      return single ? [{ condition: single.condition, qty: single.qty }] : []
    }
    return items
      .filter((item) => selection.allMatching || selection.ids.has(item.holdingId))
      .map((item) => ({ condition: item.condition, qty: item.qty }))
  }, [paneEditHoldingId, items, selection.allMatching, selection.ids])

  function openPaneDestinationSheet(kind: 'binder' | 'deck') {
    if (!selectedHolding) return
    setPaneEditHoldingId(selectedHolding.holdingId)
    setBulkEditDestinationKind(kind)
    setBulkEditOpen(true)
  }

  function handleBulkResult(
    result: BulkActionResult,
    verb: string,
  ): { ok: true } | { ok: false; error: string } {
    if (!result.ok) {
      setErrorMessage(
        result.error === 'deck_locked'
          ? 'This deck is built and locked. Bulk actions are refused.'
          : 'Could not apply the action. Try again.',
      )
      return { ok: false, error: result.error }
    }

    setUndoState({
      undoToken: result.undoToken,
      message: bulkResultMessage(result.affected, verb),
      kind: 'bulk',
    })
    selection.clear()
    return { ok: true }
  }

  // Mise à jour optimiste des actions groupées (docs/development.md « mises à jour
  // optimistes sur toutes les quantités, avec retour arrière en cas
  // d'échec ») — même patron `cancelQueries` → `setQueryData` → rollback que
  // `qtyMutation`/`patchMutation` ci-dessous, extrait dans `./mutations.ts` :
  // un simple `invalidateQueries` après la réponse serveur laisserait les
  // lignes supprimées/périmées affichées jusqu'au round-trip complet.
  const bulkEditMutation = useMutation(
    createBulkEditMutationOptions({
      queryClient,
      holdingsKey,
      headerKey,
      bulkEditAction,
      onResult: (result) => handleBulkResult(result, 'updated'),
    }),
  )

  const bulkDeleteMutation = useMutation(
    createBulkDeleteMutationOptions({
      queryClient,
      holdingsKey,
      headerKey,
      bulkDeleteAction,
      onResult: (result) => handleBulkResult(result, 'removed'),
    }),
  )

  async function handleBulkEditSubmit(edit: BulkEditFormValue) {
    const result = await bulkEditMutation.mutateAsync({ target: bulkEditTarget, edit })
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error }
  }

  async function handleBulkDelete() {
    await bulkDeleteMutation.mutateAsync(bulkTarget)
  }

  // Options de mutation extraites de `./mutations.ts` (`cancelQueries` puis
  // `setQueryData`, rollback dans `onError`) — un test vitest les construit
  // avec une Server Action mockée et les rejoue dans l'ordre où TanStack Query
  // les invoque, sans jsdom (aucun disponible dans ce projet, voir le
  // commentaire d'en-tête de `quantities.test.ts`).
  const qtyMutation = useMutation(
    createQuantityMutationOptions({
      queryClient,
      holdingsKey,
      headerKey,
      setQuantityAction,
      getHolding: (holdingId) => items.find((item) => item.holdingId === holdingId),
      onRemoved: (undoToken, message) =>
        setUndoState({ undoToken, message, kind: 'single' }),
      onFailure: setErrorMessage,
      onRemovedWhileOpen: (holdingId) => {
        setOpenHoldingId((current) => (current === holdingId ? null : current))
        // Même geste pour le panneau d'aperçu : la ligne disparaît déjà de
        // `items`, mais laisser l'id derrière ferait ressurgir un panneau plein
        // au prochain rafraîchissement si un autre holding réutilisait cet id.
        setSelectedHoldingId((current) => (current === holdingId ? null : current))
        // Même geste pour la feuille d'édition : la
        // quantité peut atteindre 0 depuis son propre stepper, pas
        // seulement depuis la feuille de détail.
        setEditingHoldingId((current) => (current === holdingId ? null : current))
      },
    }),
  )

  // Condition et foil partagent une seule mutation optimiste : les deux
  // passent par `updateHoldingAction` (`updateHolding`), même patron
  // `cancelQueries` → `setQueryData` → rollback dans `onError`/`onSuccess` que
  // la quantité ci-dessus. Relit toujours `holdingsKey` au succès (pas
  // seulement `headerKey`) : une fusion de `updateHolding` change le
  // `holdingId` visible, une ligne fantôme sous l'ancien id resterait sinon
  // affichée.
  const patchMutation = useMutation(
    createPatchMutationOptions({
      queryClient,
      holdingsKey,
      headerKey,
      updateHoldingAction,
      onFailure: setErrorMessage,
      onMerged: (fromHoldingId, toHoldingId) => {
        setOpenHoldingId((current) => (current === fromHoldingId ? toHoldingId : current))
        setSelectedHoldingId((current) =>
          current === fromHoldingId ? toHoldingId : current,
        )
        setEditingHoldingId((current) => (current === fromHoldingId ? toHoldingId : current))
      },
    }),
  )

  const handleUndo = createUndoHandler({
    queryClient,
    holdingsKey,
    headerKey,
    undoAction,
    onExpired: setErrorMessage,
  })

  const handleEndReached = useCallback(() => {
    if (holdingsQuery.hasNextPage && !holdingsQuery.isFetchingNextPage) {
      void holdingsQuery.fetchNextPage()
    }
  }, [holdingsQuery])

  const currency = header.currency

  // Une seule instance de `CommandBar`, un seul jeu de props — placée soit
  // dans le flux normal de l'écran, soit dans `scrollHeader` de
  // `VirtualList` selon `showCollapsibleBinderHeader` (voir les deux points
  // d'usage plus bas), jamais deux implémentations qui pourraient diverger.
  const commandBarNode = (
    <CommandBar
      containerId={containerId}
      viewState={viewState}
      onViewStateChange={handleViewStateChange}
      totalCount={header.cardCount}
      currency={currency}
      searchScope={header.kind === 'collection' ? null : header.kind}
      shownCount={shownCount}
      accountDensity={header.density}
      previewPane={previewPanePref}
      onPreviewPaneChange={(next) => void handlePreviewPaneChange(next)}
      // Fond translucide sur un binder illustré — le seul écran où un fond
      // d'art occupe la colonne derrière la barre de commande (`BinderHeader`/
      // `BinderHeaderBackdrop`, voir leur commentaire de tête). Reste
      // translucide qu'elle soit figée ou non une fois collée (demande
      // produit) : c'est le fond opaque du bloc collant lui-même
      // (`headerStuck`, plus bas) qui la rend lisible, pas un changement de
      // ce prop.
      translucent={binderCoverActive}
    />
  )

  // Les deux `kind` qui ouvrent `ContainerActionSheets` — le `···` des deux
  // en-têtes et le montage des feuilles suivent cette seule valeur, jamais
  // trois conditions séparées qui pourraient diverger. Le container racine
  // (`kind === 'collection'`) n'a ni apparence, ni renommage, ni
  // suppression, mais porte son propre menu léger (`collectionMenuOpen`
  // ci-dessous, distinct de `ContainerActionSheets` qui reste réservé aux
  // binders/listes).
  const menuKind: 'binder' | 'list' | null =
    header.kind === 'binder' || header.kind === 'list' ? header.kind : null
  // Un Guest garde le menu d'un binder, réduit à « Export list » (lecture
  // seule) ; listes et racine n'ont rien à lui proposer.
  const hasMenu = canEdit
    ? menuKind !== null || header.kind === 'collection'
    : header.kind === 'binder'
  // Le container racine s'affiche « All collection » — son nom en base est
  // celui de la collection, qui a sa propre ligne dans Settings.
  const screenTitle = header.kind === 'collection' ? 'All collection' : header.name
  // Densité de la vue courante (le sélecteur écrase la préférence de compte
  // pour la vue courante sans modifier `users.density`) — `viewState.density`
  // prime, `header.density` (préférence de compte) n'est le repli que tant
  // qu'aucun choix n'a été fait dans cette vue.
  const density = viewState.density ?? header.density
  // Une liste n'a ni sélection groupée ni stepper — ses lignes ne sont pas
  // des entrées de collection, `BulkEditSheet`/`ActionBar` n'ont aucun
  // sens sur elle.
  // Lecture seule (`viewer`) : même repli, la ligne n'offre que `×N`.
  const selectionEnabled = header.kind !== 'list' && canEdit

  // Un seul point de décision pour « une ligne vient d'être ouverte » :
  // panneau actif, elle le remplit ; panneau éteint ou fenêtre trop étroite,
  // elle rouvre la feuille de carte — le même composant, jamais une seconde
  // implémentation.
  function handleRowOpen(holdingId: string) {
    if (paneActive) setSelectedHoldingId(holdingId)
    else setOpenHoldingId(holdingId)
  }

  function renderItem(item: HoldingRow) {
    const isFoil = item.finish !== 'nonfoil'
    const label = priceLabel(item.priceMinor, currency)
    // Deux états distincts, jamais confondus : la
    // coche ne parle que de la sélection groupée, la surbrillance de ligne
    // courante n'appartient qu'au panneau d'aperçu — règle écrite une seule
    // fois dans `rowVisualState`, rejouée par un test unitaire sur la
    // séquence exacte de `tests/e2e/desktop.spec.ts`.
    const visual = rowVisualState({
      holdingId: item.holdingId,
      selectionActive: selection.active,
      allMatching: selection.allMatching,
      selectedIds: selection.ids,
      currentHoldingId: selectedHoldingId,
    })

    if (density === 'compact') {
      return (
        <CompactRow
          holdingId={item.holdingId}
          thumbUrl={item.thumbUrl}
          name={item.name}
          manaCost={item.manaCost}
          setCode={item.setCode}
          collectorNumber={item.collectorNumber}
          condition={item.condition}
          isFoil={isFoil}
          qty={item.qty}
          available={item.available}
          priceLabel={label}
          // Le stepper est du bruit en sélection groupée et n'existe jamais
          // sur une liste : `undefined` replie
          // `CompactRow` sur une puce `×N` en lecture seule dans les deux
          // cas.
          onQtyChange={
            !selectionEnabled || selection.active
              ? undefined
              : (next) => qtyMutation.mutate({ holdingId: item.holdingId, qty: next })
          }
          onOpen={() => handleRowOpen(item.holdingId)}
          selectable={selectionEnabled && selection.active}
          selected={visual.selected}
          current={visual.current}
        />
      )
    }

    if (density === 'grid') {
      return (
        <GridTile
          thumbUrl={item.thumbUrl}
          setCode={item.setCode}
          setIconUri={item.setIconUri}
          collectorNumber={item.collectorNumber}
          isFoil={isFoil}
          qty={item.qty}
          priceLabel={label}
          onOpen={() => handleRowOpen(item.holdingId)}
          selectable={selectionEnabled && selection.active}
          selected={visual.selected}
          current={visual.current}
          showPrice={header.pricesOnArt}
        />
      )
    }

    return (
      <CardRow
        holdingId={item.holdingId}
        thumbUrl={item.thumbUrl}
        name={item.name}
        manaCost={item.manaCost}
        setCode={item.setCode}
        setName={item.setName}
        collectorNumber={item.collectorNumber}
        condition={item.condition}
        isFoil={isFoil}
        qty={item.qty}
        available={item.available}
        priceLabel={label}
        onQtyChange={
          !selectionEnabled || selection.active
            ? undefined
            : (next) => qtyMutation.mutate({ holdingId: item.holdingId, qty: next })
        }
        onOpen={() => handleRowOpen(item.holdingId)}
        selectable={selectionEnabled && selection.active}
        selected={visual.selected}
        current={visual.current}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-16 pt-screen-top pb-20 desktop:px-20 desktop:pb-24 desktop:pt-30">
      {selection.active ? (
        // En-tête de sélection : remplace l'en-tête normal tant que la sélection est
        // active — même emplacement, même rangée (`min-h-header-row`, `mb-18`)
        // que `ScreenHeader`, pour ne pas décaler `CommandBar`/la liste en
        // dessous. `Cancel` vide la sélection (`Clear`/`Échap`/navigation
        // partagent tous `selection.clear()`).
        <div className="mb-18 flex min-h-header-row items-center gap-10">
          <button
            type="button"
            onClick={selection.clear}
            className="flex h-selection-header-button flex-shrink-0 items-center justify-center rounded-pill bg-surface-1 px-14 text-body font-bold text-text"
          >
            Cancel
          </button>
          <div className="min-w-0 flex-1 text-center text-selection-count font-extrabold text-text">
            {formatCount(selectedCount)} selected
          </div>
          <button
            type="button"
            onClick={selection.selectAllMatching}
            className="flex h-selection-header-button flex-shrink-0 items-center justify-center rounded-pill bg-surface-1 px-14 text-body font-bold text-accent-text"
          >
            Select all
          </button>
        </div>
      ) : header.kind === 'binder' && showCollapsibleBinderHeader ? (
        // En-tête illustré d'un binder à fond, avec des lignes à faire
        // défiler (demande produit) : le fond + la rangée retour/···/+
        // restent épinglés hors du défilement (comme `DeckBackdrop`),
        // le bloc titre/méta + `CommandBar` descendent dans le défilement de
        // la liste virtualisée via `VirtualList.scrollHeader` plus bas, pour
        // se replier puis se figer. `BinderHeaderBackdrop` porte à lui seul
        // le fond, `BinderTitleMeta` le titre — voir leurs commentaires
        // d'en-tête, `binder-header.tsx`.
        <>
          <BinderHeaderBackdrop
            coverGradient={header.coverGradient}
            coverCardId={header.coverCardId}
            coverArtUrl={header.coverArtUrl}
            coverIntensity={header.coverIntensity}
            binderBackdrops={header.binderBackdrops}
            rootRef={backdropRootRef}
            onAddCard={() => setAddSheetOpen(true)}
            onOpenMenu={() => setBinderMenuOpen(true)}
          />
          <div aria-hidden className="h-binder-controls-reserve flex-shrink-0" />
        </>
      ) : header.kind === 'binder' ? (
        // En-tête illustré d'un binder (écran `Binder · card-art backdrop`) —
        // remplace le bloc générique ci-dessous, seul `CommandBar`/la liste en
        // dessous restent partagés avec les autres `kind` (inchangés). Reste la
        // forme non collante (sans lignes à faire défiler, voir
        // `showCollapsibleBinderHeader` ci-dessus, ou sans fond).
        //
        // Visible à TOUTES les largeurs : le binder garde son en-tête d'art
        // sur desktop, il n'y a pas d'en-tête desktop distinct.
        <div>
          <BinderHeader
            name={header.name}
            cardCount={header.cardCount}
            valueMinor={header.valueMinor}
            currency={currency}
            coverGradient={header.coverGradient}
            coverCardId={header.coverCardId}
            coverArtUrl={header.coverArtUrl}
            coverArtist={header.coverArtist}
            coverIntensity={header.coverIntensity}
            binderBackdrops={header.binderBackdrops}
            onAddCard={() => setAddSheetOpen(true)}
            onOpenMenu={() => setBinderMenuOpen(true)}
          />
        </div>
      ) : (
        // En-tête unique à toutes les largeurs : le même en-tête sert
        // mobile ET desktop.
        <ScreenHeader
          title={screenTitle}
          breadcrumb="Collection"
          onBack={() => window.history.back()}
          meta={
            // Pas de méta sous « All collection » — seuls binders et listes
            // en ont.
            header.kind !== 'collection' ? (
              <>
                {formatCount(header.cardCount)} cards · {formatMoney(header.valueMinor, currency)}
              </>
            ) : undefined
          }
          // Même paire d'actions que l'en-tête desktop (`MainHeader`) et que
          // celui d'un binder (`BinderHeader`) : sans le `···`, une liste
          // n'avait aucun accès à son renommage, son apparence ni sa
          // suppression sur mobile. Le container racine (« All collection »)
          // a aussi le sien.
          onOverflow={
            hasMenu
              ? () =>
                  header.kind === 'collection' ? setCollectionMenuOpen(true) : setBinderMenuOpen(true)
              : undefined
          }
          overflowLabel="More actions"
          onAdd={canEdit ? () => setAddSheetOpen(true) : undefined}
          addLabel="Add card"
        />
      )}


      {menuKind && (
        <ContainerActionSheets
          containerId={containerId}
          kind={menuKind}
          name={header.name}
          look={lookFromHeader({
            coverGradient: header.coverGradient,
            coverCardId: header.coverCardId,
            coverIntensity: header.coverIntensity,
          })}
          menuOpen={binderMenuOpen}
          onMenuOpenChange={setBinderMenuOpen}
          lookOpen={binderLookOpen}
          onLookOpenChange={setBinderLookOpen}
        />
      )}

      {/* Menu du container racine : une seule ligne « Import / Export », qui
          ouvre la feuille unifiée à onglets Import|Export
          (`components/collection/import-export-sheet.tsx`) — même feuille que
          celle de l'accueil Collection (`shelves-view.tsx`/
          `collection-view.tsx`), montée ici pour le menu du container racine.
          Pied « Long-press any card to select several at once. ». */}
      {header.kind === 'collection' && (
        <>
          <Sheet
            open={collectionMenuOpen}
            onOpenChange={setCollectionMenuOpen}
            title="All collection"
          >
            <SheetGroup>
              <SheetRow
                icon={ArrowDownUp}
                label="Import / Export"
                hint="Paste a list, or download this collection"
                onClick={() => {
                  setCollectionMenuOpen(false)
                  setCollectionImportExportOpen(true)
                }}
              />
            </SheetGroup>
            <p className="mt-14 px-2 text-meta leading-normal text-text-2">
              Long-press any card to select several at once.
            </p>
          </Sheet>

          <ImportExportSheet
            open={collectionImportExportOpen}
            onOpenChange={setCollectionImportExportOpen}
            onImported={() => {
              void queryClient.invalidateQueries({ queryKey: holdingsKey })
              void queryClient.invalidateQueries({ queryKey: headerKey })
            }}
          />
        </>
      )}

      {/* Une liste ne compte pas dans la collection : ses cartes ont leur
          propre total et n'entrent nulle part ailleurs. Le dire ici, une fois,
          évite de le redire dans chaque libellé de valeur de l'écran. */}
      {header.kind === 'list' && (
        <p className="mb-14 rounded-banner bg-surface-1 px-14 py-12 text-meta leading-banner text-text-2">
          Cards in a list are not part of your collection — they only count toward this list&apos;s
          total.
        </p>
      )}

      {/* Rendue ici pour tous les écrans SAUF le binder à fond avec des
          lignes à faire défiler : elle descend alors dans le défilement de
          la liste (`scrollHeader` de `VirtualList` ci-dessous), pour se
          replier puis se figer avec le titre — même instance, un seul jeu
          de props, jamais deux implémentations. */}
      {!showCollapsibleBinderHeader && commandBarNode}

      {items.length === 0 ? (
        <p className="py-16 text-body text-text-2">
          {/* Textes exacts : l'état vide « rien n'a jamais
              été ajouté » et l'état filtré vide « rien ne correspond » ne
              partagent jamais le même libellé — le second dit qu'il faut
              desserrer les critères, pas qu'il faut ajouter une carte. */}
          {viewState.query.trim().length > 0 || countActiveFilters(viewState.filters) > 0
            ? 'No card matches these filters.'
            : header.kind === 'list'
              ? canEdit
                ? 'This list is empty. Tap + to add a card.'
                : 'This list is empty.'
              : header.kind === 'binder'
                ? canEdit
                  ? 'This binder is empty. Tap + to add a card.'
                  : 'This binder is empty.'
                : header.kind === 'collection'
                  ? canEdit
                    ? 'Your collection is empty. Add cards from the Search tab to see them here.'
                    : 'This collection is empty.'
                  : 'No cards yet.'}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-20">
          <div className="min-w-0 flex-1">
            <VirtualList
              items={items}
              density={density}
              getItemKey={(item) => item.holdingId}
              getGroupLabel={(item) => item.groupLabel}
              renderItem={renderItem}
              hasNextPage={holdingsQuery.hasNextPage ?? false}
              isFetchingNextPage={holdingsQuery.isFetchingNextPage}
              onEndReached={handleEndReached}
              selectionEnabled={selectionEnabled}
              selectedKey={paneActive ? selectedHoldingId : null}
              onSelectRow={paneActive ? setSelectedHoldingId : undefined}
              scrollHeader={
                showCollapsibleBinderHeader ? (
                  <>
                    {/* Zone vide repliable : reprend la géométrie exacte du
                        titre au repos (`--spacing-binder-title-gap`, même
                        valeur que `mb-binder-title-gap` de `BinderHeader`
                        non collant) — le titre garde donc sa position
                        actuelle tant que rien n'a défilé. */}
                    <div aria-hidden className="h-binder-title-gap" />
                    <div ref={stickySentinelRef} aria-hidden className="h-1 -mt-1" />
                    <div
                      ref={stickyHeaderRef}
                      className={`sticky top-0 z-10 -mx-16 px-16 pt-6 ${
                        headerStuck ? 'overflow-hidden bg-bg' : ''
                      }`}
                    >
                      {/* Une fois collé, le bloc peint l'art lui-même —
                          copie alignée au pixel avec le fond réel (demande
                           produit : « garder l'art », pas de fond opaque nu)
                          — sur une base `bg-bg` identique à ce qui se voit
                          derrière l'art au repos ; les lignes défilent
                          dessous sans transparaître. */}
                      {headerStuck && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 h-binder-backdrop"
                          style={{ top: stuckArtOffset }}
                        >
                          <BinderBackdropArt
                            coverGradient={header.coverGradient}
                            coverCardId={header.coverCardId}
                            coverArtUrl={header.coverArtUrl}
                            coverIntensity={header.coverIntensity}
                          />
                        </div>
                      )}
                      <div className="relative">
                        <BinderTitleMeta
                          name={header.name}
                          cardCount={header.cardCount}
                          valueMinor={header.valueMinor}
                          currency={currency}
                          artist={
                            header.coverCardId !== null && header.coverIntensity > 0
                              ? header.coverArtist
                              : null
                          }
                        />
                        <div className="mt-14">{commandBarNode}</div>
                      </div>
                    </div>
                  </>
                ) : undefined
              }
              scrollHeaderStickyOffset={showCollapsibleBinderHeader ? stickyHeaderHeight : 0}
            />
          </div>

          {/* Monté tant que la largeur n'a pas dit « non » ; c'est
              `hidden pane:flex` (posé par `PreviewPane` lui-même) qui
              décide de la première peinture, et cette condition qui
              l'élague ensuite du DOM sous 1280px : à 1024px, il n'y a pas
              de panneau d'aperçu. */}
          {renderPane && (
            <PreviewPane
              preview={previewQuery.data ?? null}
              holding={selectedHolding}
              priceLabel={
                selectedHolding ? priceLabel(selectedHolding.priceMinor, currency) : '—'
              }
              onQtyChange={(next) => {
                if (!selectedHolding) return
                qtyMutation.mutate({ holdingId: selectedHolding.holdingId, qty: next })
              }}
              onConditionChange={(condition) => {
                if (!selectedHolding) return
                patchMutation.mutate({ holdingId: selectedHolding.holdingId, condition })
              }}
              onFoilChange={(isFoil) => {
                if (!selectedHolding) return
                patchMutation.mutate({
                  holdingId: selectedHolding.holdingId,
                  finish: isFoil ? 'foil' : 'nonfoil',
                })
              }}
              onAddToDeck={() => openPaneDestinationSheet('deck')}
              onMoveToBinder={() => openPaneDestinationSheet('binder')}
              onDelete={() => {
                if (!selectedHolding) return
                qtyMutation.mutate({ holdingId: selectedHolding.holdingId, qty: 0 })
              }}
            />
          )}
        </div>
      )}

      <CardSheet
        open={openHoldingId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenHoldingId(null)
        }}
        holding={openHolding}
        priceLabel={openHolding ? priceLabel(openHolding.priceMinor, currency) : '—'}
        // Sur « All collection » (voir le commentaire de tête de `listHoldings`,
        // `holdings-data.ts`), les lignes affichées peuvent venir de plusieurs
        // containers à la fois — le nom du binder propriétaire de CETTE ligne
        // vient donc du holding lui-même (`HoldingRow.binderName`), pas du
        // nom constant de l'écran ouvert comme sur un binder (un seul container
        // y est montré).
        binderName={
          header.kind === 'binder'
            ? header.name
            : header.kind === 'collection'
              ? (openHolding?.binderName ?? null)
              : null
        }
        containerKind={header.kind}
        onEdit={() => {
          setOpenHoldingId(null)
          setEditingHoldingId(openHolding?.holdingId ?? null)
        }}
        onPrevious={previousHolding ? () => setOpenHoldingId(previousHolding.holdingId) : undefined}
        onNext={nextHolding ? () => setOpenHoldingId(nextHolding.holdingId) : undefined}
      />

      {/* Deux feuilles d'édition distinctes (`EditCardSheet`/
          `EditListCardSheet`) : une liste n'a ni
          binder ni undo sur ses lignes, `header.kind` route donc
          vers la bonne — jamais la même feuille avec des champs masqués. */}
      {header.kind === 'list' ? (
        <EditListCardSheet
          open={editingHoldingId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingHoldingId(null)
          }}
          holding={editingHolding}
          onQtyChange={(next) => {
            if (!editingHolding) return
            qtyMutation.mutate({ holdingId: editingHolding.holdingId, qty: next })
          }}
          onConditionChange={(condition) => {
            if (!editingHolding) return
            patchMutation.mutate({ holdingId: editingHolding.holdingId, condition })
          }}
          onFoilChange={(isFoil) => {
            if (!editingHolding) return
            patchMutation.mutate({
              holdingId: editingHolding.holdingId,
              finish: isFoil ? 'foil' : 'nonfoil',
            })
          }}
          onRemove={() => {
            if (!editingHolding) return
            qtyMutation.mutate({ holdingId: editingHolding.holdingId, qty: 0 })
          }}
        />
      ) : (
        <EditCardSheet
          open={editingHoldingId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingHoldingId(null)
          }}
          containerId={containerId}
          holding={editingHolding}
          // Même logique que `CardSheet.binderName` ci-dessus.
          currentBinderName={
            header.kind === 'binder'
              ? header.name
              : header.kind === 'collection'
                ? (editingHolding?.binderName ?? null)
                : null
          }
          onQtyChange={(next) => {
            if (!editingHolding) return
            qtyMutation.mutate({ holdingId: editingHolding.holdingId, qty: next })
          }}
          onConditionChange={(condition) => {
            if (!editingHolding) return
            patchMutation.mutate({ holdingId: editingHolding.holdingId, condition })
          }}
          onFoilChange={(isFoil) => {
            if (!editingHolding) return
            patchMutation.mutate({
              holdingId: editingHolding.holdingId,
              finish: isFoil ? 'foil' : 'nonfoil',
            })
          }}
          onDelete={() => {
            if (!editingHolding) return
            qtyMutation.mutate({ holdingId: editingHolding.holdingId, qty: 0 })
          }}
          onMoved={() => {
            void queryClient.invalidateQueries({ queryKey: holdingsKey })
            void queryClient.invalidateQueries({ queryKey: headerKey })
          }}
        />
      )}

      <AddCardSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        // `null` pour le container racine : `addCardAction` le résout via le
        // bootstrap, et la feuille libelle alors « Add to collection » plutôt
        // que « Add to binder ».
        containerId={header.kind === 'collection' ? null : containerId}
        containerKind={header.kind === 'list' ? 'list' : 'binder'}
        onAdded={() => {
          void queryClient.invalidateQueries({ queryKey: holdingsKey })
          void queryClient.invalidateQueries({ queryKey: headerKey })
        }}
      />

      {/* `ActionBar` est fixe : cette réserve dans la colonne raccourcit la
          liste d'autant, sinon les dernières lignes passent dessous. */}
      {selection.active && <div aria-hidden className="h-above-tab-bar flex-shrink-0" />}

      {selection.active && (
        <ActionBar
          onEdit={() => {
            setPaneEditHoldingId(null)
            setBulkEditDestinationKind(null)
            setBulkEditOpen(true)
          }}
          onMove={() => {
            setPaneEditHoldingId(null)
            setBulkEditDestinationKind('binder')
            setBulkEditOpen(true)
          }}
          onAddToDeck={() => {
            setPaneEditHoldingId(null)
            setBulkEditDestinationKind('deck')
            setBulkEditOpen(true)
          }}
          onDelete={() => void handleBulkDelete()}
        />
      )}

      <BulkEditSheet
        open={bulkEditOpen}
        onOpenChange={(open) => {
          setBulkEditOpen(open)
          // Refermée, la feuille reprend la sélection pour cible : sans
          // cela, un `Edit` groupé ouvert ensuite n'agirait que sur la
          // ligne du panneau.
          if (!open) setPaneEditHoldingId(null)
        }}
        count={bulkEditCount}
        containerId={containerId}
        entries={bulkEditEntries}
        onSubmit={handleBulkEditSubmit}
        destinationKind={bulkEditDestinationKind}
      />

      {errorMessage && (
        <div
          role="alert"
          className="fixed inset-x-16 bottom-toast-offset z-30 flex items-center gap-10 rounded-toast border border-border-device bg-surface-3 px-14 py-12 shadow-toast text-body text-danger"
        >
          <span className="min-w-0 flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="flex-shrink-0 text-body font-bold text-text-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {undoState && (
        <UndoToast
          token={undoState.undoToken}
          message={undoState.message}
          onUndo={() => {
            const token = undoState.undoToken
            const kind = undoState.kind
            setUndoState(null)
            if (kind === 'bulk') {
              void bulkUndoAction({ undoToken: token }).then((result) => {
                if (result.ok) {
                  void queryClient.invalidateQueries({ queryKey: holdingsKey })
                  void queryClient.invalidateQueries({ queryKey: headerKey })
                } else {
                  setErrorMessage('This action can no longer be undone.')
                }
              })
            } else {
              void handleUndo(token)
            }
          }}
          onExpire={() => setUndoState(null)}
        />
      )}
    </div>
  )
}
