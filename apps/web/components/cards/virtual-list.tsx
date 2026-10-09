'use client'

// Liste virtualisée à hauteur fixe par densité (docs/development.md, anti-patterns :
// « ne pas utiliser de hauteur de ligne variable dans une liste virtualisée »).
// Au-delà de 40 lignes visibles + overscan, le reste du DOM est retiré — vérifié
// par `tests/e2e/container-list.spec.ts` sur un container de 1 000 holdings.
//
// Groupement : le groupement change la hauteur totale de la liste virtualisée,
// donc l'index des en-têtes se recalcule avec les lignes et aucun groupe n'est
// rendu hors du virtualiseur. `getGroupLabel` est optionnel. Absent, le rendu
// reste au pixel identique à la liste sans groupes (un item par ligne de liste,
// aucune entrée supplémentaire) — c'est délibéré, pour ne
// jamais rouvrir les mesures verrouillées de `CompactRow`/`CardRow`
// (`tests/unit/row-heights.test.tsx`). Présent, chaque frontière de groupe
// (comparaison de `getGroupLabel` entre deux items consécutifs — déjà triés
// server-side sur le même critère, `holdings-data.ts`) insère une entrée
// d'en-tête ; l'en-tête du groupe visible reste collant en haut du
// défilement via la recette officielle `@tanstack/react-virtual`
// (`rangeExtractor` forçant l'index d'en-tête actif dans la plage rendue,
// `position: sticky` seulement pour celui-là — les autres restent
// `position: absolute`, comme avant).
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import {
  useSelection,
  type SelectionState,
} from '@/components/selection/selection-provider'
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar'
import { BREAKPOINTS } from '@/lib/breakpoints'
import { useMinWidth } from '@/components/desktop/use-min-width'

export type Density = 'rows' | 'compact' | 'grid'

// Hauteur de ligne fixe par densité. `grid` vaut 0 : le design n'a pas de
// hauteur de ligne unique pour cette densité — la tuile dérive sa hauteur du
// ratio 5/7 d'une carte, recalculée une seule fois
// par largeur mesurée, pas une constante.
export const ROW_HEIGHT: Record<Density, number> = { rows: 84, compact: 58, grid: 0 }

// Hauteur fixe d'un en-tête de groupe — même famille que
// `ROW_HEIGHT` ci-dessus : un nombre consommé par `estimateSize`, pas une
// classe Tailwind (docs/development.md, portée sur les styles/classes d'un composant,
// pas sur la géométrie numérique d'un algorithme de layout — même
// convention que `LIST_ROW_GAP`/`GRID_GAP` plus bas).
export const GROUP_HEADER_HEIGHT = 32

// Constantes de géométrie du virtualiseur — au même titre que `ROW_HEIGHT`
// ci-dessus, ce sont des nombres consommés par le calcul du virtualiseur
// (`estimateSize`, `lanes`, positions absolues en pixels), jamais des classes
// Tailwind : la règle docs/development.md « aucune valeur littérale en dur » vise les
// classes/styles CSS d'un composant, pas la géométrie numérique d'un
// algorithme de layout. Reprennent les valeurs du design validé (`gap:10px`
// pour la grille de binder, `gap:6px` pour la colonne de lignes compactes).
// Gap par densité : `rows` (84px, `CardRow`) porte 9px, `compact` (58px,
// `CompactRow`) garde 6px.
const LIST_ROW_GAP: Record<'rows' | 'compact', number> = { rows: 9, compact: 6 }
const GRID_GAP = 10
// Palier `minmax(140px,1fr)` au-delà du breakpoint desktop, `minmax(108px,1fr)`
// en dessous — un point de bascule de VIEWPORT (`useMinWidth`,
// `BREAKPOINTS.mobile` = 900px, `lib/breakpoints.ts`), pas de la largeur
// mesurée du conteneur qui pilote déjà le nombre de voies ci-dessous : les
// deux mesures répondent à des questions différentes, la bascule suit
// `@media (min-width: 900px)`, jamais la largeur de la grille elle-même (qui
// peut rester étroite à côté d'un panneau d'aperçu même sur un grand écran).
const GRID_TILE_MIN_WIDTH_MOBILE = 108
const GRID_TILE_MIN_WIDTH_DESKTOP = 140
// Pied de `GridTile` : padding 5px + icône/texte 14px + padding 5px —
// hauteur naturelle de la tuile,
// jamais forcée en CSS (même convention que les autres lignes portées).
// Vrai au socle `line-height: normal` (app/globals.css) : le texte 11px du
// pied mesure ~13.3px, donc l'icône de set de 14px fixe seule la hauteur.
const GRID_FOOTER_HEIGHT = 24
const GRID_ASPECT_RATIO = 7 / 5
// Bordure de `GridTile` (`border`, 1px de chaque côté) : `tileWidth`
// ci-dessous est la largeur hors-tout (posée en `style.width` sur la tuile,
// `box-sizing: border-box` du preflight Tailwind), donc la largeur de
// contenu réellement soumise au ratio 5/7 par `aspect-card` est `tileWidth`
// moins cette bordure — l'omettre sous-estime `tileHeight`.
const GRID_TILE_BORDER = 2

// Appui long → sélection (`enter(id)`), annulé par un déplacement de plus de
// 10px : l'appui long entre en conflit avec le scroll, il faut donc un seuil
// de déplacement, pas seulement un délai. Une fois la
// sélection active, un appui simple sur n'importe quelle ligne bascule
// l'item visé (`toggle`) au lieu d'ouvrir la feuille de détail — intercepté
// en phase de capture, avant que le clic n'atteigne le gestionnaire
// `onClick={onOpen}` porté par la ligne elle-même (`CompactRow`/
// `CardRow`/`GridTile`), qui reste sinon inchangé.
// Seuil retenu : 450ms ; le seuil de déplacement reste à 10px.
const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 10

// Modificateurs de clic desktop : `Shift` pour une plage, `Ctrl`/`Cmd` pour
// un ajout unitaire. `null` = un clic simple, qui garde le comportement
// mobile (ouvrir la carte, ou
// basculer la ligne si une sélection est déjà active).
type ClickModifier = 'range' | 'toggle' | null

function modifierOf(event: ReactMouseEvent): ClickModifier {
  if (event.shiftKey) return 'range'
  if (event.ctrlKey || event.metaKey) return 'toggle'
  return null
}

function useSelectionGesture(
  id: string,
  selection: SelectionState,
  onModifiedClick: (id: string, modifier: Exclude<ClickModifier, null>) => void,
  onPlainClick: (id: string) => void,
  // Une liste (`kind = 'list'`) n'a ni long-press, ni Ctrl/Shift-clic, ni
  // bascule simple pendant une sélection — sa ligne n'est jamais une entrée
  // de collection, `BulkEditSheet`/`ActionBar` n'ont aucun sens sur elle.
  // `false` désactive tout le geste, le clic simple ne fait plus jamais
  // qu'ouvrir la ligne (`onPlainClick`).
  selectionEnabled: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)
  const activeRef = useRef(selection.active)
  activeRef.current = selection.active

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (!selectionEnabled) return
      startRef.current = { x: event.clientX, y: event.clientY }
      firedRef.current = false
      clearTimer()
      timerRef.current = setTimeout(() => {
        if (!activeRef.current) {
          firedRef.current = true
          selection.enter(id)
        }
      }, LONG_PRESS_MS)
    },
    [id, selection, clearTimer, selectionEnabled],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const start = startRef.current
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer()
    },
    [clearTimer],
  )

  const onClickCapture = useCallback(
    (event: ReactMouseEvent) => {
      if (!selectionEnabled) {
        // Une liste n'entre jamais en sélection : ni le geste d'appui long
        // (déjà court-circuité par `onPointerDown` ci-dessus),
        // ni un clic modifié, ni une sélection déjà active ailleurs dans
        // l'app ne doivent y intercepter le clic — toujours `onPlainClick`.
        onPlainClick(id)
        return
      }
      if (firedRef.current) {
        // Le clic qui suit un appui long ne doit ni ouvrir la feuille ni
        // rebasculer la ligne qui vient d'entrer en sélection.
        firedRef.current = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const modifier = modifierOf(event)
      if (modifier) {
        // Un clic modifié ne doit ni ouvrir la feuille ni remplir le
        // panneau : il ne fait que composer la sélection groupée.
        event.preventDefault()
        event.stopPropagation()
        onModifiedClick(id, modifier)
        return
      }
      if (activeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        selection.toggle(id)
        return
      }
      // Clic simple hors sélection : l'ancre de plage et le focus clavier
      // suivent la ligne, mais l'évènement continue jusqu'au `onClick` de
      // la ligne elle-même (`onOpen`), inchangé.
      onPlainClick(id)
    },
    [id, selection, onModifiedClick, onPlainClick, selectionEnabled],
  )

  // Clic droit desktop = même intention que l'appui long : entre en sélection
  // sans jamais laisser le menu contextuel natif du navigateur apparaître.
  // Toujours `preventDefault` : sur Android, l'appui long d'une vignette
  // ouvrirait sinon le menu « Télécharger l'image », listes comprises.
  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      if (!selectionEnabled) return
      clearTimer()
      if (!activeRef.current) {
        // Chrome Android le déclenche avant `LONG_PRESS_MS` : le clic du
        // relâchement ne doit pas rebasculer la ligne tout juste entrée.
        firedRef.current = true
        selection.enter(id)
      }
    },
    [id, selection, selectionEnabled, clearTimer],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onClickCapture,
    onContextMenu,
  }
}

// Une entrée du virtualiseur : soit un en-tête de groupe (une seule
// colonne, quelle que soit la densité), soit une rangée de 1 à `lanes`
// items (1 en `rows`/`compact`, jusqu'à `lanes` en `grid` — jamais mêlée à
// un en-tête dans la même rangée, une frontière de groupe repart toujours
// sur une rangée neuve, y compris en grille : la dernière tuile d'un groupe
// ne partage jamais sa rangée avec la première du suivant).
// `count` : le nombre de lignes du groupe que cet en-tête précède, rendu en
// faint à côté du nom.
type Entry<T> =
  | { kind: 'header'; label: string; count: number }
  | { kind: 'items'; items: T[] }

function buildEntries<T>(
  items: T[],
  lanes: number,
  getGroupLabel: ((item: T) => string | null) | undefined,
): Entry<T>[] {
  const entries: Entry<T>[] = []

  function pushRows(bucket: T[]) {
    for (let i = 0; i < bucket.length; i += lanes)
      entries.push({ kind: 'items', items: bucket.slice(i, i + lanes) })
  }

  if (!getGroupLabel) {
    pushRows(items)
    return entries
  }

  // Partitionne en segments consécutifs de même étiquette avant tout envoi
  // dans `entries` — le compte d'un en-tête n'est connu qu'une fois son
  // segment entier parcouru, jamais avant.
  interface Segment {
    label: string | null
    items: T[]
  }
  const segments: Segment[] = []
  for (const item of items) {
    const label = getGroupLabel(item)
    const current = segments.at(-1)
    if (current && current.label === label) current.items.push(item)
    else segments.push({ label, items: [item] })
  }

  for (const segment of segments) {
    if (segment.label !== null) {
      entries.push({ kind: 'header', label: segment.label, count: segment.items.length })
    }
    pushRows(segment.items)
  }

  return entries
}

// Enveloppe une ligne/tuile du geste de sélection (appui long, bascule de
// sélection) sans changer sa boîte positionnée (`style` reçu tel
// quel) — un composant à part, pas un callback inline dans `.map()`, pour
// que `useSelectionGesture` (un hook) reste appelé une fois par ligne rendue,
// jamais dans une boucle (règle des hooks).
function SelectableItem({
  id,
  style,
  className,
  selection,
  onModifiedClick,
  onPlainClick,
  selectionEnabled,
  children,
}: {
  id: string
  style: CSSProperties
  className?: string
  selection: SelectionState
  onModifiedClick: (id: string, modifier: Exclude<ClickModifier, null>) => void
  onPlainClick: (id: string) => void
  selectionEnabled: boolean
  children: ReactNode
}) {
  const gesture = useSelectionGesture(id, selection, onModifiedClick, onPlainClick, selectionEnabled)
  return (
    <div
      data-virtual-item-key={id}
      style={style}
      className={className}
      onPointerDown={gesture.onPointerDown}
      onPointerMove={gesture.onPointerMove}
      onPointerUp={gesture.onPointerUp}
      onPointerLeave={gesture.onPointerLeave}
      onClickCapture={gesture.onClickCapture}
      onContextMenu={gesture.onContextMenu}
    >
      {children}
    </div>
  )
}

export function VirtualList<T>({
  items,
  density,
  getItemKey,
  renderItem,
  getGroupLabel,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  selectedKey = null,
  onSelectRow,
  selectionEnabled = true,
  scrollHeader,
  scrollHeaderStickyOffset = 0,
}: {
  items: T[]
  density: Density
  getItemKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  getGroupLabel?: (item: T) => string | null
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onEndReached: () => void
  // Ligne courante du panneau d'aperçu desktop — `null` quand le panneau est
  // éteint ou qu'aucune ligne n'a encore été choisie. La liste ne détient pas
  // cet état : elle le reçoit et le fait avancer d'un cran sur `↑`/`↓`, l'écran
  // de container reste le seul à le stocker.
  selectedKey?: string | null
  onSelectRow?: (key: string) => void
  // `false` sur un container `kind = 'list'` — aucune ligne d'une liste
  // n'entre en sélection groupée, quel que soit le geste (appui long,
  // Ctrl/Shift-clic).
  selectionEnabled?: boolean
  // En-tête repliable/collant d'un container à fond (demande produit) :
  // contenu NON virtualisé rendu avant les rangées, dans le MÊME élément de
  // défilement (`scrollRef` ci-dessous) — recette officielle `scrollMargin`
  // de `@tanstack/react-virtual` (« Window Virtualizer »/exemples
  // « Sticky ») pour insérer du contenu avant une liste virtualisée sans
  // rouvrir la hauteur de ligne fixe (docs/development.md : jamais de hauteur
  // variable dans une liste virtualisée — cet en-tête n'est PAS une entrée
  // du virtualiseur, seule sa hauteur mesurée décale les rangées).
  // `undefined` (défaut) : rien n'est rendu, `scrollMargin` reste `0`,
  // comportement identique à avant ce prop.
  scrollHeader?: ReactNode
  // Décalage (px) du `top` de l'en-tête de GROUPE actif quand
  // `scrollHeader` porte lui-même un bloc collant `top:0` (le titre/méta +
  // la barre de commande d'un binder à fond, posés par `container-view.tsx`
  // dans `scrollHeader`) : sans ce décalage, l'en-tête de groupe se
  // collerait à `top:0` par-dessus ce bloc dès qu'il devient actif, au lieu
  // de se poser juste en dessous. C'est la hauteur de la seule portion
  // COLLANTE de `scrollHeader` (pas celle de tout `scrollHeader`, qui inclut
  // aussi la zone repliable qui défile, elle, normalement) — mesurée et
  // fournie par l'appelant, qui seul connaît cette portion.  `0` (défaut) :
  // l'en-tête de groupe se colle à `top:0` comme avant ce prop.
  scrollHeaderStickyOffset?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  const [scrollHeaderHeight, setScrollHeaderHeight] = useState(0)
  const [width, setWidth] = useState(0)
  const selection = useSelection()

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    const rowsEl = rowsContainerRef.current
    if (!scrollEl || !rowsEl || !scrollHeader) {
      setScrollHeaderHeight(0)
      return
    }
    // `scrollMargin` = offset réel du conteneur de rangées dans le
    // scroller. Mesuré ainsi — et non par la hauteur d'un wrapper autour de
    // `scrollHeader` — parce que ce wrapper bornait le `position: sticky`
    // du bloc titre à sa propre hauteur : un sticky ne colle que dans les
    // limites de son parent, il doit donc être un enfant direct du contenu
    // défilant, sans boîte intermédiaire à mesurer.
    const measure = () => {
      const delta =
        rowsEl.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop
      setScrollHeaderHeight(Math.max(0, Math.round(delta)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollEl)
    for (const child of Array.from(scrollEl.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [scrollHeader])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Comportement seulement : ce composant n'est jamais
  // rendu côté serveur avec des données réelles (`container-view.tsx` est
  // `'use client'`, `width` démarre de toute façon à 0 avant la première
  // mesure ci-dessus) — `null` avant hydratation retombe donc sur le palier
  // mobile, sans le saut de mise en page qu'un écran déjà peint redouterait.
  const isDesktopViewport = useMinWidth(BREAKPOINTS.mobile)
  const gridTileMinWidth = isDesktopViewport ? GRID_TILE_MIN_WIDTH_DESKTOP : GRID_TILE_MIN_WIDTH_MOBILE

  const isGrid = density === 'grid'
  const lanes = isGrid
    ? Math.max(1, Math.floor((width + GRID_GAP) / (gridTileMinWidth + GRID_GAP)))
    : 1
  const tileWidth = isGrid && width > 0 ? (width - (lanes - 1) * GRID_GAP) / lanes : 0
  // La bordure compte deux fois : une fois soustraite de la largeur avant le
  // ratio (elle n'appartient pas à la boîte de contenu que `aspect-card`
  // dimensionne), une fois rajoutée à la hauteur totale (elle s'ajoute en
  // haut et en bas de la tuile, comme n'importe quelle bordure —
  // mesuré sur `GridTile` : 150px de large mesure 233.1875px de haut,
  // (150 − 2) × 7/5 + 24 + 2 = 233.2). Cette hauteur ne tient que parce que
  // l'icône de set du pied est une boîte 14×14 forcée en CSS
  // (`--width-icon-set-tile`/`--height-icon-set-tile`, `app/globals.css`) :
  // un premier passage l'avait laissée suivre le ratio intrinsèque du SVG de
  // set (`width`/`height` en attributs HTML, battus par le preflight
  // Tailwind `img { height: auto }`), ce qui faisait varier `GRID_FOOTER_HEIGHT`
  // — donc la tuile entière — de 230.1875 à 235.1875px selon le set (`mh2`
  // 17×11, `pcy` 896×1024, `lea` 1024×1024) à `tileWidth` fixe. Mesuré à
  // nouveau après correction sur `lea`, `pcy`, `mh2` et `neo`, à 120px et
  // 150px de large : une seule hauteur par largeur, quel que soit le set —
  // voir `tests/unit/row-heights.test.tsx`.
  const tileHeight = isGrid
    ? (tileWidth - GRID_TILE_BORDER) * GRID_ASPECT_RATIO +
      GRID_FOOTER_HEIGHT +
      GRID_TILE_BORDER
    : ROW_HEIGHT[density]
  const rowHeight = tileHeight > 0 ? tileHeight : ROW_HEIGHT.compact

  const entries = useMemo(
    () => buildEntries(items, lanes, getGroupLabel),
    [items, lanes, getGroupLabel],
  )
  const orderedKeys = useMemo(() => items.map(getItemKey), [items, getItemKey])
  const stickyIndexes = useMemo(
    () =>
      entries.reduce<number[]>(
        (acc, entry, index) => (entry.kind === 'header' ? [...acc, index] : acc),
        [],
      ),
    [entries],
  )
  const activeStickyIndexRef = useRef(0)

  const rangeExtractor = useCallback(
    (range: Range) => {
      activeStickyIndexRef.current =
        [...stickyIndexes].reverse().find((index) => range.startIndex >= index) ?? -1
      const next = new Set(defaultRangeExtractor(range))
      if (activeStickyIndexRef.current >= 0) next.add(activeStickyIndexRef.current)
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      entries[index]?.kind === 'header' ? GROUP_HEADER_HEIGHT : rowHeight,
    gap: isGrid ? GRID_GAP : LIST_ROW_GAP[density === 'rows' ? 'rows' : 'compact'],
    overscan: 8,
    rangeExtractor,
    // Recette `scrollMargin` (voir le commentaire de `scrollHeader` ci-
    // dessus) : `0` tant qu'aucun en-tête n'est mesuré, comportement
    // identique à avant ce prop.
    scrollMargin: scrollHeaderHeight,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastEntry = virtualItems.at(-1)
  const lastEntryIsFinalItemsRow =
    lastEntry !== undefined &&
    lastEntry.index === entries.length - 1 &&
    entries[lastEntry.index]?.kind === 'items'

  useEffect(() => {
    if (!lastEntryIsFinalItemsRow) return
    if (hasNextPage && !isFetchingNextPage) onEndReached()
  }, [lastEntryIsFinalItemsRow, hasNextPage, isFetchingNextPage, onEndReached])

  // Ancre de plage : la dernière ligne
  // atteinte sans `Shift`, qu'elle l'ait été au clic ou au clavier.
  const anchorRef = useRef<string | null>(null)

  const handlePlainClick = useCallback((id: string) => {
    anchorRef.current = id
    // Le focus part sur le conteneur défilant, pas sur la ligne : une ligne
    // sort du DOM dès que la virtualisation la dépasse, et le focus
    // retomberait sur `<body>` — `↑`/`↓` n'atteindraient plus jamais le
    // gestionnaire ci-dessous après deux ou trois pas. `preventScroll` :
    // donner le focus ne doit pas ramener le conteneur dans le champ de
    // vision et défaire le défilement en cours (le tap mobile passe ici
    // aussi, où rien ne doit bouger).
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleModifiedClick = useCallback(
    (id: string, modifier: 'range' | 'toggle') => {
      if (modifier === 'toggle') {
        // `Ctrl`/`Cmd`+clic : une seule ligne bascule. `enter` amorce la
        // sélection quand elle n'est pas encore active — `toggle` seul
        // laisserait `active` à `false` et la barre d'action de sélection
        // n'apparaîtrait pas, alors qu'elle doit apparaître dans les deux cas.
        if (selection.active) selection.toggle(id)
        else selection.enter(id)
        anchorRef.current = id
        return
      }

      const anchor = anchorRef.current ?? selectedKey
      const from = anchor === null ? -1 : orderedKeys.indexOf(anchor)
      const to = orderedKeys.indexOf(id)
      if (to === -1) return
      if (from === -1) {
        // Pas d'ancre encore posée : `Shift`+clic se comporte comme un
        // premier clic, et devient l'ancre de la plage suivante.
        selection.enter(id)
        anchorRef.current = id
        return
      }
      const [low, high] = from <= to ? [from, to] : [to, from]
      selection.selectRange(orderedKeys.slice(low, high + 1))
    },
    [selection, selectedKey, orderedKeys],
  )

  // `↑`/`↓` déplacent la sélection d'une ligne et gardent la ligne visible.
  // `preventDefault` **uniquement dans ce cas** (les flèches ne doivent pas
  // défiler la page quand la liste a le focus) : toute autre touche est
  // laissée intacte, et une flèche partie d'un champ de saisie ou d'une liste
  // déroulante (le sélecteur de condition d'une ligne) garde son comportement
  // natif de déplacement de curseur.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (!onSelectRow || orderedKeys.length === 0) return
      const tag = (event.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      event.preventDefault()

      const step = event.key === 'ArrowDown' ? 1 : -1
      const current = selectedKey === null ? -1 : orderedKeys.indexOf(selectedKey)
      const nextIndex =
        current === -1
          ? step === 1
            ? 0
            : orderedKeys.length - 1
          : Math.min(orderedKeys.length - 1, Math.max(0, current + step))
      const nextKey = orderedKeys[nextIndex]
      if (nextKey === undefined || nextKey === selectedKey) return

      onSelectRow(nextKey)
      anchorRef.current = nextKey

      const entryIndex = entries.findIndex(
        (entry) =>
          entry.kind === 'items' &&
          entry.items.some((item) => getItemKey(item) === nextKey),
      )
      if (entryIndex >= 0) virtualizer.scrollToIndex(entryIndex)
    },
    [onSelectRow, orderedKeys, selectedKey, entries, getItemKey, virtualizer],
  )

  return (
    // La liste porte sa propre barre en surimpression : les natives sont
    // masquées partout (app/globals.css), et celle-ci est le seul défilement
    // de l'écran de container — il n'est pas dans un `Screen`, sa liste
    // occupant toute la hauteur sous la barre de commande.
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        data-testid="virtual-list-scroll"
        // Focalisable pour que `↑`/`↓` puissent viser la liste et elle seule
        // — `onKeyDown` ne préempte rien tant qu'une autre touche est pressée.
        tabIndex={0}
        onKeyDown={handleKeyDown}
        // `overflow-x-hidden` : le bloc collant de `scrollHeader` déborde de
        // 16px de chaque côté (`-mx-16`, fond plein cadre) — sans lui, la
        // liste défilait aussi latéralement.
        className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        {/* Contenu non virtualisé, avant les rangées, dans ce MÊME élément
            de défilement — recette `scrollMargin` (voir le commentaire du
            prop `scrollHeader` ci-dessus). Absent quand `scrollHeader` ne
            l'est pas : `scrollHeaderRef` ne mesure alors rien, `scrollMargin`
            reste `0`, aucun changement pour les écrans qui ne le passent
            pas. */}
        {scrollHeader}
        <div
          ref={rowsContainerRef}
          style={{
            position: 'relative',
            height: virtualizer.getTotalSize(),
            width: '100%',
          }}
        >
          {virtualItems.map((virtualItem) => {
            const entry = entries[virtualItem.index]
            if (!entry) return null
            // `virtualItem.start`/`.end` incluent déjà `scrollMargin`
            // (mesurés depuis le tout début de l'élément de défilement, en-
            // tête compris) : positionné dans CE conteneur `relative`, qui
            // ne commence lui-même qu'APRÈS l'en-tête (flux normal), il faut
            // retrancher ce même `scrollMargin` — exactement le
            // `virtualRow.start - virtualizer.options.scrollMargin` de la
            // recette officielle `@tanstack/react-virtual`.
            const top = virtualItem.start - virtualizer.options.scrollMargin

            if (entry.kind === 'header') {
              const isActiveSticky = virtualItem.index === activeStickyIndexRef.current
              return (
                <div
                  key={`group-${entry.label}-${virtualItem.index}`}
                  data-group-header={entry.label}
                  style={
                    isActiveSticky
                      ? {
                          position: 'sticky',
                          // Se pose sous le bloc collant de `scrollHeader`
                          // (titre/méta + barre de commande d'un binder à
                          // fond), jamais par-dessus — voir le commentaire du
                          // prop `scrollHeaderStickyOffset` ci-dessus. `0`
                          // tant qu'aucun `scrollHeader` collant n'est
                          // fourni : comportement inchangé.
                          top: scrollHeaderStickyOffset,
                          left: 0,
                          width: '100%',
                          height: virtualItem.size,
                          zIndex: 1,
                        }
                      : {
                          position: 'absolute',
                          top,
                          left: 0,
                          width: '100%',
                          height: virtualItem.size,
                          zIndex: 1,
                        }
                  }
                  className="flex items-center gap-8 bg-bg px-4 text-section-label font-semibold uppercase tracking-section-label text-text-2"
                >
                  <span>{entry.label}</span>
                  {/* Compte en faint — pas en majuscules ni gras, distinct
                      du nom du groupe. */}
                  <span className="normal-case tracking-normal text-text-3">{entry.count}</span>
                </div>
              )
            }

            if (!isGrid) {
              const item = entry.items[0]
              if (!item) return null
              return (
                <SelectableItem
                  key={getItemKey(item)}
                  id={getItemKey(item)}
                  selection={selection}
                  onModifiedClick={handleModifiedClick}
                  onPlainClick={handlePlainClick}
                  selectionEnabled={selectionEnabled}
                  style={{
                    position: 'absolute',
                    top,
                    left: 0,
                    width: '100%',
                    height: virtualItem.size,
                  }}
                >
                  {renderItem(item)}
                </SelectableItem>
              )
            }

            return (
              <div
                key={`row-${virtualItem.index}`}
                style={{
                  position: 'absolute',
                  top,
                  left: 0,
                  width: '100%',
                  height: virtualItem.size,
                }}
              >
                {entry.items.map((item, laneIndex) => (
                  <SelectableItem
                    key={getItemKey(item)}
                    id={getItemKey(item)}
                    selection={selection}
                    onModifiedClick={handleModifiedClick}
                    onPlainClick={handlePlainClick}
                    selectionEnabled={selectionEnabled}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: laneIndex * (tileWidth + GRID_GAP),
                      width: tileWidth,
                      height: virtualItem.size,
                    }}
                  >
                    {renderItem(item)}
                  </SelectableItem>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <OverlayScrollbar
        target={scrollRef}
        // Piste alignée sur le haut des rangées visibles : elle suit la
        // bannière qui se replie, puis s'arrête sous le bloc collant.
        trackTop={
          scrollHeader
            ? (node) => Math.max(scrollHeaderStickyOffset, scrollHeaderHeight - node.scrollTop)
            : undefined
        }
      />
    </div>
  )
}
