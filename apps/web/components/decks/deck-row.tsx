// Ligne de deck de l'écran `Deck lists · commander art + legality`. Trois
// habillages, choisis dans cet ordre : l'habillage du deck
// (`resolveDeckLook`, lib/decks/deck-look.ts — le même que l'écran du deck :
// illustration choisie ou du commandant, sinon dégradé choisi) ; à défaut,
// dégradé d'identité colorée s'il y a un format (donc un statut autre que
// `noFormat`) ; à défaut (aucun format), surface nue. Une identité vide avec
// format retombe sur le dégradé `grey`, pas sur la surface nue.
//
// La puce de statut occupe toujours sa propre ligne sous le bloc
// titre/prix, `gap-9` — jamais en ligne
// avec le titre, quel que soit l'habillage.
//
// Hauteur fixe (`h-deck-row`) et contenu centré : une ligne sans puce
// (`noRules`) garde la hauteur des autres, le nom et la méta tiennent sur une
// ligne.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { StatusChip } from '@/components/decks/status-chip'
import type { DeckFormat, DeckStatus } from '@/lib/decks/legality'
import type { DeckState } from '@spellcache/db/schema'
import { binderRowBackground, type GradientKey } from '@/lib/binders/gradients'
import { gradientKeyForIdentity } from '@/lib/decks/identity'
import { formatMoney, type Currency } from '@/lib/format/money'

const FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: 'Commander',
  modern: 'Modern',
  standard: 'Standard',
  pioneer: 'Pioneer',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
}

export interface DeckRowData {
  id: string
  name: string
  format: DeckFormat | null
  // Texte brut de `containers.format` — un format libre inconnu des sept connus s'affiche tel
  // quel, jamais remplacé par « No format ».
  formatRaw: string | null
  deckState: DeckState
  cardCount: number
  valueMinor: number
  colorIdentity: string[]
  artUrl: string | null
  coverGradient: GradientKey | null
  status: DeckStatus
}

// « {format} · {N} cards » sans suffixe « · built » : le statut
// « built »/« legal » se lit déjà sur la puce juste en dessous, répéter la
// mention ici n'apprendrait rien de plus.
function metaLine(deck: DeckRowData): string {
  const formatLabel = deck.format ? FORMAT_LABELS[deck.format] : (deck.formatRaw ?? 'No format')
  return `${formatLabel} · ${deck.cardCount} cards`
}

// `colorIdentity` porte un type non-optionnel (`DeckRowData`), mais un
// brouillon local construit depuis un `CardSearchItem` lu en cache avant
// l'ajout de ce champ pouvait le porter `undefined` en pratique
// (corrigé depuis) — `?? []` évite un
// `TypeError` sur `.length` en seconde ligne de défense, la clé de cache
// versionnée (`lib/search/normalize.ts`) restant la correction de fond.
function IdentityPips({ colorIdentity }: { colorIdentity: string[] | undefined }) {
  const identity = colorIdentity ?? []
  if (identity.length === 0) return null
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-2">
      {identity.map((color) => (
        // eslint-disable-next-line @next/next/no-img-element -- asset SVG statique de public/mana/
        <img key={color} src={`/mana/${color}.svg`} width={12} height={12} alt="" />
      ))}
    </span>
  )
}

export function DeckRow({
  deck,
  currency,
  href,
}: {
  deck: DeckRowData
  currency: Currency
  // `/collection/decks/{id}` depuis Collection › Decks, `/decks/{id}`
  // ailleurs — un deck
  // monté n'a pas la même adresse selon la liste qui le montre. Par défaut
  // `/decks/{id}` : la seule route qui existait avant que cette prop
  // n'existe, tous les appelants qui l'omettent gardent leur comportement.
  href?: string
}) {
  const resolvedHref = href ?? `/decks/${deck.id}`
  const value = formatMoney(deck.valueMinor, currency)
  const meta = metaLine(deck)

  // Illustration `art_crop` à `opacity: 0.62` sous le voile
  // `--gradient-deck-veil`.
  if (deck.artUrl) {
    return (
      <Link
        href={resolvedHref}
        // `scheme-dark` : une ligne illustrée reste sombre en thème clair.
        className="relative flex h-deck-row flex-col justify-center gap-9 overflow-hidden rounded-row bg-surface-1 px-14 text-left scheme-dark"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img
          src={deck.artUrl}
          alt=""
          style={{ opacity: 0.62 }}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span className="absolute inset-0 bg-gradient-deck-veil" />
        <span className="relative flex w-full items-center gap-12">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-shadow-art text-deck-name font-bold text-text">{deck.name}</span>
            <span className="mt-3 flex items-center gap-7 whitespace-nowrap text-shadow-art text-meta text-text-art">
              {meta}
              <IdentityPips colorIdentity={deck.colorIdentity} />
            </span>
          </span>
          <span className="text-shadow-art text-deck-value font-bold text-accent-light">{value}</span>
          <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-2" />
        </span>
        <span className="relative self-start">
          <StatusChip status={deck.status} />
        </span>
      </Link>
    )
  }

  // Dégradé choisi, sinon dégradé d'identité colorée — un format est posé
  // dès lors que le statut n'est pas `noFormat` (`decks-data.ts` ne
  // construit ce statut que pour `format === null`). Pas de bordure : le
  // dégradé, répété dans la bordure transparente, y traçait un filet vif.
  if (deck.coverGradient || deck.format) {
    const gradient = deck.coverGradient ?? gradientKeyForIdentity(deck.colorIdentity)
    return (
      <Link
        href={resolvedHref}
        style={{ backgroundImage: binderRowBackground(gradient, 1) }}
        className="flex h-deck-row flex-col justify-center gap-9 overflow-hidden rounded-row bg-bg px-14 text-left scheme-dark"
      >
        <span className="flex w-full items-center gap-12">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-deck-name font-bold text-text">{deck.name}</span>
            <span className="mt-3 flex items-center gap-7 whitespace-nowrap text-meta text-text-art">
              {meta}
              <IdentityPips colorIdentity={deck.colorIdentity} />
            </span>
          </span>
          <span className="text-deck-value font-bold text-accent-light">{value}</span>
          <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-2" />
        </span>
        <span className="self-start">
          <StatusChip status={deck.status} />
        </span>
      </Link>
    )
  }

  // Surface nue : aucun format, donc
  // toujours `status.kind === 'noFormat'`.
  return (
    <Link
      href={resolvedHref}
      className="flex h-deck-row flex-col justify-center gap-9 overflow-hidden rounded-row bg-surface-1 px-14 text-left"
    >
      <span className="flex w-full items-center gap-12">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-deck-name font-bold text-text">{deck.name}</span>
          <span className="mt-3 block truncate text-meta text-text-2">{meta}</span>
        </span>
        <span className="text-deck-value font-bold text-accent-text">{value}</span>
        <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-3" />
      </span>
      <span className="self-start">
        <StatusChip status={deck.status} />
      </span>
    </Link>
  )
}
