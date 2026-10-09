'use client'

// Feuille `Binder look` (écran `Binder look sheet`). Trois états mutuellement
// exclusifs seulement : le brouillon (`draft`) porte toujours `cover_gradient`
// OU `cover_card_id`, jamais les deux — `saveBinderLookAction` efface celui
// qui n'est pas du mode retenu, ce composant ne construit donc jamais un objet où
// les deux seraient renseignés à la fois.
//
// Quatrième état `commander` (réutilisé par
// `components/decks/deck-backdrop.tsx`) — visible uniquement quand
// `commanderCardId` est fourni (un deck avec un commandant réel à montrer,
// jamais un binder ni un deck sans commandant : rien à prévisualiser sinon).
// Sélectionné par défaut dans ce cas
// puisque `saveBinderLookAction` persiste `commander` exactement comme
// `none` (aucune colonne dédiée) — un deck non configuré (`cover_gradient`/
// `cover_card_id` tous deux `null`) porte donc toujours ce brouillon initial
// dès qu'un commandant existe, jamais `none`.
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { GradientSwatch } from '@/components/binders/gradient-swatch'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { BINDER_GRADIENTS, type GradientKey } from '@/lib/binders/gradients'
import { thumbUrl } from '@spellcache/core/images'
import { ScrollArea } from '@/components/ui/scroll-area'

import { searchCatalogAction } from '@/app/(app)/search/actions'
import {
  saveBinderLookAction,
  type BinderLook,
  type SaveBinderLookResult,
} from '@/app/(app)/container/[id]/binder-actions'
import type { CardSearchItem } from '@/lib/search/search-cards'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

const GRADIENT_KEYS: GradientKey[] = Object.keys(BINDER_GRADIENTS) as GradientKey[]

type LookMode = BinderLook['mode']

// Titre selon la cible — `binder`/`list`/`deck` sont les trois containers qui
// portent les mêmes colonnes `cover_gradient`/`cover_card_id`/`cover_intensity`.
// `target` retombe sur `'binder'` par défaut :
// `container-action-sheets.tsx` ouvre cette feuille pour un binder ou une
// liste — seul `deck-view.tsx` a un vrai commandant à distinguer.
const TITLES: Record<'binder' | 'list' | 'deck', string> = {
  binder: 'Binder look',
  list: 'List look',
  deck: 'Deck look',
}

const BASE_MODE_OPTIONS: Array<{ value: LookMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'colour', label: 'Colour' },
  { value: 'art', label: 'Card art' },
]

// Recherche minimale avant d'interroger le catalogue (« Type two letters or
// more ») — deux caractères, pas un (la recherche
// pleine-texte du catalogue dégraderait en balayage de table sur un seul).
const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 200
const SEARCH_LIMIT = 36

// Anneau de sélection d'une tuile d'art (même patron que `gradient-swatch.tsx` :
// composition à deux couches hors du namespace `--shadow-*`, jamais une
// classe Tailwind arbitraire `shadow-[...]`, interdite par docs/development.md).
const SELECTED_RING_SHADOW = '0 0 0 2px var(--color-surface-3), 0 0 0 4px var(--color-accent)'

// Quatrième option, ajoutée en fin de segmenté uniquement quand un
// commandant existe à montrer — voir le commentaire de tête de ce fichier.
const COMMANDER_MODE_OPTION: { value: LookMode; label: string } = {
  value: 'commander',
  label: 'Commander art',
}

const DEFAULT_GRADIENT: GradientKey = 'blue'
const DEFAULT_INTENSITY = 0.52

// Brouillon local de la feuille — surface plus large que `BinderLook` (porte
// `gradient`/`cardId`/`intensity` quel que soit `mode` courant) pour que
// basculer de segment ne perde pas la sélection déjà faite dans un autre
// mode (ex. revenir sur `Colour` après avoir ouvert `Card art` garde la
// pastille choisie) — seul `toBinderLook` ci-dessous réduit ce brouillon au
// contrat réellement persisté.
interface LookDraft {
  mode: LookMode
  gradient: GradientKey
  cardId: string | null
  intensity: number
}

// `hasCommander` bascule le repli de `mode: 'none'` (`Commander art` est
// sélectionné par défaut sur un deck avec commandant) —
// `saveBinderLookAction` persiste les deux identiquement (voir
// `binder-actions.ts`), donc un deck non configuré porte toujours
// `{ mode: 'none' }` en base, quel que soit son commandant : c'est ici,
// à la lecture, que le brouillon choisit le libellé/segment par défaut.
function fromBinderLook(look: BinderLook, hasCommander: boolean): LookDraft {
  if (look.mode === 'colour') {
    return {
      mode: 'colour',
      gradient: look.gradient,
      cardId: null,
      intensity: look.intensity,
    }
  }
  if (look.mode === 'art') {
    return {
      mode: 'art',
      gradient: DEFAULT_GRADIENT,
      cardId: look.cardId,
      intensity: look.intensity,
    }
  }
  if (look.mode === 'commander') {
    return {
      mode: 'commander',
      gradient: DEFAULT_GRADIENT,
      cardId: null,
      intensity: DEFAULT_INTENSITY,
    }
  }
  return {
    mode: hasCommander ? 'commander' : 'none',
    gradient: DEFAULT_GRADIENT,
    cardId: null,
    intensity: DEFAULT_INTENSITY,
  }
}

function toBinderLook(draft: LookDraft): BinderLook {
  if (draft.mode === 'colour')
    return { mode: 'colour', gradient: draft.gradient, intensity: draft.intensity }
  if (draft.mode === 'art' && draft.cardId) {
    return { mode: 'art', cardId: draft.cardId, intensity: draft.intensity }
  }
  if (draft.mode === 'commander') return { mode: 'commander' }
  return { mode: 'none' }
}

export function LookSheet({
  open,
  onOpenChange,
  containerId,
  initialLook,
  // Titre de la feuille — `binder` par défaut.
  target = 'binder',
  // Présence d'un commandant à montrer — `undefined`/`null`
  // pour un binder (jamais de commandant) ou un deck sans commandant :
  // le segment `Commander art` n'apparaît alors pas (voir `BASE_MODE_OPTIONS`).
  commanderCardId = null,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  containerId: string
  initialLook: BinderLook
  target?: 'binder' | 'list' | 'deck'
  commanderCardId?: string | null
  onSaved: (look: BinderLook, coverArtist: string | null) => void
}) {
  const hasCommander = commanderCardId !== null
  const modeOptions = hasCommander
    ? [...BASE_MODE_OPTIONS, COMMANDER_MODE_OPTION]
    : BASE_MODE_OPTIONS

  const [draft, setDraft] = useState<LookDraft>(() =>
    fromBinderLook(initialLook, hasCommander),
  )
  // Recherche sur TOUT le catalogue (« Card art is a search over every card,
  // not a pick from what the container holds ») via `searchCatalogAction`,
  // jamais limitée aux cartes du binder.
  // Un cover est une image, pas une revendication de possession : un binder
  // vide a quand même une apparence à choisir.
  const [cardQuery, setCardQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CardSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Le brouillon reflète toujours le dernier look persisté à l'ouverture —
  // jamais celui d'une ouverture précédente (`Reset` ne modifie que le
  // brouillon, une fermeture sans sauvegarde ne doit donc pas non plus
  // laisser de brouillon périmé pour la prochaine ouverture).
  useEffect(() => {
    if (open) {
      setDraft(fromBinderLook(initialLook, hasCommander))
      setError(null)
      setCardQuery('')
      setSearchResults([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || draft.mode !== 'art') return
    const query = cardQuery.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setSearchResults([])
      setSearching(false)
      setSearchFailed(false)
      return
    }
    let cancelled = false
    setSearching(true)
    setSearchFailed(false)
    const timeout = setTimeout(() => {
      void searchCatalogAction({ query, limit: SEARCH_LIMIT }).then((result) => {
        if (cancelled) return
        setSearching(false)
        if ('error' in result) {
          setSearchFailed(true)
          setSearchResults([])
          return
        }
        setSearchResults(result.items)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [open, draft.mode, cardQuery])

  async function handleSave() {
    setSubmitting(true)
    setError(null)

    const look = toBinderLook(draft)
    const result: SaveBinderLookResult = await saveBinderLookAction({ containerId, look })

    if (!result.ok) {
      setError(
        result.error === 'unknown_card'
          ? 'That card is gone from the catalogue. Pick another.'
          : 'Could not save this look. Try again.',
      )
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onSaved(look, result.coverArtist)
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={TITLES[target]}
      headerAction={
        <button
          type="button"
          // `Reset` retombe sur le vrai défaut — `commander` pour un deck
          // avec commandant, `none` sinon, jamais l'inverse.
          onClick={() =>
            setDraft((current) => ({
              ...current,
              mode: hasCommander ? 'commander' : 'none',
            }))
          }
          className="text-meta font-bold text-accent-text"
        >
          Reset
        </button>
      }
    >
      <Segmented
        size="compact"
        options={modeOptions}
        value={draft.mode}
        onChange={(mode) => setDraft((current) => ({ ...current, mode }))}
      />

      <div className="mb-18 mt-18">
        {draft.mode === 'commander' && (
          <p className="text-look-hint leading-normal text-text-3">
            Uses the commander&rsquo;s own art, no setup. Pick{' '}
            <strong className="font-bold text-text-2">Colour</strong> or{' '}
            <strong className="font-bold text-text-2">Card art</strong> above to override
            it.
          </p>
        )}
        {draft.mode === 'colour' && (
          <>
            <div className="mb-10 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Colour
            </div>
            <div className="flex flex-wrap gap-10">
              {GRADIENT_KEYS.map((key) => (
                <GradientSwatch
                  key={key}
                  gradientKey={key}
                  selected={draft.gradient === key}
                  onSelect={() => setDraft((current) => ({ ...current, gradient: key }))}
                />
              ))}
            </div>
            <p className="mt-18 text-look-hint leading-normal text-text-3">
              Tints the binder header and its row in the collection. Pick{' '}
              <strong className="font-bold text-text-2">Card art</strong> above to use a
              card instead.
            </p>
          </>
        )}

        {draft.mode === 'art' && (
          <>
            <div className="mb-10 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Card art
            </div>
            <div className="relative mb-12">
              <Search
                width={15}
                height={15}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-text-3"
              />
              <input
                {...SEARCH_INPUT_PROPS}
                value={cardQuery}
                onChange={(event) => setCardQuery(event.target.value)}
                placeholder="Search a card by name..."
                aria-label="Search a card by name"
                className="w-full rounded-control border border-border bg-surface-2 py-10 pl-32 pr-10 text-body text-text outline-none placeholder:text-text-3"
              />
            </div>

            {searching && <p className="px-2 pb-6 text-look-hint text-text-3">Searching...</p>}
            {searchFailed && (
              <p className="px-2 pb-6 text-look-hint text-danger">Search failed. Try again.</p>
            )}
            {!searching &&
              !searchFailed &&
              cardQuery.trim().length >= MIN_QUERY_LENGTH &&
              searchResults.length === 0 && (
                <p className="px-2 pb-6 text-look-hint text-text-3">
                  No card with art under that name.
                </p>
              )}
            {cardQuery.trim().length < MIN_QUERY_LENGTH && (
              <p className="px-2 pb-6 text-look-hint leading-normal text-text-3">
                Type two letters or more. Any card can be the backdrop — it does not have to
                be one you own.
              </p>
            )}

            {searchResults.length > 0 && (
              <ScrollArea className="max-h-look-art-grid">
                <div
                  className="grid gap-8 pr-4"
                  style={{
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(var(--width-look-art-tile-min), 1fr))',
                  }}
                >
                  {searchResults.map((card) => {
                    const artUrl = thumbUrl(card.id, 'art_crop')
                    const selected = draft.cardId === card.id
                    return (
                      <button
                        key={card.id}
                        type="button"
                        title={card.name}
                        aria-pressed={selected}
                        onClick={() => setDraft((current) => ({ ...current, cardId: card.id }))}
                        style={{ boxShadow: selected ? SELECTED_RING_SHADOW : undefined }}
                        className="h-look-art-tile w-full flex-shrink-0 overflow-hidden rounded-look-art-tile bg-surface-2 p-0"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne */}
                        <img
                          src={artUrl}
                          alt={card.name}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </>
        )}
      </div>

      {error && <p className="mb-14 text-meta text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={submitting || (draft.mode === 'art' && !draft.cardId)}
        className="w-full rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save look'}
      </button>
    </Sheet>
  )
}
