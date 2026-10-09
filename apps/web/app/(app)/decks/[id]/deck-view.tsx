'use client'

// Écran `Planning deck · commander backdrop`. Composant client scindé de
// `page.tsx` (composant serveur) — même patron que `DecksView` : reçoit les
// données déjà chargées côté serveur en props, aucun refetch au montage.
//
// L'écran derrière le tiroir reste monté et se met à jour à chaque ajout :
// `handleCardAdded` patche `deck.slots`/`deck.coverage` localement depuis la
// seule ligne du tiroir qui vient d'être ajoutée (optimiste et locale, sans
// `revalidatePath`) ; `manaCurve`/
// `colorPips` restent ceux du chargement initial, `AddDrawerCard` ne portant
// ni `cmc` ni `typeLine` pour les recalculer sans un second aller-retour.
import {
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Copy,
  Ellipsis,
  FolderInput,
  Hammer,
  Library,
  Palette,
  Pencil,
  RotateCcw,
  Share2,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { LookSheet } from '@/components/binders/look-sheet'
import { ImportSheet } from '@/components/lists/import-sheet'
import { ListExportSheet } from '@/components/lists/export-sheet'
import { ShareSheet } from '@/components/sharing/share-sheet'
import {
  AddDrawer,
  type AddDrawerCounts,
  type AddDrawerFilters,
} from '@/components/decks/add-drawer'
import { DeckBackdrop, DeckBackdropArt } from '@/components/decks/deck-backdrop'
import { ArtCredit } from '@/components/cards/art-credit'
import { setQuantityAction, undoAction } from '@/app/(app)/container/[id]/actions'
import { UndoToast } from '@/components/ui/undo-toast'
import { setZoneAction } from '@/app/(app)/decks/[id]/builder-actions'
import { DeckCardRow } from '@/components/decks/deck-card-row'
import { CardPreviewSheet } from '@/components/cards/card-preview-sheet'
import { DeckInfos } from '@/components/decks/deck-infos'
import { StatCard, StatTile } from '@/components/decks/deck-stats-cards'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Segmented } from '@/components/ui/segmented'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import { ManaCurveBar } from '@/components/decks/mana-curve-bar'
import { ColorBar, type ManaColor } from '@/components/decks/color-bar'
import { SlotRow } from '@/components/decks/slot-row'
import { Sheet } from '@/components/ui/sheet'
import type { DeckZone } from '@spellcache/db/schema'
import { useCanEdit } from '@/lib/collections/access-context'
import { FORMAT_RULES, isDeckFormat, type DeckFormat } from '@/lib/decks/legality'
import { formatMoney } from '@/lib/format/money'
import { thumbUrl } from '@spellcache/core/images'

import { deleteDeckAction, duplicateDeckAction } from '@/app/(app)/decks/actions'
import { listFoldersAction, moveDeckToFolderAction } from '@/app/(app)/decks/folder-actions'
import { EditDeckSheet } from '@/components/decks/edit-deck-sheet'

import { AssembleSheet } from './assemble-sheet'
import { DismantleSheet } from './dismantle-sheet'
import { restartDeckAction, unbuildDeckAction } from './lifecycle-actions'

import type { BinderLook } from '@/app/(app)/container/[id]/binder-actions'
import type { ContainerHeader } from '@/app/(app)/container/[id]/holdings-data'
import type { AddDrawerCard, DeckDetail, DeckSlot } from './deck-data'

// Les trois onglets de l'écran. `list` d'abord : c'est la raison d'ouvrir un
// deck.
type DeckTab = 'list' | 'stats' | 'infos'

const DECK_TABS = [
  { value: 'list', label: 'List' },
  { value: 'stats', label: 'Stats' },
  { value: 'infos', label: 'Infos' },
]

const FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: 'Commander',
  modern: 'Modern',
  standard: 'Standard',
  pioneer: 'Pioneer',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
}

const MANA_CURVE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+']

// Assombrissement de l'écran derrière le tiroir ouvert (`opacity:0.45`) — même
// convention que `COMMANDER_ART_OPACITY` de `deck-backdrop.tsx` : une
// constante nommée consommée en style inline, pas une classe Tailwind
// (`--spacing: initial` ne couvre que l'espacement, mais aucun pas d'opacité
// à 45 n'est déclaré par ailleurs dans ce projet).
const DRAWER_BACKDROP_DIM_OPACITY = 0.45

function lookFromHeader(header: ContainerHeader): BinderLook {
  if (header.coverCardId)
    return { mode: 'art', cardId: header.coverCardId, intensity: header.coverIntensity }
  if (header.coverGradient)
    return {
      mode: 'colour',
      gradient: header.coverGradient,
      intensity: header.coverIntensity,
    }
  return { mode: 'none' }
}

function formatPriceMinor(minor: number | null, currency: 'usd' | 'eur'): string {
  return minor === null ? '—' : formatMoney(minor, currency)
}

// Même formule que `setLine()` de `deck-data.ts` (non exportée, module
// serveur) — dupliquée plutôt qu'importée : ce fichier est un composant
// client, `deck-data.ts` tire `@spellcache/db`. Une ligne
// insérée de façon optimiste (`handleCardAdded`/`applyOptimisticDelta`
// ci-dessous) doit porter le format `DeckSlot.setLine` (« DMR #34 · owned
// ×1 ») dès le premier rendu, pas celui du tiroir (`AddDrawerCard.setLine`,
// « DMR · Dominaria Remastered #34 »).
function deckSlotSetLine(setCode: string, collectorNumber: string, ownedElsewhere: number): string {
  const base = `${setCode.toUpperCase()} #${collectorNumber}`
  return ownedElsewhere > 0 ? `${base} · owned ×${ownedElsewhere}` : `${base} · not owned`
}

// Le bandeau `needsWork` d'un deck en plan affiche `deck.status.label` TEL
// QUEL (titre = raisons jointes), sans le réécrire en « N cards missing out
// of Y » : il imprime les raisons jointes par `evaluateDeck`
// (`lib/decks/legality.ts`, ex. « 36 short · 2 duplicates ») et laisse le
// corps fixe (« Tap to see what a build would consume and what you still
// need. ») porter le contexte.

// Variante « deck monté » de ce même bandeau (« 96/100 cards — 4 cards are
// missing from the list. ») : `deck.status.label` tel quel (« N cards
// missing · M duplicates » pour un deck `built`, `lib/decks/legality.ts`)
// perdrait la forme `X/Y cards` du design validé. Le compte de cartes manquantes
// affiché ici est délibérément le MÊME que celui de la section « Missing
// from the deck · N » plus bas et du lien juste en dessous
// (`missingSlots.length`, possédé vs non possédé) — pas `rule.size -
// deck.coverage.total` (légalement court, sans carte à nommer nulle part) :
// un lien qui promet « See the N missing cards » doit faire défiler vers
// une section qui affiche exactement N lignes, jamais un nombre différent.
// Ne réécrit QUE le cas où il y a réellement des cartes manquantes à
// nommer (`missingCount > 0`) : tout suffixe (` · N duplicates`) survit tel
// quel derrière le nouveau préfixe ; pour tout autre problème (over/
// duplicates seuls/banned/…), le libellé natif de `evaluateDeck` reste
// affiché sans transformation.
function builtWarningBannerLabel(label: string, total: number, ruleSize: number, missingCount: number): string {
  if (missingCount <= 0) return label
  const suffix = label.includes(' · ') ? ` · ${label.split(' · ').slice(1).join(' · ')}` : ''
  const base = `${total}/${ruleSize} cards — ${missingCount} ${missingCount === 1 ? 'card is' : 'cards are'} missing from the list`
  return suffix ? `${base}${suffix}.` : `${base}.`
}

export function DeckView({
  deckId,
  initialDeck,
  initialHeader,
}: {
  deckId: string
  initialDeck: DeckDetail
  initialHeader: ContainerHeader
}) {
  const [deck, setDeck] = useState<DeckDetail>(initialDeck)
  // En-tête repliable des écrans à fond (demande produit) : la zone vide
  // au-dessus du titre vit dans le défilement et se replie d'abord ; quand
  // la sentinelle (juste au-dessus du bloc sticky) sort du viewport, le
  // bloc titre + onglets est « collé » et reçoit un fond opaque.
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

  const [header, setHeader] = useState<ContainerHeader>(initialHeader)
  // Lecture seule (`viewer`), posée par `page.tsx` pour la collection de CE
  // deck : ni menu, ni ajout, ni cycle de vie, ni édition de ligne.
  const canEdit = useCanEdit()

  const [lookSheetOpen, setLookSheetOpen] = useState(false)
  const [menuSheetOpen, setMenuSheetOpen] = useState(false)
  // Partage public, import et export de liste, ouverts depuis le même menu
  // `···` que `Rename` (la feuille d'import est accessible depuis l'accueil
  // et depuis un deck).
  const [shareSheetOpen, setShareSheetOpen] = useState(false)
  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const [exportListSheetOpen, setExportListSheetOpen] = useState(false)
  // « Rename » ouvre nom ET format (utile depuis le `⋯` du deck) — même feuille `EditDeckSheet` que
  // l'entrée « Edit » du menu contextuel de tuile de l'onglet Decks.
  const [editSheetOpen, setEditSheetOpen] = useState(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [zone, setZone] = useState<DeckZone>('main')
  const [filters, setFilters] = useState<AddDrawerFilters>({
    legalInColours: true,
    ownedOnly: false,
  })

  const router = useRouter()
  // `Move to folder` : la liste des dossiers n'est chargée qu'à l'ouverture
  // de la feuille — un écran de deck n'a aucune raison de la connaître avant
  // qu'on la demande, et elle change sans lui.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [moveFolderOpen, setMoveFolderOpen] = useState(false)
  const [folders, setFolders] = useState<Array<{ id: string; name: string }> | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [tab, setTab] = useState<DeckTab>('list')
  const [previewHoldingId, setPreviewHoldingId] = useState<string | null>(null)
  const [assembleSheetOpen, setAssembleSheetOpen] = useState(false)
  const [dismantleSheetOpen, setDismantleSheetOpen] = useState(false)
  const [unbuildConfirmOpen, setUnbuildConfirmOpen] = useState(false)
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  // Toast `Undo` du retrait d'une carte.
  const [undoState, setUndoState] = useState<{ token: string; message: string } | null>(null)

  // Un deck `built`/`dismantled` a pu voir tous ses holdings bouger
  // (réservation automatique, holdings déplacés vers un binder) : un simple
  // patch local ne suffit pas à refléter ce que `assembleDeck`/
  // `dismantleDeck` ont réellement écrit ailleurs dans la collection —
  // `router.refresh()` relit `getDeck`/`getContainerHeader` depuis le
  // serveur (un deck monté à moitié en base est le pire état possible,
  // donc l'écran doit toujours refléter
  // l'état réel après une transition, jamais un état optimiste approximatif).
  function refreshAfterTransition() {
    router.refresh()
  }

  // Monter ou démonter un deck le fait changer de zone : il quitte l'atelier
  // pour `Collection › Decks`, ou l'inverse. L'URL doit suivre, sinon on
  // continue de parcourir un deck de la collection sous `/decks/…` (ou
  // l'inverse) et l'onglet actif de la navigation désigne le mauvais endroit.
  // `replace` : le retour ramène à la liste d'où l'on vient, pas à l'écran du
  // même deck sous son ancienne adresse.
  function handleAssembled() {
    router.replace(`/collection/decks/${deckId}`)
    router.refresh()
  }

  function handleDismantled() {
    router.replace(`/decks/${deckId}`)
    router.refresh()
  }

  // Supprimer un deck est irréversible : confirmation, toujours. Le
  // retour se fait vers la zone d'où il venait, jamais vers l'écran d'un deck
  // qui n'existe plus.
  async function handleDelete() {
    setDeleting(true)
    const wasBuilt = deck.deckState === 'built'
    const result = await deleteDeckAction({ deckId })
    setDeleting(false)
    if (!result.ok) {
      setTransitionError('Could not delete this deck. Try again.')
      setDeleteConfirmOpen(false)
      return
    }
    router.replace(wasBuilt ? '/collection/decks' : '/decks')
    router.refresh()
  }

  // « Duplicate » : copie réelle, toujours
  // en plan, puis navigation vers la copie — même comportement que la tuile
  // de l'onglet Decks (`folders-view.tsx`).
  async function handleDuplicateDeck() {
    const result = await duplicateDeckAction({ deckId })
    if (result.ok) router.push(`/decks/${result.deckId}`)
  }

  // Édition d'une ligne de la liste. Le serveur est la seule vérité : on lui
  // envoie le changement, puis `router.refresh()` relit le deck — quantité,
  // couverture, courbe et statut de légalité en dépendent tous, et les
  // recalculer à la main côté client ferait diverger quatre nombres au lieu
  // d'un. `qty <= 0` retire la ligne, comme partout ailleurs dans l'app
  // (`setQuantityAction`).
  async function handleSlotQty(slot: DeckSlot, next: number) {
    const result = await setQuantityAction({ holdingId: slot.holdingId, qty: next })
    if (!result.ok) {
      setTransitionError('Could not update this card. Try again.')
      return
    }
    router.refresh()
  }

  // Retirer une carte de la liste d'un tap sur la corbeille : réversible
  // pendant 6 secondes — `setQuantityAction({qty:0})` porte déjà un
  // `undoToken` (`removeHoldings`) quand il retire la ligne, jamais
  // consommé jusqu'ici par cet écran.
  async function handleRemoveSlot(slot: DeckSlot) {
    const result = await setQuantityAction({ holdingId: slot.holdingId, qty: 0 })
    if (!result.ok) {
      setTransitionError('Could not update this card. Try again.')
      return
    }
    if (result.undoToken) {
      setUndoState({ token: result.undoToken, message: `${slot.name} removed from the deck` })
    }
    router.refresh()
  }

  async function handleUndoRemove() {
    if (!undoState) return
    await undoAction({ undoToken: undoState.token })
    setUndoState(null)
    router.refresh()
  }

  async function handleSlotZone(slot: DeckSlot, zone: DeckZone) {
    const result = await setZoneAction({ holdingId: slot.holdingId, zone })
    if (!result.ok) {
      setTransitionError(
        result.error === 'commander_full'
          ? 'This deck already has a commander.'
          : 'Could not move this card. Try again.',
      )
      return
    }
    router.refresh()
  }

  async function openMoveFolder() {
    setMoveError(null)
    setMoveFolderOpen(true)
    if (folders !== null) return
    const result = await listFoldersAction()
    if (result.ok) setFolders(result.folders)
    else setMoveError('Could not load your folders.')
  }

  async function handleMoveToFolder(folderId: string | null) {
    const result = await moveDeckToFolderAction({ deckId, folderId })
    if (!result.ok) {
      setMoveError('Could not move this deck. Try again.')
      return
    }
    setMoveFolderOpen(false)
    router.refresh()
  }

  async function handleUnbuild() {
    setTransitioning(true)
    setTransitionError(null)
    const result = await unbuildDeckAction({ deckId })
    setTransitioning(false)
    if (!result.ok) {
      setTransitionError('Could not move this deck back to Assemble. Try again.')
      return
    }
    setUnbuildConfirmOpen(false)
    refreshAfterTransition()
  }

  async function handleRestart() {
    setTransitioning(true)
    setTransitionError(null)
    const result = await restartDeckAction({ deckId })
    setTransitioning(false)
    if (!result.ok) {
      setTransitionError('Could not restart this deck. Try again.')
      return
    }
    setRestartConfirmOpen(false)
    refreshAfterTransition()
  }

  // Valeur totale de la liste, celle qu'affiche l'onglet `Infos` : la somme
  // des exemplaires voulus au prix unitaire de leur impression, cartes non
  // encore possédées comprises — c'est ce que la liste vaut, pas ce que la
  // collection en couvre (`coverage.toBuyMinor` dit déjà l'autre).
  const totalValueMinor = [deck.commander, ...deck.slots].reduce(
    (sum, slot) => (slot ? sum + (slot.priceMinor ?? 0) * slot.need : sum),
    0,
  )

  const commanderArtUrl = deck.commander
    ? thumbUrl(deck.commander.cardId, 'art_crop')
    : null
  // Même règle que `DeckBackdrop.hasBackdrop` : un fond
  // est peint pour une dérogation posée, l'art du commandant ou le dégradé
  // d'identité d'un deck avec format — jamais pour la surface nue. Ce qui
  // pousse le contenu défilant sous le fond (`pt-deck-header-gap`) doit
  // suivre exactement la même condition que ce qui peint ce fond, pas
  // seulement la présence d'un commandant.
  const hasBackdrop =
    header.coverGradient !== null ||
    header.coverCardId !== null ||
    commanderArtUrl !== null
  // Crédit de l'illustration réellement peinte, dans l'ordre de
  // `DeckBackdropArt` (lib/decks/deck-look.ts) : la carte choisie, sinon
  // rien pour un dégradé, sinon le commandant. Jamais pour une illustration
  // ramenée à une intensité nulle (même règle que le binder,
  // `container-view.tsx`).
  const artCredit =
    header.coverIntensity <= 0
      ? null
      : header.coverCardId !== null
        ? header.coverArtist
        : header.coverGradient !== null
          ? null
          : commanderArtUrl !== null
            ? deck.commanderArtist
            : null
  // `formatRaw` plutôt que `format` : un format libre inconnu des sept connus
  // (ex. « Cube ») s'affiche tel quel, jamais remplacé par « No format ».
  // `rule` reste `null` pour ce même format (aucune règle structurelle ne
  // s'y applique, `evaluateDeck` le traite comme `noFormat`) mais `toGo`
  // retombe sur 60 dès qu'un format — connu ou non — est posé, plutôt que de
  // rester `null` et de faire disparaître le compteur du tiroir d'ajout pour
  // un format que l'app ne reconnaît pas.
  const formatLabel = deck.format ? FORMAT_LABELS[deck.format] : (deck.formatRaw ?? 'No format')
  const rule = deck.format ? FORMAT_RULES[deck.format] : null
  // Compteur « to go » : Commander seulement (demande produit) — les autres
  // formats n'ont plus de règles, donc pas de cible de taille non plus.
  const toGo =
    deck.format === 'commander' ? Math.max(0, (rule?.size ?? 100) - deck.coverage.total) : null

  const mainboardSlots = deck.slots.filter((slot) => slot.zone === 'main')
  const sideSlots = deck.slots.filter((slot) => slot.zone === 'side')
  // Commandant + mainboard uniquement (même périmètre que `computeCoverage`,
  // `deck-data.ts`) — alimente la section `Missing from the deck · N` du
  // deck `built` ci-dessous.
  const missingSlots = deck.slots.filter((slot) => slot.zone !== 'side' && slot.state === 'missing')

  const counts: AddDrawerCounts = {
    main: mainboardSlots.reduce((sum, slot) => sum + slot.need, 0),
    side: sideSlots.reduce((sum, slot) => sum + slot.need, 0),
    commander: deck.commander ? deck.commander.need : 0,
  }

  // La liste se parcourt : aucune recherche ni tri par-dessus — un deck tient
  // sur un écran de défilement, pas dans un moteur.
  const visibleMainboard = mainboardSlots

  // Feuille de carte ouverte depuis une ligne de la liste, et ses voisines
  // dans l'ordre affiché : commandant, mainboard, sideboard.
  const previewOrder = [...(deck.commander ? [deck.commander] : []), ...visibleMainboard, ...sideSlots]
  const previewIndex = previewOrder.findIndex((slot) => slot.holdingId === previewHoldingId)
  const previewSlot = previewIndex === -1 ? null : previewOrder[previewIndex]!
  const previewTile = useMemo(
    () =>
      previewSlot
        ? {
            cardId: previewSlot.cardId,
            name: previewSlot.name,
            artUrl: previewSlot.thumbUrl,
            priceMinor: previewSlot.priceMinor,
          }
        : null,
    // `deck` est un état : la ligne garde son identité tant que le deck ne
    // change pas, la feuille ne recharge donc pas son détail à chaque rendu.
    [previewSlot],
  )
  const previewStep = (step: 1 | -1) => {
    const target = previewIndex === -1 ? undefined : previewOrder[previewIndex + step]
    return target ? () => setPreviewHoldingId(target.holdingId) : undefined
  }

  // Réconcilie un ajout avec la vérité serveur (`addToDeckAction`) :
  // `result.qtyInDeck`/`result.coverage` remplacent
  // toujours la valeur locale par une valeur absolue, jamais un delta
  // empilé — idempotent, que ce tap ait été précédé d'un ou plusieurs
  // ajouts optimistes de la même carte (`applyOptimisticDelta` ci-dessous).
  function handleCardAdded(
    card: AddDrawerCard,
    addedZone: DeckZone,
    result: { qtyInDeck: number; coverage: DeckDetail['coverage'] },
  ) {
    setDeck((current) => {
      const existingIndex = current.slots.findIndex(
        (slot) => slot.cardId === card.cardId && slot.zone === addedZone,
      )
      const nextSlot: DeckSlot = {
        holdingId:
          existingIndex >= 0
            ? current.slots[existingIndex]!.holdingId
            : `optimistic-${card.cardId}-${addedZone}`,
        cardId: card.cardId,
        name: card.name,
        manaCost: card.manaCost,
        setLine: deckSlotSetLine(card.setCode, card.collectorNumber, card.ownedElsewhere),
        need: result.qtyInDeck,
        ownedElsewhere: card.ownedElsewhere,
        state: card.ownedElsewhere >= result.qtyInDeck ? 'owned' : 'missing',
        priceMinor: card.price === null ? null : Math.round(card.price * 100),
        zone: addedZone,
        thumbUrl: card.thumbUrl,
      }
      const slots =
        existingIndex >= 0
          ? current.slots.map((slot, index) =>
              index === existingIndex ? nextSlot : slot,
            )
          : [...current.slots, nextSlot]
      return {
        ...current,
        slots,
        coverage: result.coverage,
        commander: addedZone === 'commander' ? nextSlot : current.commander,
      }
    })
  }

  // Applique/annule un tap avant (ou en l'absence de) réponse serveur
  // (docs/development.md « mises à jour optimistes... retour arrière en cas
  // d'échec ») — `delta` vaut toujours ±1 (un tap ajoute un exemplaire),
  // jamais une valeur absolue : plusieurs
  // taps concurrents sur la même carte composent par addition plutôt que de
  // s'écraser, et `handleCardAdded` ci-dessus les remplace tous par la
  // vérité serveur dès qu'une réponse arrive.
  //
  // La couverture optimiste suit une règle volontairement approximative :
  // une carte marginale est comptée « owned » dès que `card.ownedElsewhere`
  // (nombre d'exemplaires ailleurs dans la collection) est non nul, sans
  // tenir compte du nombre déjà en deck — imprécis au-delà d'un exemplaire,
  // mais symétrique (le même calcul défait exactement ce qu'il a appliqué)
  // et corrigé à la réponse serveur qui suit de près. `toBuyMinor` n'est pas
  // ajusté : son prix suit `price_source` (docs/development.md, seule source de
  // vérité pour la devise), que ce tiroir ne connaît pas — corrigé lui aussi
  // par `handleCardAdded`.
  function applyOptimisticDelta(card: AddDrawerCard, addedZone: DeckZone, delta: 1 | -1) {
    const covered = card.ownedElsewhere > 0

    setDeck((current) => {
      const existingIndex = current.slots.findIndex(
        (slot) => slot.cardId === card.cardId && slot.zone === addedZone,
      )
      const previousNeed = existingIndex >= 0 ? current.slots[existingIndex]!.need : 0
      const nextNeed = Math.max(0, previousNeed + delta)
      const ownedElsewhere =
        existingIndex >= 0
          ? current.slots[existingIndex]!.ownedElsewhere
          : card.ownedElsewhere
      const nextSlot: DeckSlot = {
        holdingId:
          existingIndex >= 0
            ? current.slots[existingIndex]!.holdingId
            : `optimistic-${card.cardId}-${addedZone}`,
        cardId: card.cardId,
        name: card.name,
        manaCost: card.manaCost,
        setLine: deckSlotSetLine(card.setCode, card.collectorNumber, ownedElsewhere),
        need: nextNeed,
        ownedElsewhere,
        state: ownedElsewhere >= nextNeed ? 'owned' : 'missing',
        priceMinor: existingIndex >= 0 ? current.slots[existingIndex]!.priceMinor : null,
        zone: addedZone,
        thumbUrl: card.thumbUrl,
      }
      const slots =
        nextNeed === 0 && existingIndex >= 0
          ? current.slots.filter((_, index) => index !== existingIndex)
          : existingIndex >= 0
            ? current.slots.map((slot, index) =>
                index === existingIndex ? nextSlot : slot,
              )
            : nextNeed > 0
              ? [...current.slots, nextSlot]
              : current.slots

      const coverage = {
        ...current.coverage,
        total: Math.max(0, current.coverage.total + delta),
        owned: Math.max(0, current.coverage.owned + (covered ? delta : 0)),
        missing: Math.max(0, current.coverage.missing + (covered ? 0 : delta)),
      }

      return {
        ...current,
        slots,
        coverage,
        commander:
          addedZone === 'commander'
            ? nextNeed > 0
              ? nextSlot
              : null
            : current.commander,
      }
    })
  }

  const deckTitleBlock = (
    <>
              <div className="text-breadcrumb-deck font-bold uppercase tracking-section-label text-text-art">
                {/* La zone d'où vient le deck, et rien d'autre : le format est
                    déjà sur la ligne de méta juste en dessous. */}
                {deck.deckState === 'built' ? 'Collection › Decks' : 'Decks'}
              </div>
              <h1 className="mt-2 flex items-center gap-8 text-title-deck font-extrabold tracking-title-binder text-shadow-deck-title text-text">
                {/* Un deck monté qui échoue à son format porte l'alerte sur
                    son nom : on la voit sans ouvrir `Infos`, où les raisons
                    elles-mêmes vivent. Un deck en plan est *censé* être
                    incomplet — l'y afficher rendrait l'icône muette. */}
                {deck.deckState === 'built' && deck.status.kind === 'needsWork' && (
                  <TriangleAlert
                    width={19}
                    height={19}
                    strokeWidth={2.2}
                    aria-label="Not legal"
                    className="flex-shrink-0 text-warning"
                  />
                )}
                <span className="min-w-0 truncate">{deck.name}</span>
              </h1>
              {/* Méta par segments : pas de format posé => rien, 0 carte => rien — jamais de
                  « No format » ni « 0 cards » de remplissage. */}
              <div className="mt-5 flex items-center gap-7 text-meta text-text/80">
                {(deck.formatRaw !== null || deck.coverage.total > 0) && (
                  <span>
                    {[
                      deck.formatRaw !== null ? formatLabel : null,
                      deck.coverage.total > 0 ? `${deck.coverage.total} cards` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                {deck.colorIdentity.length > 0 && (
                  <span className="inline-flex items-center gap-2">
                    {deck.colorIdentity.map((color) => (
                      // eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/
                      <img key={color} src={`/mana/${color}.svg`} width={13} height={13} alt="" />
                    ))}
                  </span>
                )}
              </div>
              <ArtCredit artist={artCredit} />
    </>
  )


  return (
    // Coquille sans défilement propre (demande produit) : le fond et l'en-tête (titre,
    // méta, onglets) restent en place, seul le corps sous les onglets défile.
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Le tiroir ouvert assombrit l'écran derrière lui à `opacity: 0.45` —
          jamais le tiroir lui-même (`AddDrawer` reste hors de ce wrapper,
          plus bas) ni les feuilles portées par Radix (`LookSheet`,
          `Sheet`), déjà voilées par leur propre overlay. */}
      <div
        style={{ opacity: drawerOpen ? DRAWER_BACKDROP_DIM_OPACITY : 1 }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Deux dispositions : au-dessus d'un fond, les
            boutons prennent leur propre rangée pour laisser le titre hors de
            la bande la plus chargée de l'illustration ; sans fond, tout tient
            sur une ligne — retour, titre, menu — et l'écran commence à la
            première carte. */}
        {hasBackdrop && (
          <DeckBackdrop
            commanderArtUrl={commanderArtUrl}
            coverGradient={header.coverGradient}
            coverCardId={header.coverCardId}
            coverArtUrl={header.coverArtUrl}
            coverIntensity={header.coverIntensity}
            onBack={() => window.history.back()}
            onMore={() => setMenuSheetOpen(true)}
          />
        )}

        {/* Réserve en flux de la rangée retour/menu (peinte par le fond
            absolu) : la zone de défilement commence SOUS ces boutons, qui
            restent visibles et cliquables. */}
        {hasBackdrop && <div aria-hidden className="h-deck-controls-reserve flex-shrink-0" />}
        {!hasBackdrop && (
        <div className="relative flex-shrink-0 px-16 pt-screen-top">
          <div className="mb-18 flex min-h-header-row items-center gap-10">
            {!hasBackdrop && (
              <button
                type="button"
                aria-label="Back"
                onClick={() => window.history.back()}
                className="flex h-back-button w-back-button flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
              >
                <ChevronLeft width={20} height={20} strokeWidth={1.75} />
              </button>
            )}

            <div className={hasBackdrop ? '' : 'min-w-0 flex-1'}>
              {deckTitleBlock}
            </div>

            {!hasBackdrop && canEdit && (
              <button
                type="button"
                aria-label="Deck actions"
                onClick={() => setMenuSheetOpen(true)}
                className="flex h-header-action w-header-action flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
              >
                <Ellipsis width={18} height={18} strokeWidth={1.75} />
              </button>
            )}
          </div>


          {/* Trois onglets : la liste,
              les statistiques, et les informations (statut, appartenance,
              valeur, notes). Un seul écran sert les deux zones de decks —
              l'atelier et la collection —, seul son contenu varie selon
              `deckState`. */}
          <div className="mb-18">
            <Segmented
              options={DECK_TABS}
              value={tab}
              onChange={(next) => setTab(next as DeckTab)}
            />
          </div>
        </div>
        )}

        {/* Seul le corps défile — l'en-tête et les onglets ci-dessus sont
            épinglés, le fond d'art (absolu sur la racine) ne bouge pas. La
            réserve basse laisse la place à la barre `Add cards`/`Assemble`
            fixe. */}
        <ScrollArea className="px-16 pb-28">
          {hasBackdrop && (
            <>
              {/* La zone vide au-dessus du titre vit DANS le défilement :
                  elle se replie d'abord (demande produit), puis le bloc
                  titre + onglets se fige en haut et le contenu défile
                  dessous. */}
              <div aria-hidden className="h-deck-collapse-gap" />
              <div ref={stickySentinelRef} aria-hidden className="h-1 -mt-1" />
              <div
                className={`sticky top-0 z-10 -mx-16 px-16 pt-6 ${
                  headerStuck ? 'overflow-hidden bg-bg' : ''
                }`}
              >
                {/* Une fois collé, le bloc peint l'art lui-même — copie
                    alignée au pixel avec le fond réel (demande produit :
                    « garder l'art », pas de fond opaque nu) : le haut de la
                    zone de défilement est à `h-deck-controls-reserve` sous
                    le haut du fond, la copie remonte donc d'autant. Base
                    `bg-bg` identique à ce qui se voit derrière l'art au
                    repos ; les cartes défilent dessous sans transparaître. */}
                {headerStuck && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 -top-deck-controls-reserve h-deck-backdrop"
                  >
                    <DeckBackdropArt
                      commanderArtUrl={commanderArtUrl}
                      coverGradient={header.coverGradient}
                      coverCardId={header.coverCardId}
                      coverArtUrl={header.coverArtUrl}
                      coverIntensity={header.coverIntensity}
                    />
                  </div>
                )}
                <div className="relative">{deckTitleBlock}</div>
                <div className="relative mb-14 pt-16">
                  <Segmented
                    options={DECK_TABS}
                    value={tab}
                    onChange={(next) => setTab(next as DeckTab)}
                  />
                </div>
              </div>
            </>
          )}
          <div className="relative">

          {tab === 'infos' && (
            <>
              {/* Statut du deck, toujours présent sur cet onglet : légal,
                  sans format à valider, ou fautif — les deux bandeaux plus
                  bas portent ce dernier cas, avec ce qu'il faut corriger. */}
              {deck.status.kind === 'noFormat' && (
                <div className="mb-10 flex items-center gap-12 rounded-card border border-border bg-surface-1 p-13">
                  <CircleHelp
                    width={19}
                    height={19}
                    strokeWidth={1.75}
                    className="flex-shrink-0 text-text-2"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-card-name-compact font-bold text-text">No format set</div>
                    <div className="mt-2 text-value-caption leading-normal text-text-2">
                      Set a format and this deck will tell you when it stops being legal.
                    </div>
                  </div>
                </div>
              )}

              {(deck.status.kind === 'legal' || deck.status.kind === 'built') && (
                <div className="mb-10 flex items-center gap-12 rounded-card border border-border-tile-owned bg-surface-1 p-13">
                  <Check
                    width={19}
                    height={19}
                    strokeWidth={1.75}
                    className="flex-shrink-0 text-success"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-card-name-compact font-bold text-text">
                      {deck.status.label}
                    </div>
                    <div className="mt-2 text-value-caption leading-normal text-text-2">
                      Nothing to do.
                    </div>
                  </div>
                </div>
              )}

          {deck.status.kind === 'needsWork' && deck.deckState !== 'built' && (
            // `mt-16 mb-12` pour `margin:16px 0 12px`, pas `my-16`
            // (16px 0 16px). Le `chevron-right` mène à la feuille `Assemble` :
            // le bandeau l'ouvre plutôt que de rester un `<div>` structurel
            // sans déclencheur.
            // Titre + corps sur deux lignes (titre = raisons jointes, corps
            // fixe), plus le chevron d'ouverture de `Assemble`.
            // Lecture seule : le bandeau garde son statut, sans ouvrir `Assemble`.
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setAssembleSheetOpen(true)}
              className="mb-12 mt-16 flex w-full items-start gap-11 rounded-banner border border-border-warning-subtle bg-warning-banner-bg px-13 py-12 text-left"
            >
              <TriangleAlert
                width={17}
                height={17}
                strokeWidth={1.75}
                className="mt-1 flex-shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <div className="text-card-name-compact font-bold text-warning">{deck.status.label}</div>
                {canEdit && (
                  <div className="mt-3 text-meta leading-normal text-text-2">
                    Tap to see what a build would consume and what you still need.
                  </div>
                )}
              </div>
              {canEdit && (
                <ChevronRight
                  width={16}
                  height={16}
                  strokeWidth={1.75}
                  className="mt-1 flex-shrink-0 text-text-2"
                />
              )}
            </button>
          )}

          {deck.status.kind === 'needsWork' && deck.deckState === 'built' && (
            // Variante « deck monté » de ce même bandeau : titre + corps sur
            // deux lignes — le deck est
            // déjà construit, ce bandeau ne rouvre donc jamais la feuille
            // `Assemble` (il faut d'abord « Move back to Assemble », menu
            // `···`) ; le lien ne fait que défiler jusqu'à la liste, déjà
            // affichée plus bas sur ce même écran.
            <div className="mb-14 mt-16 flex items-start gap-11 rounded-banner border border-border-warning-subtle bg-warning-banner-bg px-13 py-12">
              <TriangleAlert
                width={17}
                height={17}
                strokeWidth={1.75}
                className="mt-1 flex-shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <div className="text-card-name-compact font-bold text-warning">
                  Not legal for {formatLabel}
                </div>
                <div className="mt-3 text-meta leading-normal text-text-2">
                  {rule
                    ? builtWarningBannerLabel(
                        deck.status.label,
                        deck.coverage.total,
                        rule.size,
                        missingSlots.length,
                      )
                    : deck.status.label}
                </div>
                {/* `#deck-missing` ne vit que sur l'onglet List — un
                    `<a href>` depuis Infos ne
                    menait donc nulle part tant que l'onglet n'avait pas déjà
                    été basculé à la main. Ce bouton bascule d'abord, puis
                    défile une fois la section montée. */}
                <button
                  type="button"
                  onClick={() => {
                    setTab('list')
                    requestAnimationFrame(() => {
                      document.getElementById('deck-missing')?.scrollIntoView({ block: 'start' })
                    })
                  }}
                  className="mt-8 block text-meta font-bold text-accent-text"
                >
                  See the {missingSlots.length} missing {missingSlots.length === 1 ? 'card' : 'cards'}
                </button>
                {/* « Missing from the deck · N » + les 6 premières lignes
                    (la carte de légalité embarque elle-même la liste, pas
                    seulement un lien vers l'onglet List). `N` compte les
                    EXEMPLAIRES manquants (`need - ownedElsewhere` par
                    ligne), pas le nombre de cartes distinctes — écart
                    volontaire avec le lien juste au-dessus, qui compte des
                    lignes (`missingSlots.length`) : les deux
                    comptent des choses différentes, chacun cohérent avec sa
                    propre section. */}
                {missingSlots.length > 0 && (
                  <div className="mt-9">
                    <div className="mb-6 text-value-caption font-semibold uppercase tracking-section-label text-text-2">
                      Missing from the deck ·{' '}
                      {missingSlots.reduce((sum, slot) => sum + Math.max(0, slot.need - slot.ownedElsewhere), 0)}
                    </div>
                    <div className="flex flex-col gap-4">
                      {missingSlots.slice(0, 6).map((slot) => (
                        <div key={slot.holdingId} className="flex gap-8 text-value-caption text-text-2">
                          <span className="flex-shrink-0 font-bold text-warning">
                            {Math.max(0, slot.need - slot.ownedElsewhere)}×
                          </span>
                          <span className="min-w-0 flex-1 truncate">{slot.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {deck.deckState === 'built' ? (
            // Sans corps : la valeur du deck vit
            // déjà sur `DeckInfos` plus bas, la répéter ici ne disait rien
            // que le titre ne disait pas déjà.
            <div className="mb-10 flex items-center gap-12 rounded-card border border-border-tile-owned bg-surface-2 px-13 py-13">
              <Boxes width={19} height={19} strokeWidth={1.75} className="flex-shrink-0 text-success" />
              <div className="min-w-0 flex-1 text-card-name-compact font-bold text-text">In your collection</div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setDismantleSheetOpen(true)}
                  className="flex-shrink-0 rounded-pill border border-border bg-surface-1 px-14 py-9 text-pill-badge font-bold text-text"
                >
                  Dismantle
                </button>
              )}
            </div>
          ) : (
            <div className="mb-14 flex items-center gap-10 rounded-banner border border-border bg-surface-translucent px-13 py-11">
              <Library
                width={17}
                height={17}
                strokeWidth={1.75}
                className="flex-shrink-0 text-success"
              />
              <div className="min-w-0 flex-1">
                {/* « Planning only » quand rien n'a encore été préflighté —
                    ici, un deck sans aucune carte : cet écran calcule
                    `deck.coverage` côté serveur avant même le premier rendu,
                    donc le seul cas observable est un deck qui n'a encore
                    aucune ligne à évaluer. Jamais « · 0 to buy » : le corps
                    dit « You own everything this deck needs. » dès
                    que `missing` retombe à zéro. */}
                <div className="text-meta font-bold text-text-art">
                  {deck.coverage.total === 0
                    ? 'Planning only'
                    : `${deck.coverage.owned} of ${deck.coverage.total} already in your collection`}
                </div>
                <div className="mt-2 text-value-caption leading-normal text-text-art">
                  {deck.coverage.total === 0
                    ? 'Nothing here counts as owned until you assemble it.'
                    : deck.coverage.missing > 0
                      ? `${deck.coverage.missing} to buy · ${formatMoney(deck.coverage.toBuyMinor, header.currency)}`
                      : 'You own everything this deck needs.'}
                </div>
              </div>
            </div>
          )}

              {transitionError && <p className="mb-14 text-meta text-danger">{transitionError}</p>}
              <DeckInfos
                deckId={deck.id}
                totalValueMinor={totalValueMinor}
                currency={header.currency}
                initialNotes={deck.description}
              />
            </>
          )}

          {tab === 'stats' && (
            <div className="flex flex-col gap-14">
              <div className="flex gap-10">
                <StatTile label="Total cards" value={String(deck.stats.totalCards)} />
                <StatTile label="Avg. CMC" value={deck.stats.avgCmc.toFixed(2)} />
                <StatTile
                  label="Lands / Nonlands"
                  value={`${deck.stats.lands} / ${deck.stats.nonlands}`}
                />
              </div>

              {/* Deux cartes distinctes plutôt qu'une pile de barres :
                  la courbe et la répartition ne se lisent pas ensemble, et
                  huit paliers suivis de cinq couleurs sans titre ne disaient
                  pas où l'une finissait. */}
              <StatCard title="Mana curve">
                <div className="flex flex-col gap-6">
                  {(() => {
                    const maxCurve = Math.max(1, ...deck.manaCurve.map((bucket) => bucket.count))
                    return deck.manaCurve.map((bucket, index) => (
                      <ManaCurveBar
                        key={bucket.cmc}
                        label={MANA_CURVE_LABELS[index]!}
                        count={bucket.count}
                        pct={Math.round((bucket.count / maxCurve) * 100)}
                      />
                    ))
                  })()}
                </div>
              </StatCard>

              <StatCard title="Color distribution">
                {/* Toujours les six lignes W,U,B,R,G,C, même à zéro — pas
                    d'état vide. */}
                <div className="flex flex-col gap-6">
                  {deck.colorPips.map((pip) => (
                    <ColorBar
                      key={pip.color}
                      color={pip.color as ManaColor}
                      count={pip.count}
                      pct={pip.pct}
                    />
                  ))}
                </div>
              </StatCard>
            </div>
          )}

          {tab === 'list' && (
            <>
          {/* Zone commandant : réservée au format Commander (demande
              produit) — ou à un commandant hérité d'avant un changement de
              format, pour ne jamais rendre ses cartes inaccessibles. */}
          {(deck.format === 'commander' || deck.commander !== null) && deck.commander && (
            <>
              {/* `{need}`, jamais `1` en dur : la
                  zone commandant peut porter plus d'un exemplaire pour un
                  commandant partenaire ou une carte empilée manuellement. */}
              <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
                Commander · {deck.commander.need}
              </div>
              <div className="mb-18 flex flex-col gap-8">
                <DeckCardRow
                  thumbUrl={deck.commander.thumbUrl}
                  name={deck.commander.name}
                  manaCost={deck.commander.manaCost}
                  setLine={deck.commander.setLine}
                  qty={deck.commander.need}
                  zone="commander"
                  onQtyChange={(next) => void handleSlotQty(deck.commander!, next)}
                  onZoneChange={(next) => void handleSlotZone(deck.commander!, next)}
                  onRemove={() => void handleRemoveSlot(deck.commander!)}
                  onOpen={() => setPreviewHoldingId(deck.commander!.holdingId)}
                />
              </div>
            </>
          )}
          {deck.format === 'commander' && deck.commander === null && (
            <>
              <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
                Commander
              </div>
              <p className="mb-18 text-body text-text-2">No cards.</p>
            </>
          )}

          <div
            id="deck-mainboard"
            className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2"
          >
            {/* Pas de « · 0 » sur une zone vide — le compte ne s'affiche que quand il y a quelque chose à
                compter. */}
            Mainboard{counts.main > 0 ? ` · ${counts.main}` : ''}
          </div>
          {visibleMainboard.length === 0 ? (
            <p className="px-4 text-body text-text-2">No cards.</p>
          ) : (
            <div className="flex flex-col gap-8">
              {visibleMainboard.map((slot) => (
                <DeckCardRow
                  key={slot.holdingId}
                  thumbUrl={slot.thumbUrl}
                  name={slot.name}
                  manaCost={slot.manaCost}
                  setLine={slot.setLine}
                  qty={slot.need}
                  zone={slot.zone}
                  onQtyChange={(next) => void handleSlotQty(slot, next)}
                  onZoneChange={(next) => void handleSlotZone(slot, next)}
                  onRemove={() => void handleRemoveSlot(slot)}
                  onOpen={() => setPreviewHoldingId(slot.holdingId)}
                />
              ))}
            </div>
          )}

          {/* Réserve : masquée tant qu'elle est vide — un titre de zone sans
              carte en dessous n'apprend rien. */}
          {sideSlots.length > 0 && (
            <>
              <div className="mb-10 ml-4 mt-18 text-section-label font-semibold uppercase tracking-section-label text-text-2">
                Sideboard · {counts.side}
              </div>
              <div className="flex flex-col gap-8">
                {sideSlots.map((slot) => (
                  <DeckCardRow
                    key={slot.holdingId}
                    thumbUrl={slot.thumbUrl}
                    name={slot.name}
                    manaCost={slot.manaCost}
                    setLine={slot.setLine}
                    qty={slot.need}
                    zone={slot.zone}
                    onQtyChange={(next) => void handleSlotQty(slot, next)}
                    onZoneChange={(next) => void handleSlotZone(slot, next)}
                    onRemove={() => void handleRemoveSlot(slot)}
                    onOpen={() => setPreviewHoldingId(slot.holdingId)}
                  />
                ))}
              </div>
            </>
          )}

          {/* « Missing from the deck · N » : cible du lien du bandeau
              ci-dessus (`#deck-missing`). Portée au
              commandant + mainboard, jamais au côté — même périmètre que
              `computeCoverage`/`legalityRows` (`deck-data.ts`). N'apparaît
              que sur un deck `built` : côté `plan`/`assemble`, ces mêmes
              cartes sont déjà visibles, coloriées `missing`, dans
              `Commander`/`Mainboard` ci-dessus. */}
          {deck.deckState === 'built' && missingSlots.length > 0 && (
            <>
              <div
                id="deck-missing"
                className="mb-10 ml-4 mt-18 text-section-label font-semibold uppercase tracking-section-label text-text-2"
              >
                Missing from the deck · {missingSlots.length}
              </div>
              <div className="flex flex-col gap-8">
                {missingSlots.map((slot) => (
                  <SlotRow
                    key={slot.holdingId}
                    thumbUrl={slot.thumbUrl}
                    name={slot.name}
                    manaCost={slot.manaCost}
                    setLine={slot.setLine}
                    need={slot.need}
                    state={slot.state}
                    priceLabel={formatPriceMinor(slot.priceMinor, header.currency)}
                  />
                ))}
              </div>
            </>
          )}
            </>
          )}
          </div>
        </ScrollArea>

        {/* Deck verrouillé (`built`) : plus d'ajout ni de
            réassemblage depuis cet écran — la seule sortie est `Dismantle`
            (bandeau ci-dessus) ou `Move back to Assemble` (menu `···`). Un
            deck `dismantled` n'a plus de holdings du tout (démonté vers un
            binder) : rien à ajouter tant qu'il n'est pas relancé (`Restart`,
            menu `···`) non plus. */}
        {canEdit && (deck.deckState === 'plan' || deck.deckState === 'assemble') && tab === 'list' && (
          // Dans le FLUX de la colonne, sous la zone de defilement (demande
          // produit) : la barre fermait l ecran en position fixed et la scrollbar
          // du corps courait dessous — en flux, le defilement (et son curseur)
          // s arrete net au-dessus d elle, comme pour la barre d onglets.
          <div className="z-20 flex flex-shrink-0 gap-8 border-t border-surface-2 bg-surface-3 px-12 py-10">
            {/* Sans icônes : les deux boutons ne portent que du texte. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex flex-1 items-center justify-center rounded-control border border-border py-13 text-body font-bold text-text"
            >
              Add cards
            </button>
            <button
              type="button"
              onClick={() => setAssembleSheetOpen(true)}
              className="flex flex-1 items-center justify-center rounded-control bg-accent py-13 text-body font-extrabold text-on-accent"
            >
              Assemble
            </button>
          </div>
        )}
      </div>

      <AddDrawer
        deckId={deckId}
        open={drawerOpen}
        showCommanderZone={deck.format === 'commander'}
        zone={zone}
        onZoneChange={setZone}
        filters={filters}
        onFiltersChange={setFilters}
        toGo={toGo}
        counts={counts}
        colorIdentity={deck.builderColorIdentity}
        onClose={() => setDrawerOpen(false)}
        onOptimisticAdd={(card, addedZone) => applyOptimisticDelta(card, addedZone, 1)}
        onCardAdded={handleCardAdded}
        onCardAddFailed={(card, addedZone) => applyOptimisticDelta(card, addedZone, -1)}
      />

      <LookSheet
        open={lookSheetOpen}
        onOpenChange={setLookSheetOpen}
        containerId={deckId}
        initialLook={lookFromHeader(header)}
        target="deck"
        commanderCardId={deck.commander?.cardId ?? null}
        onSaved={(look, coverArtist) =>
          setHeader((current) => ({
            ...current,
            coverGradient: look.mode === 'colour' ? look.gradient : null,
            coverCardId: look.mode === 'art' ? look.cardId : null,
            coverArtUrl: look.mode === 'art' ? thumbUrl(look.cardId, 'art_crop') : null,
            coverArtist: look.mode === 'art' ? coverArtist : null,
            coverIntensity:
              look.mode === 'colour' || look.mode === 'art'
                ? look.intensity
                : current.coverIntensity,
          }))
        }
      />

      <Sheet
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete deck?"
        closeLabel="Close delete deck sheet"
      >
        <p className="mb-16 text-meta leading-normal text-text-2">
          {deck.deckState === 'built'
            ? `Delete “${deck.name}”? The deck and its card list are removed; its cards go back to your collection. This cannot be undone.`
            : `Delete “${deck.name}”? This removes the deck and its card list. This cannot be undone.`}
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="w-full rounded-control bg-danger py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
        >
          {deleting ? 'Deleting...' : 'Delete deck'}
        </button>
      </Sheet>

      {/* `Move to folder` — même déplacement que le glisser-déposer de
          l'onglet Decks, sur la même action serveur. `Unsorted` est une
          destination comme une autre : c'est l'absence de dossier. */}
      <Sheet open={moveFolderOpen} onOpenChange={setMoveFolderOpen} title="Move to folder">
        {moveError && <p className="mb-12 text-meta text-danger">{moveError}</p>}
        {folders === null ? (
          <p className="text-meta text-text-2">Loading folders...</p>
        ) : (
          <div className="flex flex-col gap-8">
            <button
              type="button"
              onClick={() => void handleMoveToFolder(null)}
              className="flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text"
            >
              Unsorted
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => void handleMoveToFolder(folder.id)}
                className="flex w-full items-center gap-10 rounded-row border border-border bg-surface-1 px-14 py-11 text-left text-body font-semibold text-text"
              >
                {folder.name}
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={menuSheetOpen} onOpenChange={setMenuSheetOpen} title={deck.name}>
        <SheetGroup>
          <SheetRow
            icon={Pencil}
            label="Edit"
            onClick={() => {
              setMenuSheetOpen(false)
              setEditSheetOpen(true)
            }}
          />
          <SheetRow
            icon={Palette}
            label="Deck look"
            hint="A colour, a card, or the commander's art"
            onClick={() => {
              setMenuSheetOpen(false)
              setLookSheetOpen(true)
            }}
          />
          {/* Les dossiers rangent l'atelier ; un deck monté est classé sous
              `Collection › Decks` et n'a pas d'étagère où aller. */}
          {deck.deckState !== 'built' && (
            <SheetRow
              icon={FolderInput}
              label="Move to folder"
              hint="Change which shelf it sits on"
              onClick={() => {
                setMenuSheetOpen(false)
                void openMoveFolder()
              }}
            />
          )}
          {/* « Duplicate » : copie réelle, toujours en plan — comme la tuile de
              l'onglet Decks, seulement offerte tant que le deck est un plan
              (un deck monté n'a pas d'étagère où renvoyer sa copie). */}
          {deck.deckState !== 'built' && (
            <SheetRow
              icon={Copy}
              label="Duplicate"
              hint="A second copy of this list, to try a different build"
              onClick={() => {
                setMenuSheetOpen(false)
                void handleDuplicateDeck()
              }}
            />
          )}
          <SheetRow
            icon={Share2}
            label="Share"
            hint="Anyone with the link can read it"
            onClick={() => {
              setMenuSheetOpen(false)
              setShareSheetOpen(true)
            }}
          />
          <SheetRow
            icon={Upload}
            label="Import a list"
            hint="Paste a decklist into this deck"
            onClick={() => {
              setMenuSheetOpen(false)
              setImportSheetOpen(true)
            }}
          />
          <SheetRow
            icon={ClipboardList}
            label="Export list"
            hint="Copy this list as text"
            onClick={() => {
              setMenuSheetOpen(false)
              setExportListSheetOpen(true)
            }}
          />
          {deck.deckState === 'built' && (
            <SheetRow
              icon={Boxes}
              label="Dismantle"
              hint="Take it apart and decide what happens to the cards"
              onClick={() => {
                setMenuSheetOpen(false)
                setDismantleSheetOpen(true)
              }}
            />
          )}
          {deck.deckState === 'built' && (
            // `built → assemble` (remettre un deck en chantier) — chaque
            // transition passe par une feuille de confirmation, jamais un
            // simple tap.
            <SheetRow
              icon={Hammer}
              label="Move back to Assemble"
              hint="Reopen the build without touching the cards"
              onClick={() => {
                setMenuSheetOpen(false)
                setUnbuildConfirmOpen(true)
              }}
            />
          )}
          <SheetRow
            icon={Trash2}
            label="Delete deck"
            hint={
              deck.deckState === 'built'
                ? 'Its cards go back to the collection'
                : 'The plan is removed'
            }
            onClick={() => {
              setMenuSheetOpen(false)
              setDeleteConfirmOpen(true)
            }}
          />
          {deck.deckState === 'dismantled' && (
            // `dismantled → plan` (repartir du même contenu) — même règle,
            // feuille de confirmation dédiée.
            <SheetRow
              icon={RotateCcw}
              label="Restart"
              hint="Plan it again from the same list"
              onClick={() => {
                setMenuSheetOpen(false)
                setRestartConfirmOpen(true)
              }}
            />
          )}
        </SheetGroup>
      </Sheet>

      <Sheet
        open={unbuildConfirmOpen}
        onOpenChange={setUnbuildConfirmOpen}
        title="Move back to Assemble?"
        closeLabel="Close move back to Assemble sheet"
      >
        <div className="flex flex-col gap-14">
          <p className="text-meta leading-normal text-text-2">
            {deck.name} leaves the built collection and becomes editable again. Its cards stay exactly
            where they are until you assemble it again.
          </p>
          {transitionError && <p className="text-meta text-danger">{transitionError}</p>}
          <button
            type="button"
            onClick={() => void handleUnbuild()}
            disabled={transitioning}
            className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
          >
            {transitioning ? 'Moving...' : 'Move back to Assemble'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={restartConfirmOpen}
        onOpenChange={setRestartConfirmOpen}
        title="Restart this deck?"
        closeLabel="Close restart sheet"
      >
        <div className="flex flex-col gap-14">
          <p className="text-meta leading-normal text-text-2">
            {deck.name} goes back to Plan so you can build it again from the same list.
          </p>
          {transitionError && <p className="text-meta text-danger">{transitionError}</p>}
          <button
            type="button"
            onClick={() => void handleRestart()}
            disabled={transitioning}
            className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
          >
            {transitioning ? 'Restarting...' : 'Restart'}
          </button>
        </div>
      </Sheet>

      <CardPreviewSheet
        open={previewTile !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewHoldingId(null)
        }}
        tile={previewTile}
        currency={header.currency}
        onPrevious={previewStep(-1)}
        onNext={previewStep(1)}
      />

      <AssembleSheet
        open={assembleSheetOpen}
        onOpenChange={setAssembleSheetOpen}
        deckId={deckId}
        deckName={deck.name}
        cardCount={deck.coverage.total}
        currency={header.currency}
        onAssembled={handleAssembled}
      />

      <DismantleSheet
        open={dismantleSheetOpen}
        onOpenChange={setDismantleSheetOpen}
        deckId={deckId}
        deckName={deck.name}
        cardCount={deck.coverage.total}
        valueMinor={header.valueMinor}
        currency={header.currency}
        onDismantled={handleDismantled}
      />

      <ShareSheet
        open={shareSheetOpen}
        onOpenChange={setShareSheetOpen}
        containerId={deckId}
        kindLabel="deck"
      />

      <ImportSheet
        open={importSheetOpen}
        onOpenChange={setImportSheetOpen}
        containerId={deckId}
        currency={header.currency}
        onImported={refreshAfterTransition}
      />

      <ListExportSheet
        open={exportListSheetOpen}
        onOpenChange={setExportListSheetOpen}
        containerId={deckId}
        containerName={deck.name}
      />

      {/* « Edit deck » — nom ET format,
          rouverte depuis « Rename » du menu `···`. */}
      <EditDeckSheet
        key={`edit-${editSheetOpen}`}
        open={editSheetOpen}
        onOpenChange={setEditSheetOpen}
        deckId={deckId}
        name={deck.name}
        format={deck.formatRaw}
        onSaved={({ name, format }) =>
          setDeck((current) => ({
            ...current,
            name,
            formatRaw: format,
            format: format && isDeckFormat(format) ? format : null,
          }))
        }
      />

      {undoState && (
        <UndoToast
          token={undoState.token}
          message={undoState.message}
          onUndo={() => void handleUndoRemove()}
          onExpire={() => setUndoState(null)}
        />
      )}
    </div>
  )
}
