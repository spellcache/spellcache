'use client'

// Ajout d'une carte, en trois étapes (réutilise la recherche catalogue) :
// recherche par nom → choix d'une impression → quantité/foil/condition/langue.
//
// `presetCard` : un résultat déjà choisi (clic sur une ligne de l'onglet
// Search ou de l'écran d'un set) saute directement à la troisième étape, sans passer par la recherche ni
// par le choix d'impression — la ligne cliquée EST déjà une impression
// précise. `containerId: null` ajoute au container racine de la collection
// (résolu côté serveur, `container/[id]/actions.ts`) — bouton « Add to
// collection » ; tout autre container — bouton « Add to binder ».
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import { printingsAction, searchCatalogAction } from '@/app/(app)/search/actions'
import { SearchRow } from '@/components/search/search-row'
import { CardImage } from '@/components/ui/card-image'
import { SearchField } from '@/components/ui/search-field'
import { Sheet } from '@/components/ui/sheet'
import { useSwipe } from '@/components/ui/use-swipe'
import { PrimaryButton, SectionLabel } from '@/components/ui/sheet-controls'
import type { Condition } from '@spellcache/db/schema'
import { useCanEdit } from '@/lib/collections/access-context'
import type { Currency } from '@/lib/format/money'
import { thumbUrl } from '@spellcache/core/images'
import type { CardSearchItem } from '@/lib/search/search-cards'

import { addCardAction } from './actions'

const CONDITIONS: Condition[] = ['nm', 'lp', 'mp', 'hp', 'dmg']
const CONDITION_LABEL: Record<Condition, string> = {
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
  hp: 'HP',
  dmg: 'DMG',
}

// La recherche texte ne part qu'à partir de 2 caractères, comme l'onglet
// Search.
const MIN_QUERY_LENGTH = 2

// L'impression choisie — ce que la troisième étape montre et ajoute. Un
// `presetCard` (déjà une impression précise) et une ligne de la liste de
// printings (étape 2) convergent tous deux vers cette même forme.
interface ChosenPrinting {
  id: string
  name: string
  setCode: string
  setName: string
  collectorNumber: string
  imageUrl: string | null
}

function fromCardSearchItem(item: CardSearchItem): ChosenPrinting {
  return {
    id: item.id,
    name: item.name,
    setCode: item.setCode,
    setName: item.setName,
    collectorNumber: item.collectorNumber,
    imageUrl: item.imageUrl,
  }
}

// Devise par défaut avant toute réponse serveur — `cardmarket_eur` est le
// défaut de compte (`lib/preferences.ts`, `DEFAULT_PREFERENCES.priceSource`),
// jamais `usd` en dur.
const DEFAULT_CURRENCY: Currency = 'eur'

export function AddCardSheet({
  open,
  onOpenChange,
  containerId,
  onAdded,
  presetCard = null,
  presetCurrency,
  // Une liste libelle « Add to list » ;
  // sans effet quand `containerId === null` (« Add to collection »).
  containerKind = 'binder',
  onPrevious,
  onNext,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string | null
  onAdded: () => void
  presetCard?: CardSearchItem | null
  presetCurrency?: Currency
  containerKind?: 'binder' | 'list'
  // Résultat voisin de la recherche (balayage, `←`/`→`), avec `presetCard`
  // seulement : sans carte préchargée, la feuille cherche elle-même.
  onPrevious?: () => void
  onNext?: () => void
}) {
  const isPreset = presetCard !== null
  const swipe = useSwipe({ onPrevious, onNext, keyboard: open && isPreset })
  // Lecture seule (`viewer`) : ouverte depuis Search, la feuille ne montre
  // plus que la carte — ni formulaire d'ajout, ni bouton `Add to ...`.
  const canEdit = useCanEdit()

  const [results, setResults] = useState<CardSearchItem[]>([])
  const [lastQuery, setLastQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)

  const [selectedCard, setSelectedCard] = useState<CardSearchItem | null>(null)
  const [printings, setPrintings] = useState<CardSearchItem[]>([])
  const [printingsLoading, setPrintingsLoading] = useState(false)
  const [printingsFailed, setPrintingsFailed] = useState(false)

  const [selectedPrinting, setSelectedPrinting] = useState<ChosenPrinting | null>(
    presetCard ? fromCardSearchItem(presetCard) : null,
  )
  const [currency, setCurrency] = useState<Currency>(presetCurrency ?? DEFAULT_CURRENCY)

  const [quantity, setQuantity] = useState(1)
  const [foil, setFoil] = useState(false)
  const [condition, setCondition] = useState<Condition>('nm')
  const [language, setLanguage] = useState('en')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setResults([])
    setLastQuery('')
    setSearching(false)
    setSearchFailed(false)
    setSelectedCard(null)
    setPrintings([])
    setPrintingsLoading(false)
    setPrintingsFailed(false)
    setSelectedPrinting(presetCard ? fromCardSearchItem(presetCard) : null)
    setCurrency(presetCurrency ?? DEFAULT_CURRENCY)
    setQuantity(1)
    setFoil(false)
    setCondition('nm')
    setLanguage('en')
    setSubmitting(false)
    setError(null)
  }

  async function handleSearch(query: string) {
    const trimmed = query.trim()
    setLastQuery(trimmed)
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setSearchFailed(false)
      return
    }
    setSearching(true)
    try {
      const result = await searchCatalogAction({ query: trimmed, scope: 'search' })
      if ('error' in result) {
        setSearchFailed(true)
      } else {
        setResults(result.items)
        setCurrency(result.currency)
        setSearchFailed(false)
      }
    } catch {
      setSearchFailed(true)
    } finally {
      setSearching(false)
    }
  }

  async function handlePickCard(card: CardSearchItem) {
    setSelectedCard(card)
    setPrintings([])
    setPrintingsFailed(false)
    setPrintingsLoading(true)
    try {
      const result = await printingsAction({ name: card.name })
      setCurrency(result.currency)
      // Mappées vers la forme de `CardSearchItem` pour réutiliser
      // `SearchRow` telle quelle (nom/coût de mana/type communs à toutes
      // les impressions d'un même nom) plutôt qu'une seconde
      // ligne dédiée.
      setPrintings(
        result.items.map((printing) => ({
          id: printing.id,
          name: card.name,
          setCode: printing.setCode,
          setName: printing.setName,
          collectorNumber: printing.collectorNumber,
          rarity: printing.rarity,
          manaCost: card.manaCost,
          typeLine: card.typeLine,
          thumbUrl: thumbUrl(printing.id, 'small'),
          imageUrl: printing.imageUrl,
          price: printing.price,
          colorIdentity: card.colorIdentity,
        })),
      )
    } catch {
      setPrintingsFailed(true)
    } finally {
      setPrintingsLoading(false)
    }
  }

  async function handleAdd() {
    if (!selectedPrinting) return
    setSubmitting(true)
    setError(null)

    const result = await addCardAction({
      containerId,
      cardId: selectedPrinting.id,
      finish: foil ? 'foil' : 'nonfoil',
      condition,
      qty: quantity,
      language,
    })

    if (!result.ok) {
      setError('Could not add this card. Please try again.')
      setSubmitting(false)
      return
    }

    onAdded()
    reset()
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      // Lecture seule : titrée au nom de la carte, comme `CardSheet`.
      title={!canEdit && selectedPrinting ? selectedPrinting.name : 'Add card'}
    >
      {!selectedCard && !selectedPrinting && (
        <div className="flex flex-col gap-10">
          <SearchField placeholder="Search card name..." onSearch={(value) => void handleSearch(value)} autoFocus />

          {searching && <p className="px-2 text-meta text-text-2">Searching...</p>}
          {!searching && searchFailed && (
            <p className="px-2 text-meta text-danger">Search failed. Try again.</p>
          )}
          {!searching && !searchFailed && lastQuery.length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <p className="px-2 text-meta text-text-2">No cards found.</p>
          )}

          <div className="flex flex-col gap-8">
            {results.map((item) => (
              <SearchRow
                key={item.id}
                item={item}
                currency={currency}
                onClick={() => void handlePickCard(item)}
              />
            ))}
          </div>
        </div>
      )}

      {selectedCard && !selectedPrinting && (
        <div className="flex flex-col gap-10">
          <button
            type="button"
            onClick={() => {
              setSelectedCard(null)
              setPrintings([])
            }}
            className="flex w-fit items-center gap-4 text-meta font-semibold text-text-2"
          >
            <ChevronLeft width={15} height={15} strokeWidth={1.9} />
            Back to search
          </button>

          <p className="text-meta text-text-2">
            Choose a printing of <span className="font-bold text-text">{selectedCard.name}</span>
          </p>

          {printingsLoading && <p className="text-meta text-text-2">Loading printings...</p>}
          {!printingsLoading && printingsFailed && (
            <p className="text-meta text-danger">Could not load printings.</p>
          )}

          <div className="flex flex-col gap-8">
            {printings.map((printing) => (
              <SearchRow
                key={printing.id}
                item={printing}
                currency={currency}
                onClick={() =>
                  setSelectedPrinting({
                    id: printing.id,
                    name: printing.name,
                    setCode: printing.setCode,
                    setName: printing.setName,
                    collectorNumber: printing.collectorNumber,
                    imageUrl: printing.imageUrl,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {selectedPrinting && (
        <div className="flex flex-col gap-14" {...(isPreset ? swipe : {})}>
          {!isPreset && (
            <button
              type="button"
              onClick={() => setSelectedPrinting(null)}
              className="flex w-fit items-center gap-4 text-meta font-semibold text-text-2"
            >
              <ChevronLeft width={15} height={15} strokeWidth={1.9} />
              Back to printings
            </button>
          )}

          <CardImage
            src={selectedPrinting.imageUrl}
            alt={selectedPrinting.name}
            onPrevious={isPreset ? onPrevious : undefined}
            onNext={isPreset ? onNext : undefined}
          />

          <div>
            <div className="text-row-value font-bold text-text">{selectedPrinting.name}</div>
            <div className="mt-2 text-meta text-text-2">
              {selectedPrinting.setName} ({selectedPrinting.setCode.toUpperCase()}) #
              {selectedPrinting.collectorNumber}
            </div>
          </div>

          {canEdit && (
          <>
          <div>
            <SectionLabel>Quantity</SectionLabel>
            <div className="flex items-center gap-12">
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                className="flex h-touch-target w-touch-target items-center justify-center"
              >
                <span className="flex h-qty-button w-qty-button items-center justify-center rounded-full bg-surface-2 text-body font-bold text-text">
                  −
                </span>
              </button>
              <span className="min-w-qty-value text-center font-mono text-body font-bold text-text">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((value) => value + 1)}
                className="flex h-touch-target w-touch-target items-center justify-center"
              >
                <span className="flex h-qty-button w-qty-button items-center justify-center rounded-full bg-surface-2 text-body font-bold text-text">
                  +
                </span>
              </button>
            </div>
          </div>

          <div>
            <SectionLabel>Finish</SectionLabel>
            <div className="flex gap-8">
              <button
                type="button"
                onClick={() => setFoil(false)}
                className={
                  !foil
                    ? 'flex-1 rounded-control border border-border-accent bg-accent-bg py-9 text-body font-bold text-accent-text'
                    : 'flex-1 rounded-control border border-border bg-surface-2 py-9 text-body font-bold text-text-2'
                }
              >
                Non-foil
              </button>
              <button
                type="button"
                onClick={() => setFoil(true)}
                className={
                  foil
                    ? 'flex-1 rounded-control border border-border-accent bg-accent-bg py-9 text-body font-bold text-accent-text'
                    : 'flex-1 rounded-control border border-border bg-surface-2 py-9 text-body font-bold text-text-2'
                }
              >
                Foil
              </button>
            </div>
          </div>

          <div>
            <SectionLabel>Condition</SectionLabel>
            <div className="flex flex-wrap gap-6">
              {CONDITIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCondition(option)}
                  className={
                    condition === option
                      ? 'rounded-pill border border-border-accent bg-accent-bg px-12 py-7 text-meta font-bold text-accent-text'
                      : 'rounded-pill border border-border bg-surface-2 px-12 py-7 text-meta font-bold text-text-2'
                  }
                >
                  {CONDITION_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Language</SectionLabel>
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              aria-label="Language"
              className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-body text-text outline-none"
            />
          </div>

          {error && <p className="text-meta text-danger">{error}</p>}

          <PrimaryButton onClick={() => void handleAdd()} disabled={submitting}>
            {submitting
              ? 'Adding...'
              : containerId === null
                ? 'Add to collection'
                : containerKind === 'list'
                  ? 'Add to list'
                  : 'Add to binder'}
          </PrimaryButton>
          </>
          )}
        </div>
      )}
    </Sheet>
  )
}
