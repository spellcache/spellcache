// Lecture de l'écran de deck en préparation : une seule requête agrégée
// (`getDeck`), même patron que `listDecks` (`app/(app)/decks/decks-data.ts`)
// — les holdings du deck reviennent en sous-requête JSON corrélée,
// `container_stats` n'intervient pas ici (ses colonnes ne portent pas de
// compte par zone) puisque cet écran a justement besoin du détail ligne à ligne
// (zone, couverture par carte) que `container_stats` n'agrège jamais.
//
// `searchDeckCards` (le tiroir d'ajout persistant) est une requête
// distincte, volontairement pas construite sur `lib/search/search-cards.ts` :
// ce dernier n'expose pas la jointure « possédé ailleurs dans la collection »
// / « déjà dans ce deck » que le tiroir affiche par ligne (badges `N owned` /
// `in deck ×N`), et le badge `N owned` doit venir d'une jointure, pas d'un
// second appel par ligne — donc une seule requête porte le texte, le rang et
// ces deux jointures corrélées.
import { sql } from 'drizzle-orm'

import {
  users,
  type DeckState,
  type DeckZone,
  type Finish,
  type Legality,
} from '@spellcache/db/schema'
import { availableQtyExpr } from '@/lib/decks/availability'
import { deckColorIdentity } from '@/lib/decks/identity'
import {
  evaluateDeck,
  isDeckFormat,
  type DeckEvaluationCard,
  type DeckFormat,
  type DeckStatus,
} from '@/lib/decks/legality'
import { requireContainerAccess } from '@/lib/collections/authorize'
import type { Currency } from '@/lib/format/money'
import { thumbUrl } from '@spellcache/core/images'
import { textArray } from '@spellcache/db/array-param'
import { db } from '@spellcache/db'
import { getCardArtist } from '@/lib/cards/artist'

export interface DeckSlot {
  holdingId: string
  cardId: string
  name: string
  manaCost: string | null
  setLine: string // "CMR #6 · owned ×1" | "DMR #34 · not owned"
  need: number // exemplaires voulus
  ownedElsewhere: number // exemplaires disponibles hors de ce deck
  state: 'owned' | 'missing'
  priceMinor: number | null
  zone: DeckZone
  thumbUrl: string
}

export interface DeckDetail {
  id: string
  name: string
  format: DeckFormat | null
  // Texte brut de `containers.format` : un
  // format libre inconnu des sept connus (ex. « Cube ») n'est jamais une
  // valeur de `DeckFormat` — `format` ci-dessus retombe alors sur `null`
  // (aucune règle de légalité à appliquer, comme un deck sans format), mais
  // l'écran doit encore afficher ce que l'utilisateur a tapé et lui offrir
  // une cible « to go » par défaut (60) plutôt
  // que de faire disparaître l'information.
  formatRaw: string | null
  deckState: DeckState
  colorIdentity: string[]
  commander: DeckSlot | null
  // Artiste du commandant, crédité sous le titre quand son `art_crop` sert
  // de fond (l'illustration recadrée ne porte pas la ligne d'artiste).
  commanderArtist: string | null
  slots: DeckSlot[]
  coverage: { owned: number; total: number; missing: number; toBuyMinor: number }
  manaCurve: Array<{ cmc: number; count: number }> // 0..7+, 8 barres
  // Union des identités de toutes les cartes — consommée par le filtre
  // « Legal in deck colours » du tiroir d'ajout (extra de l'app) ;
  // `colorIdentity` ci-dessus ne porte, elle, que les commandants (en-tête).
  builderColorIdentity: string[]
  // Répartition des couleurs : TOUJOURS six
  // entrées W,U,B,R,G,C sur le deck entier, terrains inclus, les incolores
  // comptés dans `C` ; `pct` : proportion du plus grand `count`.
  colorPips: ColorPip[]
  // Les trois nombres en tête de l'onglet `Stats`. `totalCards` compte tout
  // le deck (commandant et réserve compris, comme la valeur) ; `avgCmc` et le
  // partage terrains/sorts ne portent que sur le mainboard — même périmètre
  // que `manaCurve` juste au-dessus, sinon la moyenne dirait autre chose que
  // la courbe qu'elle surmonte.
  stats: { totalCards: number; avgCmc: number; lands: number; nonlands: number }
  // Notes libres du deck (`containers.description`) : l'onglet `Infos` les
  // édite, rien d'autre ne les lit.
  description: string
  status: DeckStatus
}

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
export interface ColorPip {
  color: ManaColor
  count: number
  pct: number
}

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

interface DeckSlotSqlRow {
  holdingId: string
  cardId: string
  name: string
  manaCost: string | null
  setCode: string
  collectorNumber: string
  qty: number
  zone: DeckZone
  isCommander: boolean
  finish: 'nonfoil' | 'foil' | 'etched'
  typeLine: string
  cmc: string
  colorIdentity: string[]
  legalities: Record<string, Legality>
  usd: string | null
  usdFoil: string | null
  eur: string | null
  eurFoil: string | null
  ownedElsewhere: number
}

interface DeckSqlRow extends Record<string, unknown> {
  id: string
  name: string
  format: string | null
  description: string | null
  deckState: DeckState | null
  slots: DeckSlotSqlRow[]
}

function unitPriceMinor(row: DeckSlotSqlRow, currency: Currency): number | null {
  const raw =
    row.finish === 'nonfoil'
      ? currency === 'usd'
        ? row.usd
        : row.eur
      : currency === 'usd'
        ? row.usdFoil
        : row.eurFoil
  return raw === null ? null : Math.round(Number(raw) * 100)
}

function setLine(row: DeckSlotSqlRow): string {
  const base = `${row.setCode.toUpperCase()} #${row.collectorNumber}`
  return row.ownedElsewhere > 0
    ? `${base} · owned ×${row.ownedElsewhere}`
    : `${base} · not owned`
}

function toSlot(row: DeckSlotSqlRow, currency: Currency): DeckSlot {
  return {
    holdingId: row.holdingId,
    cardId: row.cardId,
    name: row.name,
    manaCost: row.manaCost,
    setLine: setLine(row),
    need: row.qty,
    ownedElsewhere: row.ownedElsewhere,
    // Une carte est `owned` quand la collection en tient au moins autant
    // d'exemplaires ailleurs que ce deck en réclame — pas seulement « au
    // moins un » (`SlotRow` distingue `owned`/`missing`) : un deck qui veut 2
    // exemplaires d'une carte dont la collection ne tient qu'un seul ailleurs
    // reste `missing` pour ce holding, même si `ownedElsewhere > 0`.
    state: row.ownedElsewhere >= row.qty ? 'owned' : 'missing',
    priceMinor: unitPriceMinor(row, currency),
    zone: row.zone,
    thumbUrl: thumbUrl(row.cardId, 'small'),
  }
}

// Terrain : exclu de la courbe de mana (qui compte les cartes non-terrain du
// mainboard), même préfixe de détection que `isBasicLand` de
// `lib/decks/legality.ts` en plus large : la courbe exclut *tout* terrain
// (« Land — Gate », « Land — Desert »…), pas seulement les terrains de base —
// une règle différente de la légalité de deck (qui n'exempte que les terrains
// de base de la limite d'exemplaires), donc délibérément pas la même fonction.
// Exportée pour `tests/unit/mana-curve.test.ts` — fonction pure, aucun accès
// base, même contrainte que `evaluateDeck` (`lib/decks/legality.ts`).
export function isLand(typeLine: string): boolean {
  // Frontière de mot, insensible à la casse —
  // `includes('Land')` classait mal un type contenant « Landfall » ou une
  // casse inattendue.
  return /\bland\b/i.test(typeLine)
}

// Huit paliers de valeur de mana, `7` regroupant tout `cmc >= 7` (exactement
// 8 entrées, `0` à `7+`). `cmc` d'une carte réelle est toujours un entier au
// moment de la construction (pas de coût fractionnaire dans le jeu) mais
// revient en `numeric`/chaîne depuis Postgres (`cards.cmc`,
// `packages/db/src/schema.ts`) — `Math.floor` n'est donc là que pour la
// robustesse du type, pas pour arrondir une vraie fraction.
function manaCurveBucket(cmc: number): number {
  return Math.max(0, Math.min(7, Math.floor(cmc)))
}

// Forme minimale nécessaire à `computeManaCurve` — `DeckSlotSqlRow` (plus
// large, colonnes SQL brutes) y est structurellement assignable, donc reste
// l'appelant réel ci-dessous ; `tests/unit/mana-curve.test.ts` construit des
// fixtures sur ce seul contrat, sans dépendre de la forme SQL interne.
export interface ManaCurveCard {
  typeLine: string
  cmc: number | string
  qty: number
}

// Exportée pour `tests/unit/mana-curve.test.ts` — fonction pure, même
// contrainte que `isLand` ci-dessus.
export function computeManaCurve(
  mainboard: ManaCurveCard[],
): Array<{ cmc: number; count: number }> {
  const counts = new Array<number>(8).fill(0)
  for (const row of mainboard) {
    if (isLand(row.typeLine)) continue
    counts[manaCurveBucket(Number(row.cmc))] += row.qty
  }
  return counts.map((count, cmc) => ({ cmc, count }))
}

// Les trois nombres de l'en-tête de `Stats`. `avgCmc` est pondérée par les
// exemplaires (quatre copies d'un sort à 2 pèsent quatre fois) et arrondie à
// la présentation, jamais ici. Un mainboard sans sort rend 0 plutôt que
// `NaN` — une division par zéro affichée est un défaut, pas une information.
export function computeDeckStats(
  allRows: Array<{ qty: number }>,
  mainboardRows: ManaCurveCard[],
): { totalCards: number; avgCmc: number; lands: number; nonlands: number } {
  let totalCards = 0
  for (const row of allRows) totalCards += row.qty

  let lands = 0
  let nonlands = 0
  let cmcTotal = 0
  for (const row of mainboardRows) {
    if (isLand(row.typeLine)) {
      lands += row.qty
      continue
    }
    nonlands += row.qty
    cmcTotal += Number(row.cmc) * row.qty
  }

  return { totalCards, avgCmc: nonlands === 0 ? 0 : cmcTotal / nonlands, lands, nonlands }
}

// Répartition par couleur : le DECK ENTIER
// (mainboard + côté + commandant), terrains inclus, TOUJOURS les six lignes
// W,U,B,R,G,C — une carte multicolore compte son plein exemplaire dans
// chacune de ses couleurs, une carte sans identité colorée (terrain,
// artefact) compte dans `C`.
export function computeColorPips(
  rows: Array<{ qty: number; colorIdentity: string[] }>,
): ColorPip[] {
  const WUBRG: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
  const counts: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  for (const row of rows) {
    const cardColors = WUBRG.filter((color) => row.colorIdentity.includes(color))
    if (cardColors.length === 0) {
      counts.C += row.qty
    } else {
      for (const color of cardColors) counts[color] += row.qty
    }
  }
  const order: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C']
  const max = Math.max(1, ...order.map((color) => counts[color]))
  return order.map((color) => ({
    color,
    count: counts[color],
    pct: Math.round((counts[color] / max) * 100),
  }))
}

// Couverture (bandeau `41 of 64 already in your collection · 23 to buy`) :
// portée au commandant + mainboard, jamais au côté (« Commander · 64 cards »
// compte commander + mainboard, le côté n'entre jamais dans la taille d'un deck
// construit, règle du jeu plutôt que choix de produit).
function computeCoverage(
  slots: DeckSlotSqlRow[],
  currency: Currency,
): DeckDetail['coverage'] {
  let owned = 0
  let total = 0
  let toBuyMinor = 0

  for (const row of slots) {
    total += row.qty
    const coveredHere = Math.min(row.qty, row.ownedElsewhere)
    owned += coveredHere
    const missingHere = row.qty - coveredHere
    const priceMinor = unitPriceMinor(row, currency)
    if (missingHere > 0 && priceMinor !== null) toBuyMinor += missingHere * priceMinor
  }

  return { owned, total, missing: total - owned, toBuyMinor }
}

export async function getDeck(userId: string, deckId: string): Promise<DeckDetail> {
  await requireContainerAccess(userId, deckId, 'read')

  const [userRow] = await db
    .select({ priceSource: users.priceSource })
    .from(users)
    .where(sql`${users.id} = ${userId}`)
    .limit(1)
  const currency = toCurrency(userRow?.priceSource ?? 'cardmarket_eur')

  const { rows } = await db.execute<DeckSqlRow>(sql`
    select
      c.id, c.name, c.format, c.description,
      c.deck_state as "deckState",
      coalesce((
        -- json_agg(... order by ...) : sans clause
        -- ORDER BY, l'ordre des lignes retournées par Postgres n'est pas
        -- garanti d'un chargement à l'autre -- cet ordre est ce que le bouton
        -- Type de l'écran inverse (voir deck-view.tsx),
        -- il doit donc déjà être déterministe par défaut, trié par le type
        -- de la carte (le nom du bouton) puis par nom.
        select json_agg(json_build_object(
          'holdingId', h.id,
          'cardId', h.card_id,
          'name', cd.name,
          'manaCost', cd.mana_cost,
          'setCode', cd.set_code,
          'collectorNumber', cd.collector_number,
          'qty', h.qty,
          'zone', h.zone,
          'isCommander', h.is_commander,
          'finish', h.finish,
          'typeLine', cd.type_line,
          'cmc', cd.cmc,
          'colorIdentity', cd.color_identity,
          'legalities', cd.legalities,
          'usd', p.usd,
          'usdFoil', p.usd_foil,
          'eur', p.eur,
          'eurFoil', p.eur_foil,
          -- Fonction unique de disponibilité (partagée par les listes, le
          -- builder et l'assemblage) : une somme ad hoc compterait positivement
          -- la ligne de besoin de N'IMPORTE QUEL AUTRE deck plan/assemble
          -- -- deux decks en chantier declarant chacun une carte que
          -- personne ne possede afficheraient chacun 'owned x1'.
          -- availableQtyExpr exclut tout deck non built (dont ce deck
          -- lui-meme) et
          -- soustrait -- jamais additionne -- la reclamation d'un deck
          -- deja monte. Exclut ce deck lui-meme (voir le commentaire de
          -- availableQtyExpr) : sans cette exclusion, un deck built qui
          -- possede reellement une carte (root=1, deck la reclame en
          -- entier) l'afficherait "missing" sur SA PROPRE ligne, la formule
          -- se soustrayant elle-meme.
          'ownedElsewhere', ${availableQtyExpr(sql`h.card_id`, sql`c.collection_id`, null, sql`c.id`)}
        ) order by cd.type_line asc, cd.name asc, h.id asc)
        from holdings h
        join cards cd on cd.id = h.card_id
        left join lateral (
          select usd, usd_foil, eur, eur_foil from card_prices
          where card_prices.card_id = h.card_id
          order by day desc
          limit 1
        ) as p on true
        where h.container_id = c.id
      ), '[]'::json) as slots
    from containers c
    where c.id = ${deckId}
  `)

  const row = rows[0]
  if (!row) throw new Error(`Deck ${deckId} not found.`)

  const format = row.format && isDeckFormat(row.format) ? row.format : null
  const deckState: DeckState = row.deckState ?? 'plan'

  // Normalise `zone` sur `is_commander` avant toute lecture : `zone` et `is_commander` s'écrivent ensemble à chaque point
  // d'écriture (`addToDeckAction`, `setZoneAction`, `createDeckAction`), mais
  // une ligne peut toujours prédater ce couplage — la migration 0009 rattrape
  // les lignes existantes, ce garde couvre celles qu'une future régression ou
  // un accès direct à la base laisserait de nouveau diverger. `is_commander`
  // reste la source de vérité : un commandant est toujours rendu une seule
  // fois, jamais à la fois dans `Commander · 1` et dans `Mainboard`.
  const slotsNormalized = row.slots.map((slot) =>
    slot.isCommander && slot.zone !== 'commander' ? { ...slot, zone: 'commander' as DeckZone } : slot,
  )

  const commanderRow = slotsNormalized.find((slot) => slot.isCommander) ?? null
  const commander = commanderRow ? toSlot(commanderRow, currency) : null

  // Le côté n'entre jamais dans la légalité de deck (règle du jeu : un
  // sideboard n'est pas soumis à la taille/singleton du deck construit) —
  // seuls le commandant et le mainboard alimentent `evaluateDeck`.
  const legalityRows = slotsNormalized.filter((slot) => slot.zone !== 'side')
  const evalCards: DeckEvaluationCard[] = legalityRows.map((slot) => ({
    cardId: slot.cardId,
    name: slot.name,
    qty: slot.qty,
    legalities: slot.legalities,
    colorIdentity: slot.colorIdentity,
    typeLine: slot.typeLine,
  }))

  const status = evaluateDeck({
    format,
    deckState,
    cards: evalCards,
    commander: commanderRow ? { colorIdentity: commanderRow.colorIdentity } : null,
  })

  // Identité d'en-tête : l'union des commandants SEULS, vide sans commandant
  // — jamais l'union des cartes. L'union complète reste calculée pour le
  // filtre « Legal in deck colours » du tiroir d'ajout.
  const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'] as const
  // L'UNION de TOUS les commandants, pas le
  // premier trouvé : des partenaires — ou un doublon de zone — dont le
  // premier porte une identité vide rendaient l'en-tête muet.
  const commanderIdentityUnion = new Set<string>()
  for (const slot of slotsNormalized) {
    if (!slot.isCommander) continue
    for (const color of slot.colorIdentity) commanderIdentityUnion.add(color)
  }
  const colorIdentity = WUBRG_ORDER.filter((color) => commanderIdentityUnion.has(color))
  const builderColorIdentity = deckColorIdentity({
    commanderColorIdentity: commanderRow?.colorIdentity ?? null,
    cardColorIdentities: evalCards.map((card) => card.colorIdentity),
  })

  const slots = slotsNormalized.map((slot) => toSlot(slot, currency))
  // Statistiques sur le DECK ENTIER — mainboard + côté + commandant : la courbe et la moyenne excluent seulement
  // les terrains, la répartition des couleurs inclut tout.
  const manaCurve = computeManaCurve(slotsNormalized)
  const stats = computeDeckStats(slotsNormalized, slotsNormalized)
  const colorPips = computeColorPips(slotsNormalized)
  const coverage = computeCoverage(legalityRows, currency)

  const commanderArtist = await getCardArtist(commanderRow?.cardId ?? null)

  return {
    id: row.id,
    name: row.name,
    format,
    formatRaw: row.format,
    deckState,
    colorIdentity,
    builderColorIdentity,
    commander,
    commanderArtist,
    slots,
    coverage,
    manaCurve,
    colorPips,
    stats,
    description: row.description ?? '',
    status,
  }
}

// Résultat d'une ligne du tiroir d'ajout (`AddRow`).
export interface AddDrawerCard {
  cardId: string
  name: string
  manaCost: string | null
  setLine: string // "DMR · Dominaria Remastered #34"
  // Champs bruts derrière `setLine` ci-dessus : le
  // format `AddRow` du tiroir (« DMR · Dominaria Remastered #34 ») diffère
  // de celui de `DeckSlot.setLine` (« DMR #34 · owned ×1 »), et l'insertion
  // optimiste d'un `DeckSlot` (`deck-view.tsx`, `handleCardAdded`/
  // `applyOptimisticDelta`) doit produire ce second format dès le premier
  // rendu, pas celui du tiroir en attendant un rechargement.
  setCode: string
  collectorNumber: string
  // Unité majeure, dans la DEVISE DU COMPTE (`users.price_source`) — même
  // règle que l'onglet Search : jamais un dollar codé en dur pour un compte
  // en euros.
  price: number | null
  currency: Currency
  thumbUrl: string
  ownedElsewhere: number
  // Quantité TOTALE de cette carte dans le deck, toutes zones confondues
  // — délibérément pas scopée à la zone sélectionnée
  // dans le tiroir : le segmenté ne redéclenche jamais cette requête
  // (`add-drawer.tsx` ne dépend pas de `zone`), donc une valeur scopée
  // resterait celle de la zone précédente après un changement de zone sans
  // nouvel ajout — fausse dès le premier `Side`. `add-drawer.tsx` ne reconcilie
  // plus jamais ce champ avec `addToDeckAction.qtyInDeck` (scopé à la zone
  // ajoutée, une sémantique différente pour `DeckSlot.need` côté
  // `deck-view.tsx`) : il applique uniquement le delta optimiste ±1 du tap,
  // exact par construction puisqu'un ajout réussi ajoute toujours exactement un
  // exemplaire au total du deck, quelle que soit sa zone.
  inDeckQty: number
  // Finitions disponibles pour cette impression précise (`cards.finishes`)
  // — alimente le sélecteur d'impression, ouvert uniquement à la demande. Un
  // tap sur la ligne ne l'ouvre que si plus d'une finition existe
  // (`components/decks/add-drawer.tsx`) ; sinon rien à choisir.
  finishes: Finish[]
}

export interface SearchDeckCardsParams {
  query: string
  legalInColours: boolean
  ownedOnly: boolean
  limit?: number
}

const ADD_DRAWER_DEFAULT_LIMIT = 40
const ADD_DRAWER_MAX_LIMIT = 100

interface AddDrawerSqlRow extends Record<string, unknown> {
  id: string
  name: string
  mana_cost: string | null
  set_code: string
  set_name: string
  collector_number: string
  price: string | null
  owned_elsewhere: string
  in_deck_qty: string
  finishes: Finish[]
}

// Correspondance et rang identiques à `lib/search/search-cards.ts`
// (recherche stricte demandée) — dupliqués plutôt qu'importés : ce
// module n'expose pas ses fragments SQL internes, et ce tiroir a besoin de
// deux jointures corrélées que `searchCards()` ne porte pas (voir le
// commentaire d'en-tête de ce fichier). Chaque mot de la requête doit
// apparaître dans le nom (`ilike`, accéléré par l'index trigramme) ; la
// similarité ne sert qu'au classement, avec le même bonus de préfixe exact.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function rankExpression(query: string) {
  if (query.length === 0) return sql`0::real`
  return sql`(
    (case when cards.name ilike ${escapeLikePattern(query) + '%'} then 1 else 0 end)
    + coalesce(similarity(cards.name, ${query}), 0)
  )`
}

function textCondition(query: string) {
  if (query.length === 0) return sql`true`
  const words = query.split(' ').filter((word) => word.length > 0)
  if (words.length === 0) return sql`true`
  const conditions = words.map((word) => sql`cards.name ilike ${'%' + escapeLikePattern(word) + '%'}`)
  return sql.join(conditions, sql` and `)
}

// Sous-ensemble de l'identité colorée du deck (puce `Legal in deck colours`) :
// une identité vide (deck sans commandant ni carte colorée) force les cartes
// strictement incolores, jamais un filtre no-op — même lecture que
// `colorCondition` de `lib/search/search-cards.ts` pour son cas
// `isColorlessOnly`.
function legalInColoursCondition(colorIdentity: string[]) {
  if (colorIdentity.length === 0) return sql`cards.color_identity = ARRAY[]::text[]`
  return sql`cards.color_identity <@ ${textArray(colorIdentity)}`
}

function formatPrice(price: string | null): number | null {
  return price === null ? null : Number(price)
}

// Recherche du tiroir d'ajout persistant : cherche dans le catalogue entier,
// pas dans la collection — `Owned only` restreint le résultat après coup,
// jamais la source. Une seule page, sans curseur (même précédent que le picker
// de commandant, `app/(app)/decks/decks-view.tsx`, et `AddCardSheet`) : ce
// tiroir affiche un nombre borné de correspondances les mieux classées, pas une
// liste exhaustive à faire défiler.
export async function searchDeckCards(
  userId: string,
  deckId: string,
  colorIdentity: string[],
  params: SearchDeckCardsParams,
): Promise<AddDrawerCard[]> {
  const access = await requireContainerAccess(userId, deckId, 'read')

  // Devise du compte (même résolution que `getDeckDetail` ci-dessus) : le
  // prix affiché par le tiroir suit `users.price_source`.
  const [drawerUserRow] = await db
    .select({ priceSource: users.priceSource })
    .from(users)
    .where(sql`${users.id} = ${userId}`)
    .limit(1)
  const drawerCurrency = toCurrency(drawerUserRow?.priceSource ?? 'cardmarket_eur')

  const query = params.query.trim().replace(/\s+/g, ' ').toLowerCase()
  const limit = Math.min(
    Math.max(Math.trunc(params.limit ?? ADD_DRAWER_DEFAULT_LIMIT), 1),
    ADD_DRAWER_MAX_LIMIT,
  )

  const { rows } = await db.execute<AddDrawerSqlRow>(sql`
    with scored as (
      select
        cards.id,
        cards.name,
        cards.mana_cost,
        cards.set_code,
        sets.name as set_name,
        cards.collector_number,
        cards.finishes,
        (case when ${sql.raw(drawerCurrency === 'usd' ? 'true' : 'false')} then latest_price.usd else latest_price.eur end) as price,
        ${rankExpression(query)} as rank,
        -- Fonction unique de disponibilite --
        -- exclut naturellement CE deck (comme n'importe quel autre deck
        -- plan/assemble, jamais compte) sans condition dediee : un deck
        -- plan/assemble ne contribue jamais positivement, container_id <>
        -- deckId devient donc redondant plutot que
        -- necessaire, et deux decks en chantier ne s'inflatent plus l'un
        -- l'autre en « owned elsewhere ».
        ${availableQtyExpr(sql`cards.id`, sql`${access.collectionId}::uuid`, null, sql`${deckId}::uuid`)} as owned_elsewhere,
        (
          select coalesce(sum(h.qty), 0)
          from holdings h
          where h.card_id = cards.id and h.container_id = ${deckId}::uuid
        ) as in_deck_qty
      from cards
      join sets on sets.code = cards.set_code
      left join lateral (
        select usd, eur from card_prices
        where card_prices.card_id = cards.id
        order by day desc
        limit 1
      ) as latest_price on true
      where ${textCondition(query)}
        ${params.legalInColours ? sql`and ${legalInColoursCondition(colorIdentity)}` : sql``}
    )
    select * from scored
    where ${params.ownedOnly ? sql`owned_elsewhere > 0` : sql`true`}
    order by rank desc, name asc, id asc
    limit ${limit}
  `)

  return rows.map((row) => ({
    cardId: row.id,
    name: row.name,
    manaCost: row.mana_cost,
    setLine: `${row.set_code.toUpperCase()} · ${row.set_name} #${row.collector_number}`,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    price: formatPrice(row.price),
    currency: drawerCurrency,
    thumbUrl: thumbUrl(row.id, 'small'),
    ownedElsewhere: Number(row.owned_elsewhere),
    inDeckQty: Number(row.in_deck_qty),
    finishes: row.finishes,
  }))
}
