'use client'

// `Collection › Decks` — les decks **montés**, ceux dont les cartes sont des
// entrées réelles de la collection. C'est la moitié « inventaire » des deux
// zones de decks de l'application ; l'autre est l'onglet `Decks`, l'atelier,
// où vivent les plans qui n'ont encore rien pris à la collection
// (`app/(app)/decks/folders-view.tsx`).
//
// Mêmes lignes et même filtre de légalité que l'atelier, délibérément : « quel
// deck a discrètement perdu des cartes quand j'en ai monté un autre » est
// exactement la question qu'on vient poser ici, et elle se lit sur la puce de
// statut sans ouvrir un seul deck.
import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { DeckListResult, DeckSummary } from '@/app/(app)/decks/decks-data'
import { DeckRow } from '@/components/decks/deck-row'
import { Screen } from '@/components/ui/screen'
import { formatCount, formatMoney } from '@/lib/format/money'

// Les trois seuils qui séparent réellement les decks montés, et rien de plus :
// un filtre qui viderait la liste n'est pas proposé (seul `All` l'est
// toujours).
type Tone = 'warn' | 'ok' | 'none'

const TONE_LABEL: Record<Tone, string> = {
  warn: 'Needs attention',
  ok: 'Legal',
  none: 'No format',
}

const TONES: Tone[] = ['warn', 'ok', 'none']

function toneOf(deck: DeckSummary): Tone | null {
  if (deck.status.kind === 'needsWork') return 'warn'
  if (deck.status.kind === 'noFormat') return 'none'
  // `noRules` : aucun panier de filtre — visible sous `All` seulement.
  if (deck.status.kind === 'noRules') return null
  return 'ok'
}

export function CollectionDecksView({ initial }: { initial: DeckListResult }) {
  const [filter, setFilter] = useState<Tone | 'all'>('all')

  const counts = useMemo(() => {
    const totals: Record<Tone, number> = { warn: 0, ok: 0, none: 0 }
    for (const deck of initial.decks) {
      const tone = toneOf(deck)
      if (tone !== null) totals[tone] += 1
    }
    return totals
  }, [initial.decks])

  const totalValueMinor = initial.decks.reduce((sum, deck) => sum + deck.valueMinor, 0)
  const visible =
    filter === 'all' ? initial.decks : initial.decks.filter((deck) => toneOf(deck) === filter)

  function chipClassName(active: boolean): string {
    return `rounded-pill border px-12 py-7 text-chip font-bold ${
      active
        ? 'border-border-accent-subtle bg-accent-bg text-accent-text'
        : 'border-border bg-surface-1 text-text-2'
    }`
  }

  return (
    <Screen
      header={
        <>
          <div className="mb-14 flex items-center gap-10">
            <button
              type="button"
              aria-label="Back"
              onClick={() => window.history.back()}
              className="flex h-back-button w-back-button flex-shrink-0 items-center justify-center rounded-full bg-surface-1 text-text"
            >
              <ChevronLeft width={20} height={20} strokeWidth={1.75} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-breadcrumb-container font-bold uppercase tracking-section-label text-text-3">
                Collection
              </div>
              <h1 className="truncate text-title-subscreen font-extrabold tracking-title-subscreen text-text">
                Decks
              </h1>
              {initial.decks.length > 0 && (
                <div className="mt-2 text-meta text-text-2">
                  {formatCount(initial.decks.length)} built deck
                  {initial.decks.length === 1 ? '' : 's'} ·{' '}
                  {formatMoney(totalValueMinor, initial.currency)}
                </div>
              )}
            </div>
          </div>

          {/* `All` sans compteur, rangée visible même à vide — même filtre que l'onglet Decks
              (`folders-view.tsx`). */}
          {initial.decks.length > 0 && (
            <div className="mb-14 flex flex-wrap gap-6">
              <button
                type="button"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
                className={chipClassName(filter === 'all')}
              >
                All
              </button>
              {TONES.map((tone) =>
                counts[tone] === 0 ? null : (
                  <button
                    key={tone}
                    type="button"
                    aria-pressed={filter === tone}
                    onClick={() => setFilter(tone)}
                    className={chipClassName(filter === tone)}
                  >
                    {TONE_LABEL[tone]} · {counts[tone]}
                  </button>
                ),
              )}
            </div>
          )}
        </>
      }
    >
      {initial.decks.length === 0 ? (
        <p className="px-4 text-body leading-normal text-text-2">
          No built deck yet. Plan one in the Decks tab, then assemble it once you have the cards.
        </p>
      ) : visible.length === 0 ? (
        <p className="px-4 text-body text-text-2">No deck matches this filter.</p>
      ) : (
        <div className="flex flex-col gap-11">
          {visible.map((deck) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              currency={initial.currency}
              // Un deck monté ouvre `/collection/decks/{id}` — la même route générique `/decks/{id}`
              // que l'atelier aurait ouvert un plan, jamais un deck construit.
              href={`/collection/decks/${deck.id}`}
            />
          ))}
        </div>
      )}
    </Screen>
  )
}
