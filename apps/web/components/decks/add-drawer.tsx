'use client'

// Tiroir d'ajout persistant (écran `Builder · persistent add drawer`).
// Volontairement pas un `Sheet` (Radix Dialog) : un `Sheet` se ferme au clic
// extérieur et à `Escape`, et un tiroir qui se ferme après un ajout est
// précisément ce que cette feature supprime. Un simple panneau fixe, jamais démonté tant que
// `open` est vrai, fermé par sa croix, `Done · N added` ou le retour Android.
import { Check, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AddRow } from '@/components/cards/add-row'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { useBackToClose } from '@/components/ui/use-back-to-close'
import type { DeckZone, Finish } from '@spellcache/db/schema'

import {
  addToDeckAction,
  searchDeckCardsAction,
} from '@/app/(app)/decks/[id]/builder-actions'
import type { AddDrawerCard, DeckDetail } from '@/app/(app)/decks/[id]/deck-data'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

const SEARCH_DEBOUNCE_MS = 200

export interface AddDrawerFilters {
  legalInColours: boolean
  ownedOnly: boolean
}

export interface AddDrawerCounts {
  main: number
  side: number
  commander: number
}

const ZONE_LABELS: Record<DeckZone, string> = {
  main: 'Main',
  side: 'Side',
  commander: 'Cmdr',
}
const ZONE_ORDER: DeckZone[] = ['main', 'side', 'commander']

// Sélecteur d'impression à la demande —
// libellés au même gabarit que le toggle `Finish` de `AddCardSheet`
// (`app/(app)/container/[id]/add-card-sheet.tsx`), vocabulaire déjà établi
// plutôt qu'inventé.
const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
}

// Puces de filtre du tiroir — un gabarit propre à cet
// écran, pas `components/ui/chip.tsx` : `Owned only` porte une bordure
// `dashed` à l'état inactif que le composant partagé ne modélise pas
// (celui-ci n'a que deux états pleins). L'état actif (coche + accent) sert
// aux deux puces ; seul l'état inactif de repos diffère entre elles — pour
// `Legal in deck colours`, le design validé ne montre pas son état inactif : il
// reprend le gabarit plein générique plutôt que d'inventer un second style.
function FilterChip({
  label,
  selected,
  dashedWhenInactive = false,
  onClick,
}: {
  label: string
  selected: boolean
  dashedWhenInactive?: boolean
  onClick: () => void
}) {
  const inactiveClass = dashedWhenInactive
    ? 'border-dashed border-border-dashed bg-surface-1 text-text-2'
    : 'border-border bg-surface-2 text-text-2'

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex items-center gap-5 rounded-pill border px-10 py-5 text-chip-toggle font-bold ${
        selected
          ? 'border-border-accent-subtle bg-accent-bg text-accent-text'
          : inactiveClass
      }`}
    >
      {selected && <Check width={12} height={12} strokeWidth={2.2} />}
      {label}
    </button>
  )
}

export function AddDrawer({
  deckId,
  open,
  // La zone `Cmdr` n'existe qu'en Commander (demande produit) — les autres
  // formats n'ont ni commandant ni règles.
  showCommanderZone = true,
  zone,
  onZoneChange,
  filters,
  onFiltersChange,
  toGo,
  counts,
  colorIdentity,
  onClose,
  onOptimisticAdd,
  onCardAdded,
  onCardAddFailed,
}: {
  deckId: string
  open: boolean
  showCommanderZone?: boolean
  zone: DeckZone
  onZoneChange: (zone: DeckZone) => void
  filters: AddDrawerFilters
  onFiltersChange: (filters: AddDrawerFilters) => void
  toGo: number | null
  counts: AddDrawerCounts
  colorIdentity: string[]
  onClose: () => void
  // Trois temps, tous optimistes (docs/development.md :
  // « mises à jour optimistes sur toutes les quantités, avec retour arrière
  // en cas d'échec ») : `onOptimisticAdd` applique le tap localement à
  // l'écran derrière le tiroir *avant* la réponse serveur, `onCardAdded`
  // réconcilie avec la vérité serveur à la réponse, `onCardAddFailed`
  // annule exactement ce tap si la Server Action échoue.
  onOptimisticAdd: (card: AddDrawerCard, zone: DeckZone) => void
  onCardAdded: (
    card: AddDrawerCard,
    zone: DeckZone,
    result: { qtyInDeck: number; coverage: DeckDetail['coverage'] },
  ) => void
  onCardAddFailed: (card: AddDrawerCard, zone: DeckZone) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddDrawerCard[]>([])
  const [sessionAdded, setSessionAdded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // « Searching... » pendant la requête : un signal entre la frappe et la
  // réponse.
  const [searching, setSearching] = useState(false)
  // Sélecteur d'impression à la demande — `null` tant
  // qu'aucune ligne ne l'a ouvert (`AddRow.onOpenPrintingPicker`).
  const [printingPickerCard, setPrintingPickerCard] = useState<AddDrawerCard | null>(null)
  const requestId = useRef(0)

  // Le tiroir garde son propre brouillon de recherche, débouncé (même
  // patron que `components/command-bar/command-bar.tsx`) — la recherche
  // porte sur le catalogue, jamais la collection.
  //
  // Volontairement pas de `zone` dans les dépendances (changer de zone
  // n'efface ni la recherche, ni les résultats) : `AddDrawerCard.inDeckQty` est une
  // quantité deck-wide (voir son commentaire dans `deck-data.ts`),
  // indépendante de la zone sélectionnée — changer de zone n'a donc rien à
  // rafraîchir ici.
  useEffect(() => {
    if (!open) return
    setSearching(true)
    const timeout = setTimeout(() => {
      const thisRequest = ++requestId.current
      void searchDeckCardsAction({
        deckId,
        query,
        colorIdentity,
        legalInColours: filters.legalInColours,
        ownedOnly: filters.ownedOnly,
      }).then((result) => {
        if (thisRequest !== requestId.current) return
        setSearching(false)
        if (!('error' in result)) setResults(result)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [open, deckId, query, colorIdentity, filters.legalInColours, filters.ownedOnly])

  // Réinitialise la session (le compteur `Done · N added`, jamais la
  // recherche ni les filtres) à chaque ouverture : le nombre annoncé égale
  // le nombre réel d'ajouts de la session.
  useEffect(() => {
    if (open) {
      setSessionAdded(0)
      setError(null)
    }
  }, [open])

  useBackToClose(open, onClose)

  if (!open) return null

  // Optimiste et local (docs/development.md), un tap = un effet
  // immédiat : le bouton n'est jamais désactivé en
  // attendant la réponse, chaque tap bascule aussitôt son propre delta —
  // `in deck ×N`, `Done · N added` et l'écran derrière le tiroir — puis la
  // Server Action tourne en tâche de fond. Un second tap pendant le
  // round-trip du premier n'est donc plus perdu : il déclenche sa propre
  // requête, réconciliée indépendamment à son retour.
  // `finish` par défaut `nonfoil` (le tap unique du bouton `+`) — le
  // sélecteur d'impression à la demande
  // rappelle cette même fonction avec la finition
  // choisie, sans dupliquer la logique optimiste/rollback ci-dessous.
  function handleAdd(card: AddDrawerCard, finish: Finish = 'nonfoil') {
    setError(null)
    setSessionAdded((n) => n + 1)
    setResults((current) =>
      current.map((c) =>
        c.cardId === card.cardId ? { ...c, inDeckQty: c.inDeckQty + 1 } : c,
      ),
    )
    onOptimisticAdd(card, activeZone)

    void addToDeckAction({ deckId, cardId: card.cardId, zone: activeZone, finish }).then((result) => {
      if (!result.ok) {
        // Retour arrière : annule exactement ce tap, jamais les autres
        // (docs/development.md « retour arrière en cas d'échec »).
        setSessionAdded((n) => Math.max(0, n - 1))
        setResults((current) =>
          current.map((c) =>
            c.cardId === card.cardId
              ? { ...c, inDeckQty: Math.max(0, c.inDeckQty - 1) }
              : c,
          ),
        )
        onCardAddFailed(card, activeZone)
        setError(
          result.error === 'commander_full'
            ? 'This deck already has a commander.'
            : 'Could not add that card. Try again.',
        )
        return
      }

      // `result.qtyInDeck` est scopé à `zone` (`builder-actions.ts`, pour que `deck-view.tsx`/`handleCardAdded`
      // pose la bonne valeur sur le slot de la zone qui vient de recevoir
      // l'ajout) : une sémantique différente de `AddDrawerCard.inDeckQty`
      // ci-dessus (deck-wide). Ne JAMAIS écraser `inDeckQty` avec cette
      // valeur — le delta optimiste appliqué plus haut (`c.inDeckQty + 1`)
      // est déjà exact : un ajout réussi ajoute toujours précisément un
      // exemplaire au total du deck, quelle que soit sa zone, donc rien à
      // réconcilier ici. `onCardAdded` ci-dessous reste le seul consommateur
      // de `result.qtyInDeck`.
      onCardAdded(card, activeZone, { qtyInDeck: result.qtyInDeck, coverage: result.coverage })
    })
  }

  const visibleZones = showCommanderZone
    ? ZONE_ORDER
    : ZONE_ORDER.filter((z) => z !== 'commander')
  // Une zone `commander` résiduelle (format changé pendant que l'état la
  // portait) retombe sur `Main` — jamais un segment sélectionné invisible.
  const activeZone: DeckZone = !showCommanderZone && zone === 'commander' ? 'main' : zone
  const zoneOptions = visibleZones.map((z) => ({
    value: z,
    label: `${ZONE_LABELS[z]} · ${counts[z]}`,
  }))

  return (
    <div className="fixed inset-x-0 bottom-keyboard-inset z-30 flex h-add-drawer flex-col rounded-t-card border-t border-border-device bg-surface-3 px-16 pb-drawer-bottom pt-14 shadow-drawer">
      <div className="mx-auto mb-12 h-drawer-handle w-drawer-handle rounded-full bg-text-3" />
      <div className="mb-12 flex items-center gap-10">
        <div className="min-w-0 flex-1 text-drawer-title font-extrabold tracking-title-subscreen text-text">
          Add cards
        </div>
        {/* Compteur `to go` en warning — pas
            simplement `text-2`, c'est un manque qui reste à combler. */}
        {toGo !== null && (
          <div className="text-drawer-counter font-semibold text-warning">
            {toGo} to go
          </div>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-drawer-close w-drawer-close flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2"
        >
          <X width={16} height={16} strokeWidth={1.75} />
        </button>
      </div>

      <Segmented
        size="drawer"
        options={zoneOptions}
        value={activeZone}
        onChange={onZoneChange}
      />

      <div className="relative mt-10">
        {/* Icône absolue `left-11`, `#4a505e` (`text-text-3`), 32px d'inset
            gauche sur le champ et police 14px, comme le champ de l'écran
            derrière (`deck-view.tsx`, « Find in this deck... »). */}
        <Search
          width={15}
          height={15}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-text-3"
        />
        <input
          {...SEARCH_INPUT_PROPS}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // « Search card name... » (au caractère près) — « Find in this deck... » appartient au champ de l'écran
          // derrière (`deck-view.tsx`, qui cherche dans les slots déjà en
          // deck) ; ce champ-ci cherche le catalogue entier.
          placeholder="Search card name..."
          aria-label="Search card name"
          className="w-full rounded-control border border-border bg-surface-2 py-11 pl-32 pr-10 text-add-drawer-search text-text outline-none placeholder:text-text-3"
        />
      </div>

      <div className="mb-12 mt-10 flex flex-wrap gap-6">
        <FilterChip
          label="Legal in deck colours"
          selected={filters.legalInColours}
          onClick={() =>
            onFiltersChange({ ...filters, legalInColours: !filters.legalInColours })
          }
        />
        <FilterChip
          label="Owned only"
          selected={filters.ownedOnly}
          dashedWhenInactive
          onClick={() => onFiltersChange({ ...filters, ownedOnly: !filters.ownedOnly })}
        />
      </div>

      {error && <p className="mb-8 text-meta text-danger">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto overflow-x-hidden overscroll-contain">
        {/* « Searching... » pendant la requête ; « No cards found. »
            seulement à partir de deux caractères — en dessous, la recherche n'a encore rien à chercher, ce n'est pas
            un manque. */}
        {searching && <p className="px-2 text-meta text-text-2">Searching...</p>}
        {!searching && results.length === 0 && query.trim().length >= 2 && (
          <p className="px-2 text-meta text-text-2">No cards found.</p>
        )}
        {results.map((card) => (
          <AddRow
            key={card.cardId}
            thumbUrl={card.thumbUrl}
            name={card.name}
            manaCost={card.manaCost}
            setLine={card.setLine}
            price={card.price}
            currency={card.currency}
            ownedElsewhere={card.ownedElsewhere}
            inDeckQty={card.inDeckQty}
            onAdd={() => handleAdd(card)}
            onOpenPrintingPicker={
              card.finishes.length > 1 ? () => setPrintingPickerCard(card) : undefined
            }
          />
        ))}
      </div>

      {/* Sélecteur d'impression à la demande —
          `closeLabel` distinct de la croix ronde du tiroir ci-dessus, les
          deux `aria-label="Close"` resteraient sinon montés en même temps. */}
      <Sheet
        open={printingPickerCard !== null}
        onOpenChange={(next) => {
          if (!next) setPrintingPickerCard(null)
        }}
        title={
          printingPickerCard
            ? `Choose a printing — ${printingPickerCard.name}`
            : 'Choose a printing'
        }
        closeLabel="Close printing picker"
      >
        <div className="flex flex-col gap-8">
          {printingPickerCard?.finishes.map((finishOption) => (
            <button
              key={finishOption}
              type="button"
              onClick={() => {
                const card = printingPickerCard
                setPrintingPickerCard(null)
                handleAdd(card, finishOption)
              }}
              className="rounded-control border border-border bg-surface-2 px-16 py-11 text-left text-body font-bold text-text"
            >
              {FINISH_LABEL[finishOption]}
            </button>
          ))}
        </div>
      </Sheet>

      <button
        type="button"
        onClick={onClose}
        className="mt-12 w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent"
      >
        {/* « Done » sans suffixe quand rien n'a été ajouté. */}
        Done{sessionAdded > 0 ? ` · ${sessionAdded} added` : ''}
      </button>
    </div>
  )
}
