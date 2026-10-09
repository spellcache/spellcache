// Tuile de carte, densité `grid`. Comme
// `CardRow`, aucun contrôle de quantité en ligne — seule une puce `×N` en
// surimpression ; l'édition passe par la feuille de détail ouverte au tap.
//
// Les deux libellés du pied n'ont pas d'interligne propre : au socle
// `line-height: normal` (app/globals.css) le texte 11px mesure ~13.3px,
// sous l'icône de set de 14px qui fixe seule la hauteur du pied —
// `GRID_FOOTER_HEIGHT` (24px, `components/cards/virtual-list.tsx`) tient
// donc sans compensation, comme dans le design validé.
import { Check } from 'lucide-react'

// `selectable`/`selected` : même case
// ronde 18px et mêmes tokens que `CompactRow`, en surimpression `absolute`
// (coin haut-gauche, symétrique du badge `×N`) — jamais dans le flux, pour
// ne pas rouvrir la hauteur calculée de la tuile (`components/cards/
// virtual-list.tsx`, `tileHeight`), qui ne dépend que de `tileWidth`, jamais
// du contenu rendu. Voir le même commentaire dans `mf-card-row.tsx` : la
// densité `grid` n'a pas de design de sélection propre, ces tokens sont
// ceux déjà validés de `CompactRow`.
export function GridTile({
  thumbUrl,
  setCode,
  setIconUri,
  collectorNumber,
  isFoil,
  qty,
  priceLabel,
  onOpen,
  selectable = false,
  selected = false,
  current = false,
  // Préférence de compte `Prices on card art` : masque les prix sur les
  // tuiles d'illustration sans toucher aux prix des lignes de liste — cette
  // tuile est la seule à superposer un prix à même l'illustration
  // (`CardRow`/`CompactRow` l'affichent en texte de ligne, hors périmètre).
  // Par défaut affiché : les appels existants (`tests/unit/row-heights.test.tsx`)
  // restent inchangés.
  showPrice = true,
}: {
  thumbUrl: string
  setCode: string
  setIconUri: string | null
  collectorNumber: string
  isFoil: boolean
  qty: number
  priceLabel: string
  onOpen: () => void
  selectable?: boolean
  selected?: boolean
  // Voir `CompactRow` : tuile courante du panneau d'aperçu desktop,
  // fond et bordure de `selected` sans sa coche.
  current?: boolean
  showPrice?: boolean
}) {
  const highlighted = selected || current
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        highlighted
          ? 'relative flex w-full flex-col overflow-hidden rounded-row border border-border-accent bg-accent-bg text-left'
          : 'relative flex w-full flex-col overflow-hidden rounded-row border border-border bg-surface-1 text-left'
      }
    >
      <div className="relative aspect-card bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
        <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
        {selectable && (
          <span
            aria-hidden="true"
            className={
              selected
                ? 'absolute left-6 top-6 flex h-selection-circle w-selection-circle items-center justify-center rounded-full border-thin border-accent bg-accent'
                : 'absolute left-6 top-6 flex h-selection-circle w-selection-circle items-center justify-center rounded-full border-thin border-text-3 bg-transparent'
            }
          >
            {selected && <Check width={11} height={11} strokeWidth={3.5} className="text-on-accent" />}
          </span>
        )}
        <div className="absolute right-6 top-6 rounded-pill bg-modal-veil px-6 py-2 text-tile-qty-badge font-bold text-text">
          ×{qty}
        </div>
        <div className="absolute bottom-6 right-6 flex items-center gap-5">
          {isFoil && (
            <span className="rounded-pill bg-tile-pill-veil px-6 py-2 scheme-dark text-badge-foil font-bold tracking-badge-foil text-accent-text">
              FOIL
            </span>
          )}
          {showPrice && (
            <span className="rounded-pill bg-tile-pill-veil px-7 py-2 scheme-dark font-mono text-tile-price font-bold text-accent-text">
              {priceLabel}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-6 bg-surface-3 px-7 py-5">
        {/* Sans icône, un emplacement vide de même taille : c'est elle qui fixe
            la hauteur du pied (`GRID_FOOTER_HEIGHT`). */}
        {setIconUri ? (
          // eslint-disable-next-line @next/next/no-img-element -- icône de set Scryfall, URL lue dans `sets.icon_svg_uri` (catalogue), jamais construite
          <img
            src={setIconUri}
            alt=""
            className="h-icon-set-tile w-icon-set-tile icon-set-tint flex-shrink-0"
          />
        ) : (
          <span aria-hidden className="h-icon-set-tile w-icon-set-tile flex-shrink-0" />
        )}
        <span className="font-mono text-tile-meta font-bold tracking-tile-setcode text-text-2">
          {setCode.toUpperCase()}
        </span>
        <span className="font-mono text-tile-meta text-text-3">#{collectorNumber}</span>
      </div>
    </button>
  )
}

// Variante d'étagère de `GridTile` (largeur fixe, snap), utilisée par la
// piste horizontale de `Shelf`. Largeur fixe (`--width-shelf-tile`, 66px) et
// `snap-start` pour `scroll-snap-align: start` sur chaque tuile. `ShelfTile`
// ne porte ni set, ni quantité, ni foil — contrairement à `GridTile`
// ci-dessus (densité `grid` d'un container), cette tuile n'a pas de pied :
// art pur (pas de puce, pas de bandeau prix/qty sur la tuile elle-même — le
// prix ne s'affiche qu'une fois, au niveau de l'étagère).
//
// Rendue en `<button>` (taper une tuile ouvre la feuille de carte) —
// `ShelfTile.cardId` seul est disponible ici,
// sans identité de holding : `onOpen` n'ouvre donc pas la feuille éditable
// de `components/cards/card-sheet.tsx` (qui prend un `HoldingRow` complet
// et des mutateurs scopés à un container, absents de ce contrat), mais la
// feuille de lecture seule `components/cards/card-preview-sheet.tsx`
// (`getCardDetailAction(cardId)`). `type="button"` et le reset
// universel `*` du preflight Tailwind (`margin/padding/border: 0`, déjà
// vérifié par `GridTile` ci-dessus) laissent la boîte 66×92.4 inchangée —
// voir `tests/unit/row-heights.test.tsx`. `lazy` (`loading="lazy"` sur les
// tuiles au-delà de la première rangée visible) : posé par `Shelf`, vrai
// pour toute étagère qui n'est pas la première de l'écran.
export function GridTileShelf({
  artUrl,
  name,
  onOpen,
  lazy = false,
}: {
  artUrl: string
  name: string
  onOpen: () => void
  lazy?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="aspect-card w-shelf-tile flex-shrink-0 snap-start overflow-hidden rounded-tile-art bg-surface-2 text-left"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- proxy interne, pas un CDN externe à optimiser */}
      <img
        src={artUrl}
        alt={name}
        loading={lazy ? 'lazy' : 'eager'}
        className="h-full w-full object-contain"
      />
    </button>
  )
}
