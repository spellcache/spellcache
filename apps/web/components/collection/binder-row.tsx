// Ligne de binder aux trois apparences. Trois variantes explicites —
// illustrée, dégradé, nue — jamais une
// bordure conditionnelle approximative : la ligne illustrée et la ligne
// dégradé n'ont **pas** de bordure, contrairement à la ligne nue.
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { binderRowBackground, type GradientKey } from '@/lib/binders/gradients'
import { formatMoney, type Currency } from '@/lib/format/money'
import type { BinderSummary } from '@/app/(app)/collection/collection-data'

// La ligne nue porte `border border-border` ; les lignes illustrée et dégradé
// n'ont aucune bordure dans le design validé, ce qui les rendrait 2px plus
// basses à padding égal, alors que les trois doivent avoir la même hauteur.
// Une bordure transparente laisse voir le fond en
// dessous — rendu inchangé au pixel — tout en réservant le même espace que
// `border-border`, donc les trois lignes retrouvent la même hauteur.

export function BinderRow({
  binder,
  currency,
  binderBackdrops,
  // `'list'` (méta `… cards · not in collection`) — cette ligne sert aussi
  // bien l'onglet `Binders` que l'onglet `Lists` de l'accueil Compact (même
  // géométrie), seule la méta les distingue.
  kind = 'binder',
}: {
  binder: BinderSummary
  currency: Currency
  // Préférence de compte `Binder backdrops` : à `false`, cette ligne rend le
  // binder comme s'il n'avait
  // aucune apparence enregistrée, sans jamais toucher `binder.coverArtUrl`/
  // `coverGradient` eux-mêmes — l'apparence réapparaît à l'identique dès
  // que la préférence repasse à `true`, rien n'a été effacé.
  binderBackdrops: boolean
  kind?: 'binder' | 'list'
}) {
  const href = `/container/${binder.id}`
  const value = formatMoney(binder.valueMinor, currency)
  const cardsLabel =
    kind === 'list' ? `${binder.cardCount} cards · not in collection` : `${binder.cardCount} cards`

  if (binderBackdrops && binder.coverArtUrl) {
    return (
      <Link
        href={href}
        // `scheme-dark` : une ligne illustrée reste sombre en thème clair —
        // voile, texte et surface lisent les valeurs sombres de `light-dark`.
        className="relative flex items-center gap-12 overflow-hidden rounded-row border border-transparent bg-surface-1 px-14 py-17 text-left scheme-dark"
      >
        {/* `binder.coverIntensity` module le poids visuel du fond, jamais le
            texte par-dessus (même garde que `binder-header.tsx`) : un seul
            calque en opacité, le reste de la ligne reste pleinement lisible.
            Un seul et unique calque — un `opacity-60` composé sur l'image
            elle-même multiplierait deux opacités (`0.6 × coverIntensity`), ce
            que le design validé ne demande pas. */}
        <span className="absolute inset-0" style={{ opacity: binder.coverIntensity }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
          <img
            src={binder.coverArtUrl}
            alt=""
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 bg-gradient-binder-veil" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-shadow-art text-card-name font-bold text-text">
            {binder.name}
          </span>
          <span className="mt-3 block text-shadow-art text-meta text-text-art">{cardsLabel}</span>
        </span>
        <span className="relative text-shadow-art text-binder-value font-bold text-accent-light">
          {value}
        </span>
        <ChevronRight width={18} height={18} strokeWidth={1.75} className="relative text-text-2" />
      </Link>
    )
  }

  if (binderBackdrops && binder.coverGradient) {
    // Pas de `bg-surface-1` ni de calque d'opacité séparé ici (contrairement
    // à la variante illustrée ci-dessus, qui en porte un dans le design
    // validé) : `binderRowBackground` multiplie déjà l'alpha de ses trois
    // paliers par `binder.coverIntensity`, donc le dégradé se compose
    // directement sur le fond de l'écran `#08090c`, comme dans le design
    // validé (une surface opaque
    // interposée sous les paliers translucides fausserait le composite à
    // toute intensité).
    return (
      <Link
        href={href}
        style={{
          backgroundImage: binderRowBackground(binder.coverGradient as GradientKey, binder.coverIntensity),
        }}
        className="flex items-center gap-12 rounded-row border border-transparent bg-bg px-14 py-17 text-left scheme-dark"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-card-name font-bold text-text">{binder.name}</span>
          <span className="mt-3 block text-meta text-text-art">{cardsLabel}</span>
        </span>
        <span className="text-binder-value font-bold text-accent-light">{value}</span>
        <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-2" />
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-12 rounded-row border border-border bg-surface-1 px-14 py-17 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-card-name font-bold text-text">{binder.name}</span>
        <span className="mt-3 block text-meta text-text-2">{cardsLabel}</span>
      </span>
      <span className="text-binder-value font-bold text-accent-text">{value}</span>
      <ChevronRight width={18} height={18} strokeWidth={1.75} className="text-text-3" />
    </Link>
  )
}
