// Résolution et exécution de l'assemblage/démontage d'un deck. Deux fonctions
// distinctes — `planAssembly` (lecture pure côté base, aucune écriture) et
// `assembleDeck`/`dismantleDeck` (transactionnelles) — même séparation que
// `resolveTargetHoldingIds`/`bulkEdit` : la feuille d'assemblage relit
// `planAssembly` à chaque bascule d'interrupteur
// (`fromLooseCollection`/`fromOtherBuiltDecks`), sans jamais écrire tant que
// le bouton `Assemble with the N owned` n'a pas été pressé.
//
// Invariant central (« la réservation ne duplique rien : un holding appartient
// au deck ou à la collection, jamais aux deux ») : le holding d'un deck
// (`containerId = deckId`) est sa déclaration de besoin, posée à l'ajout de
// carte. Modèle retenu : **déclaratif tant que le deck n'est pas démonté**.
// `assembleDeck` ne déplace JAMAIS de holding pour une carte déjà possédée
// (`plan.owned`) ni empruntée (`plan.borrowed` réduit la ligne du deck SOURCE,
// jamais la ligne du deck cible) — une fois le deck `built`, la ligne du deck
// cible devient automatiquement une réclamation sur le stock physique partagé
// via `availableQtyExpr` (`lib/decks/availability.ts`), sans qu'une seule
// ligne de `holdings` ne bouge. Root/binder gardent donc leur quantité brute
// intacte pendant tout le cycle `built` (quantité totale ET quantité
// disponible, deux valeurs distinctes sur LA MÊME ligne — impossible si la
// quantité brute était décrémentée à l'assemblage). Les deux seules
// écritures que `assembleDeck` effectue sur des holdings sont donc :
//   1. une carte cochée « achetée » (`acquiredHoldingIds`) ajoute du stock
//      physique dans le container racine de la collection — jamais dans le
//      deck, dont la ligne de besoin existe déjà ;
//   2. une carte empruntée à un autre deck `built` réduit (ou supprime) la
//      ligne de besoin de CE deck source, qui reste en état incomplet —
//      jamais la ligne du deck cible, déjà correcte.
// `dismantleDeck`, en revanche, EST le moment où un vrai règlement physique
// a lieu — une seule fois, à la sortie de `built` (voir son propre
// commentaire plus bas). Déplacer aveuglément les lignes du deck vers le
// binder choisi, sans vérifier qu'un stock réel les adosse, dupliquerait tout
// exemplaire réellement possédé et matérialiserait les manquantes jamais
// achetées.
// Ce module écrit directement sur `holdings`/`containers` via sa propre
// transaction plutôt que d'appeler `lib/containers/holdings.ts` : ces
// fonctions refusent désormais toute écriture sur un deck `built`, et c'est
// précisément le container que ce module
// doit pouvoir modifier (le deck source d'un emprunt, ou le deck cible en
// train de le devenir) — un écrivain privilégié, pas un appelant à bloquer.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import {
  containers,
  containerStats,
  holdings,
  users,
  type Condition,
  type Finish,
  type Holding,
} from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'
import type { Currency } from '@/lib/format/money'
import { uuidArray } from '@spellcache/db/array-param'

import { getDeck, type DeckSlot } from '@/app/(app)/decks/[id]/deck-data'

import { availabilityMap } from './availability'
import { assertReachableBuilt, assertTransition } from './lifecycle'
import { recomputeContainerStats } from '../containers/stats'

export interface AssemblePlan {
  owned: DeckSlot[]
  missing: DeckSlot[]
  borrowed: Array<DeckSlot & { fromDeckId: string; fromDeckName: string }>
  toBuyMinor: number
}

export interface PlanAssemblyOptions {
  fromLooseCollection: boolean
  fromOtherBuiltDecks: boolean
}

function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

interface BorrowSourceRow extends Record<string, unknown> {
  card_id: string
  borrow_sources: Array<{ deckId: string; deckName: string; qty: number }>
}

// Sources d'emprunt par carte — les decks `built` autres que celui-ci, seuls
// capables de prêter (un deck encore en chantier n'a rien à prêter). Une seule
// requête groupée pour toute la liste (pas de N+1 sur 1000 lignes), distincte
// de la disponibilité générale ci-dessous : cette dernière NE PORTE PAS
// l'identité du deck qui réserve, seulement le solde net, alors que la
// feuille d'assemblage a besoin du nom du deck source
// (`Taken from other decks · N`).
async function loadBorrowSources(
  collectionId: string,
  deckId: string,
  cardIds: string[],
): Promise<Map<string, Array<{ deckId: string; deckName: string; qty: number }>>> {
  const map = new Map<string, Array<{ deckId: string; deckName: string; qty: number }>>()
  if (cardIds.length === 0) return map

  const { rows } = await db.execute<BorrowSourceRow>(sql`
    select
      h.card_id as card_id,
      coalesce(
        json_agg(json_build_object('deckId', c.id, 'deckName', c.name, 'qty', h.qty))
          filter (where c.kind = 'deck' and c.deck_state = 'built' and c.id <> ${deckId}::uuid),
        '[]'
      ) as borrow_sources
    from holdings h
    join containers c on c.id = h.container_id
    where h.card_id = any(${uuidArray(cardIds)}) and c.collection_id = ${collectionId}::uuid
    group by h.card_id
  `)

  for (const row of rows) map.set(row.card_id, row.borrow_sources)
  return map
}

// Disponibilité générale par carte, pour la classification `owned`/`missing`
// de `planAssembly` ci-dessous. Elle passe par `availabilityMap`
// (`lib/decks/availability.ts`), la fonction unique de disponibilité,
// partagée par les listes, le builder et l'assemblage, qui tient compte des
// réclamations des AUTRES
// decks déjà montés. Une somme de stock hors-deck propre à cette fonction
// ignorerait ces réclamations : une carte possédée une seule fois et déjà
// sleevée dans un deck A (`available = 0`) passerait `owned` pour un deck B,
// deux decks montés prétendant alors à la même copie (`availableQty` à `-1`).
async function loadCardAvailability(
  collectionId: string,
  cardIds: string[],
): Promise<Map<string, number>> {
  return availabilityMap(collectionId, cardIds)
}

// Résolution pure côté lecture : aucune écriture, rejouable à chaque bascule
// des deux interrupteurs `Take cards from` de la feuille d'assemblage. Portée
// au commandant + mainboard, jamais au côté (même périmètre que
// `computeCoverage`, `deck-data.ts` — le côté n'entre jamais dans la taille
// d'un deck construit).
export async function planAssembly(
  userId: string,
  deckId: string,
  opts: PlanAssemblyOptions,
): Promise<AssemblePlan> {
  const access = await requireContainerAccess(userId, deckId, 'read')
  const deck = await getDeck(userId, deckId)

  const slots = deck.slots.filter((slot) => slot.zone !== 'side')
  const cardIds = [...new Set(slots.map((slot) => slot.cardId))]
  const [availability, borrowSources] = await Promise.all([
    loadCardAvailability(access.collectionId, cardIds),
    loadBorrowSources(access.collectionId, deckId, cardIds),
  ])

  const owned: DeckSlot[] = []
  const missing: DeckSlot[] = []
  const borrowed: Array<DeckSlot & { fromDeckId: string; fromDeckName: string }> = []

  for (const slot of slots) {
    const available = availability.get(slot.cardId) ?? 0
    const sources = borrowSources.get(slot.cardId) ?? []

    if (opts.fromLooseCollection && available >= slot.need) {
      owned.push(slot)
      continue
    }

    if (opts.fromOtherBuiltDecks) {
      // Source déterministe : la première, triée par nom de deck, capable de
      // couvrir la totalité du besoin — un même deck ne se voit jamais
      // scindé entre plusieurs sources dans `AssemblePlan.borrowed`, qui n'en
      // porte qu'une par carte (`fromDeckId`/`fromDeckName` singuliers).
      const source = [...sources]
        .sort((a, b) => a.deckName.localeCompare(b.deckName))
        .find((candidate) => candidate.qty >= slot.need)
      if (source) {
        borrowed.push({ ...slot, fromDeckId: source.deckId, fromDeckName: source.deckName })
        continue
      }
    }

    // `slot.ownedElsewhere` (le pool « Loose collection » que l'interrupteur
    // vient d'exclure de la classification `owned`/`missing` ci-dessus) n'est
    // conservé sur la ligne `missing` QUE si `fromLooseCollection` est activé.
    // Sans ce zérotage, une carte encore possédée ailleurs, classée `missing`
    // interrupteur éteint, compterait encore comme partiellement couverte plus
    // bas (`toBuyMinor`) ET dans `assembleDeck` (`buyQty = need −
    // ownedElsewhere`, qui relit cette MÊME valeur sur `opts.plan.missing`) :
    // la tuile `to buy` afficherait le même montant dans les deux positions de
    // l'interrupteur — `0 to buy` pour un deck entièrement possédé ailleurs,
    // interrupteur éteint — et cocher une telle carte comme « achetée » ne
    // matérialiserait aucun stock neuf. Interrupteur allumé : valeur
    // inchangée, `ownedElsewhere` reflète le pool réellement disponible,
    // exactement ce que `computeCoverage` (`deck-data.ts`, qui n'a pas de
    // notion d'interrupteur et suppose toujours `fromLooseCollection: true`)
    // soustrait pour son propre `toBuyMinor` — les deux écrans ne concordent
    // donc que dans cet état par défaut, le seul que `computeCoverage`
    // prétend représenter.
    missing.push(opts.fromLooseCollection ? slot : { ...slot, ownedElsewhere: 0 })
  }

  // Déficit réel par carte manquante, jamais le besoin total :
  // `slot.ownedElsewhere` (déjà porté par `DeckSlot`, calculé par `getDeck`,
  // et déjà zéroté ci-dessus quand l'interrupteur `Loose collection` est
  // éteint) est la MÊME quantité que `computeCoverage` (`deck-data.ts`)
  // soustrait pour son propre `toBuyMinor` (`qty − min(qty, ownedElsewhere)`).
  // Facturer le besoin ENTIER d'une carte partiellement possédée (need 2,
  // 1 déjà possédé ailleurs) ferait citer à cet écran et à l'écran Planning
  // des montants différents pour le même deck. Une carte sans prix connu ne
  // casse pas le total, elle en est simplement absente.
  const toBuyMinor = missing.reduce((sum, slot) => {
    if (slot.priceMinor === null) return sum
    const deficit = Math.max(0, slot.need - slot.ownedElsewhere)
    return sum + slot.priceMinor * deficit
  }, 0)

  return { owned, missing, borrowed, toBuyMinor }
}

export interface AssembleDeckOptions {
  plan: AssemblePlan
  acquiredHoldingIds?: string[]
}

export interface AssembleDeckResult {
  deckState: 'built'
  reserved: number
  stillMissing: number
}

interface DeckContainerRow {
  id: string
  collectionId: string
  kind: string
  deckState: 'plan' | 'assemble' | 'built' | 'dismantled' | null
}

async function lockDeckContainer(
  tx: Tx,
  userId: string,
  deckId: string,
  need: 'read' | 'write',
): Promise<DeckContainerRow> {
  await requireContainerAccess(userId, deckId, need)
  const [row] = await tx
    .select({
      id: containers.id,
      collectionId: containers.collectionId,
      kind: containers.kind,
      deckState: containers.deckState,
    })
    .from(containers)
    .where(eq(containers.id, deckId))
    .for('update')
    .limit(1)
  if (!row) throw new Error(`Deck ${deckId} not found.`)
  if (row.kind !== 'deck') throw new Error(`Container ${deckId} is not a deck.`)
  return row
}

async function rootContainerOf(tx: Tx, collectionId: string): Promise<string> {
  const [row] = await tx
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')))
    .limit(1)
  if (!row) throw new Error(`Collection ${collectionId} has no root container.`)
  return row.id
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function matchHoldingKey(
  containerId: string,
  cardId: string,
  finish: Finish,
  condition: Condition,
  language: string,
) {
  return and(
    eq(holdings.containerId, containerId),
    eq(holdings.cardId, cardId),
    eq(holdings.finish, finish),
    eq(holdings.condition, condition),
    eq(holdings.language, language),
    eq(holdings.zone, 'main'),
  )
}

// Ajoute du stock physique (achat coché) — jamais dans le deck (dont la ligne
// de besoin existe déjà et n'est pas touchée), toujours dans le container
// racine de la collection. Même patron de fusion-sur-collision que
// `addHolding` (`lib/containers/holdings.ts`), réimplémenté sur `tx` plutôt
// qu'appelé : `addHolding` ouvre sa propre transaction et refuse désormais
// l'écriture sur un deck `built`, deux raisons suffisantes pour ne pas
// l'appeler depuis une transaction déjà
// ouverte qui, elle, touche légitimement un tel container.
async function addPhysicalStock(
  tx: Tx,
  containerId: string,
  cardId: string,
  finish: Finish,
  condition: Condition,
  language: string,
  qty: number,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(holdings)
    .where(matchHoldingKey(containerId, cardId, finish, condition, language))
    .for('update')
    .limit(1)

  if (existing) {
    await tx.update(holdings).set({ qty: existing.qty + qty }).where(eq(holdings.id, existing.id))
    return
  }

  await tx.insert(holdings).values({
    containerId,
    cardId,
    finish,
    condition,
    language,
    zone: 'main',
    qty,
    isCommander: false,
  })
}

// Réduit (ou supprime) la ligne de besoin d'un deck source emprunté (le
// holding est déplacé, le deck source reste en état incomplet) — jamais la
// ligne du deck cible, déjà correcte (l'emprunt ne fait que libérer la place
// que le deck source réclamait, visible sur SA propre ligne de la liste
// `Decks`). Réduit d'abord la ligne la plus ancienne (tri par id) si
// plusieurs lignes du deck source portent la même carte sous des finitions
// différentes — cas de bord sans design dédié, résolu déterministe plutôt
// que de choisir au hasard.
//
// Écart connu, non corrigé : quand l'emprunt consomme la
// ligne source en entier (`taken >= row.qty`), elle est SUPPRIMÉE plutôt
// que ramenée à un besoin visible « missing » — le deck source perd alors
// la trace qu'il voulait cette carte, alors que le comportement attendu est
// qu'il reste listé comme manquant. Corriger cela sans dupliquer nécessite de
// distinguer, sur une même ligne, « qty voulue » de « qty physiquement
// adossée » — une distinction que le modèle actuel n'encode nulle part (une
// ligne de `holdings` ne porte qu'un seul `qty`) et qui demanderait une
// migration. Ouvrir cette colonne est une décision de modèle, pas un détail
// d'implémentation à trancher ici en aparté.

async function reduceSourceDeckHolding(
  tx: Tx,
  sourceDeckId: string,
  cardId: string,
  qty: number,
): Promise<void> {
  const rows = await tx
    .select()
    .from(holdings)
    .where(and(eq(holdings.containerId, sourceDeckId), eq(holdings.cardId, cardId)))
    .orderBy(holdings.id)
    .for('update')

  let remaining = qty
  for (const row of rows) {
    if (remaining <= 0) break
    const taken = Math.min(remaining, row.qty)
    if (taken >= row.qty) {
      await tx.delete(holdings).where(eq(holdings.id, row.id))
    } else {
      await tx.update(holdings).set({ qty: row.qty - taken }).where(eq(holdings.id, row.id))
    }
    remaining -= taken
  }
}

export interface StockCandidate {
  id: string
  containerId: string
  qty: number
  finish: Finish
  condition: Condition
  language: string
  // Portion de `qty` réellement consommable par CE règlement — défaut :
  // `qty` en entier. Distinct de `qty` (la
  // quantité RÉELLE en base, utilisée pour la décision suppression/mise à
  // jour ci-dessous) uniquement pour la propre ligne du container CIBLE
  // d'un démontage quand ce même règlement y a déjà consommé une partie de
  // `qty` plus tôt dans sa propre boucle : ce qui a déjà été compté ne doit
  // jamais se re-consommer, mais le reste de la ligne — le stock qui s'y
  // trouvait AVANT que ce démontage ne commence — reste une source légitime.
  // Voir `decrementLooseStock` ci-dessous.
  consumableQty?: number
  // Vrai quand cette ligne source vit déjà dans le container CIBLE du
  // démontage : la consommer ne
  // déplace rien, donc ne doit produire NI suppression NI mise à jour — la
  // ligne garde son `id` et son `added_at` (patron `moveHoldings`,
  // `lib/containers/holdings.ts:359-362 : update de container_id sur place,
  // suppression réservée à la fusion sur une ligne existante` — ici il n'y a
  // même pas de container_id à changer). `consumeStockRows` route ces
  // groupes vers `settledInPlace`, jamais vers `consumed`, pour que
  // l'appelant ne tente ni suppression, ni ré-insertion sur une identité qui
  // n'a jamais quitté sa place.
  inTarget?: boolean
}

export interface ConsumedGroup {
  finish: Finish
  condition: Condition
  language: string
  qty: number
}

export interface ConsumeStockResult {
  takenQty: number
  touchedContainerIds: string[]
  // Un groupe par identité RÉELLE d'exemplaire consommé (finish/condition/
  // language de la ligne prélevée) — jamais celle du besoin qui la réclame.
  // Une seule ligne source peut suffire, ou plusieurs de finitions
  // différentes peuvent se combiner pour couvrir `qty` : `consumed` porte
  // alors plusieurs groupes. Ne contient QUE les groupes prélevés hors de la
  // cible : c'est la seule portion qui doit effectivement bouger, donc la
  // seule que l'appelant doit déposer dans la cible.
  consumed: ConsumedGroup[]
  // Groupes prélevés sur une ligne qui vivait déjà dans le container CIBLE
  // — comptent dans `takenQty` (le
  // besoin du deck est bien couvert) mais ne portent AUCUNE écriture : la
  // ligne source n'a ni bougé ni changé de quantité, l'appelant ne doit donc
  // ni la supprimer, ni la recréer, ni fusionner quoi que ce soit dessus.
  settledInPlace: ConsumedGroup[]
  deletions: string[]
  updates: Array<{ id: string; qty: number }>
}

// Cœur pur du règlement physique du démontage : consomme jusqu'à `qty`
// exemplaires depuis `rows` — déjà filtrées et ordonnées par l'appelant SQL
// (`decrementLooseStock` ci-dessous : racine d'abord, puis id de holding,
// container cible INCLUS dans le pool) — sans jamais réécrire
// l'identité d'un exemplaire réellement prélevé : une carte foil/LP/non-
// anglaise qui adosse une déclaration nonfoil-NM-en reste foil/LP/non-
// anglaise dans `consumed`/`settledInPlace`, groupée par sa PROPRE identité,
// jamais fondue dans celle de la ligne de deck qui la réclamait (« la
// réservation ne duplique rien » + docs/development.md « données utilisateur
// irremplaçables » : réécrire l'identité à ce point EST une perte de
// données, pas un détail cosmétique).
//
// Une ligne marquée `inTarget` (déjà présente dans le container cible du
// démontage) ne produit NI suppression NI mise à jour. Sinon, une ligne cible
// entièrement consommée (`taken >= row.qty`, le cas le plus courant : le
// binder choisi comme cible détient déjà la totalité du stock qui adosse le
// deck) atterrirait dans `deletions`, puis la boucle de dépôt de
// `dismantleDeck` la recréerait sous un `id` neuf faute de trouver la ligne
// qu'elle venait elle-même de supprimer — un exemplaire qui n'a jamais quitté
// sa place perdrait son `holdings.id` et son `added_at` d'origine. Ces
// groupes rejoignent donc `settledInPlace`, jamais `consumed` : la seule
// chose que l'appelant doit encore faire pour eux est compter `taken` dans
// `takenQty` — aucune écriture sur `holdings`.
// Aucun accès base — exportée pour `tests/unit/assemble-settlement.test.ts`,
// qui prouve ce comportement sans Postgres, même patron que
// `computeManaCurve`/`isLand` (`deck-data.ts`).
export function consumeStockRows(rows: StockCandidate[], qty: number): ConsumeStockResult {
  let remaining = qty
  const touched = new Set<string>()
  const deletions: string[] = []
  const updates: Array<{ id: string; qty: number }> = []
  const consumedByKey = new Map<string, ConsumedGroup>()
  const settledByKey = new Map<string, ConsumedGroup>()

  for (const row of rows) {
    if (remaining <= 0) break
    const available = row.consumableQty ?? row.qty
    const taken = Math.min(remaining, available)
    if (taken <= 0) continue

    touched.add(row.containerId)
    remaining -= taken
    const key = `${row.finish}|${row.condition}|${row.language}`

    if (row.inTarget) {
      const existing = settledByKey.get(key)
      if (existing) {
        existing.qty += taken
      } else {
        settledByKey.set(key, { finish: row.finish, condition: row.condition, language: row.language, qty: taken })
      }
      continue
    }

    if (taken >= row.qty) {
      deletions.push(row.id)
    } else {
      updates.push({ id: row.id, qty: row.qty - taken })
    }

    const existing = consumedByKey.get(key)
    if (existing) {
      existing.qty += taken
    } else {
      consumedByKey.set(key, { finish: row.finish, condition: row.condition, language: row.language, qty: taken })
    }
  }

  return {
    takenQty: qty - remaining,
    touchedContainerIds: [...touched],
    consumed: [...consumedByKey.values()],
    settledInPlace: [...settledByKey.values()],
    deletions,
    updates,
  }
}

// Retire jusqu'à `qty` exemplaires du stock physique hors-deck de la
// collection pour une carte, toutes finitions confondues (racine, binders,
// listes — jamais un container `deck`) — miroir de `reduceSourceDeckHolding`
// ci-dessus, mais scopé à toute la collection plutôt qu'à un seul deck
// source. Utilisé uniquement par `dismantleDeck` ci-dessous (« la réservation
// ne duplique rien ») : sous le modèle déclaratif
// de ce module (voir l'en-tête de fichier), le stock qu'un deck `built`
// réclamait n'a JAMAIS physiquement bougé pendant `assembleDeck` — c'est au
// démontage, et seulement là, qu'un montant réellement disponible est
// retiré d'ici pour atterrir dans le binder choisi. Ne retire jamais plus
// que ce qui existe vraiment : retourne moins que `qty` si la collection en
// tient moins, plutôt que de lever une erreur ou de matérialiser des
// exemplaires depuis rien. Ordre déterministe : le container racine d'abord
// (`kind = 'collection'`), puis le reste par id de holding — même
// discipline que `reduceSourceDeckHolding` (« résolu déterministe plutôt
// que choisir au hasard »).
//
// Le container CIBLE (`targetContainerId`) du démontage en cours N'EST PAS
// exclu du pool source. L'exclure entièrement fermerait bien le
// double-comptage d'un deck à deux lignes pour la même carte, mais casserait
// le cas — largement plus courant, c'est la présélection par défaut de
// l'écran (`listDismantleTargetsAction` renvoie la racine en premier) — où la
// destination choisie EST le container qui détient déjà le stock adossant :
// le pool source deviendrait vide, rien ne serait réglé, et chaque ligne du
// deck survivrait intacte pendant que `deck_state` basculerait quand même à
// `'dismantled'`. `depositedThisRun` distingue les deux propriétés
// qu'exclure le container entier confondrait : « stock déjà présent dans la cible avant que
// CE démontage ne commence » (une source légitime, jamais exclue) et
// « stock déjà COMPTÉ pour la cible plus tôt dans la boucle de
// `dismantleDeck`, qu'il ait été effectivement déposé depuis un autre
// container ou simplement consommé en place » (jamais re-consommable par
// la ligne suivante).
//
// La clé de `depositedThisRun` inclut `cardId` (`${cardId}|${finish}|
// ${condition}|${language}`) : sans lui, presque toutes les lignes de deck
// partagent la même clé par défaut (nonfoil|nm|en), et le dépôt de la carte A
// retrancherait à tort son montant du `consumableQty` des cartes B, C, D…
// dans le même container cible, ne réglant plus qu'une carte sur N. La carte
// owner par `dismantleDeck` accumule, identité PAR CARTE (`cardId` inclus),
// combien a déjà été compté pour la cible pendant cette transaction ; ici, pour la seule ligne de la cible dont l'identité (CETTE
// carte, CETTE finition/condition/langue) a déjà été comptée,
// `consumableQty` retranche ce montant de `qty` (la quantité RÉELLE en
// base) — le reste de la ligne, antérieur à ce démontage, reste une source
// pleine. Pour toute autre ligne (autre container, autre carte, ou même
// cible mais identité jamais comptée ce run), `consumableQty` égale `qty`
// en entier.
async function decrementLooseStock(
  tx: Tx,
  collectionId: string,
  targetContainerId: string,
  depositedThisRun: Map<string, number>,
  cardId: string,
  qty: number,
): Promise<ConsumeStockResult> {
  if (qty <= 0) {
    return { takenQty: 0, touchedContainerIds: [], consumed: [], settledInPlace: [], deletions: [], updates: [] }
  }

  const { rows } = await tx.execute<{
    id: string
    qty: number | string
    container_id: string
    finish: Finish
    condition: Condition
    language: string
  }>(sql`
    select h.id as id, h.qty as qty, h.container_id as container_id,
      h.finish as finish, h.condition as condition, h.language as language
    from holdings h
    join containers c on c.id = h.container_id
    where h.card_id = ${cardId}::uuid
      and c.collection_id = ${collectionId}::uuid
      -- Stock physique seulement : une liste ne possède rien
      -- (lib/decks/availability.ts).
      and c.kind in ('collection', 'binder')
    order by (case when c.kind = 'collection' then 0 else 1 end), h.id
    for update
  `)

  const result = consumeStockRows(
    rows.map((row) => {
      const realQty = Number(row.qty)
      const inTarget = row.container_id === targetContainerId
      let consumableQty = realQty
      if (inTarget) {
        const key = `${cardId}|${row.finish}|${row.condition}|${row.language}`
        const deposited = depositedThisRun.get(key) ?? 0
        consumableQty = Math.max(0, realQty - deposited)
      }
      return {
        id: row.id,
        containerId: row.container_id,
        qty: realQty,
        consumableQty,
        finish: row.finish,
        condition: row.condition,
        language: row.language,
        inTarget,
      }
    }),
    qty,
  )

  for (const id of result.deletions) {
    await tx.delete(holdings).where(eq(holdings.id, id))
  }
  for (const update of result.updates) {
    await tx.update(holdings).set({ qty: update.qty }).where(eq(holdings.id, update.id))
  }

  return result
}

// Assemble un deck `plan`/`assemble` en `built` : une seule transaction, qui
// recalcule les stats de chaque container touché une seule fois.
// L'assemblage partiel est autorisé (refuser de monter un deck incomplet
// contredirait le design) —
// `plan.missing` non couvertes par `acquiredHoldingIds` restent manquantes,
// le deck devient `built` quand même.
export async function assembleDeck(
  userId: string,
  deckId: string,
  opts: AssembleDeckOptions,
): Promise<AssembleDeckResult> {
  const acquiredIds = new Set(opts.acquiredHoldingIds ?? [])

  return db.transaction(async (tx) => {
    const deckRow = await lockDeckContainer(tx, userId, deckId, 'write')
    assertReachableBuilt(deckRow.deckState ?? 'plan')

    const touchedContainerIds = new Set<string>([deckId])

    // Emprunts : réduit chaque deck source une seule fois par carte (« un
    // holding appartient au deck ou à la collection, jamais aux deux »).
    for (const slot of opts.plan.borrowed) {
      await reduceSourceDeckHolding(tx, slot.fromDeckId, slot.cardId, slot.need)
      touchedContainerIds.add(slot.fromDeckId)
    }

    // Achats cochés : ajoute du stock physique à la racine de la collection
    // pour chaque manquante effectivement acquise.
    const missingByHoldingId = new Map(opts.plan.missing.map((slot) => [slot.holdingId, slot]))
    const acquiredSlots = [...acquiredIds]
      .map((id) => missingByHoldingId.get(id))
      .filter((slot): slot is DeckSlot => slot !== undefined)

    if (acquiredSlots.length > 0) {
      const rootId = await rootContainerOf(tx, deckRow.collectionId)
      const deckHoldingRows = await tx
        .select()
        .from(holdings)
        .where(
          inArray(
            holdings.id,
            acquiredSlots.map((slot) => slot.holdingId),
          ),
        )
      const rowById = new Map(deckHoldingRows.map((row) => [row.id, row]))

      // Ajoute seulement le déficit réel, jamais `row.qty` (le besoin ENTIER de la ligne de deck) :
      // une carte cochée « achetée » alors qu'un exemplaire en est déjà
      // possédé ailleurs (need 2, `ownedElsewhere` 1) ne doit matérialiser
      // qu'UN exemplaire neuf, pas deux — sinon la copie déjà possédée se
      // retrouve dupliquée dans la racine en plus de la neuve.
      // `slot.ownedElsewhere` porte déjà, à ce point, la correction de
      // l'interrupteur `Loose collection` (voir `planAssembly` ci-dessus) : zéroté à la source si l'interrupteur
      // était éteint au moment du plan — une carte manquante, achetée alors
      // que l'utilisateur avait explicitement exclu le pool possédé ailleurs,
      // matérialise donc son besoin ENTIER plutôt qu'un déficit artificiellement
      // réduit par un stock que ce même plan a refusé de compter.
      let addedAny = false
      for (const slot of acquiredSlots) {
        const row = rowById.get(slot.holdingId)
        if (!row) continue
        const buyQty = Math.max(0, slot.need - slot.ownedElsewhere)
        if (buyQty <= 0) continue
        await addPhysicalStock(tx, rootId, row.cardId, row.finish, row.condition, row.language, buyQty)
        addedAny = true
      }
      if (addedAny) touchedContainerIds.add(rootId)
    }

    await tx.update(containers).set({ deckState: 'built' }).where(eq(containers.id, deckId))

    for (const containerId of touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    // Compte des exemplaires (`reserved` égale le nombre de cartes réellement
    // réservées), jamais des lignes : `4× Mountain` vaut 4 réservées, pas 1,
    // `AssemblePlan.owned`/`borrowed`/`missing` portant un slot par carte
    // distincte plutôt qu'un par exemplaire (même convention que
    // `DeckSlot.need`).
    const acquiredCopies = acquiredSlots.reduce((sum, slot) => sum + slot.need, 0)
    const reserved =
      opts.plan.owned.reduce((sum, slot) => sum + slot.need, 0) +
      opts.plan.borrowed.reduce((sum, slot) => sum + slot.need, 0) +
      acquiredCopies
    const stillMissing =
      opts.plan.missing.reduce((sum, slot) => sum + slot.need, 0) - acquiredCopies

    return { deckState: 'built', reserved, stillMissing }
  })
}

export interface DismantleDeckResult {
  returned: number
}

// Démonte un deck `built`. Déplacer
// chaque ligne du deck vers le binder choisi telle quelle, sans toucher le
// stock physique dont elle a été comptée comme une réclamation pendant
// `assembleDeck`, laisserait un exemplaire réellement possédé (`owned`) en
// place à la racine/dans un binder ET le ferait réapparaître une seconde fois
// dans le binder de démontage ; une manquante jamais achetée (toujours
// `missing` à l'assemblage partiel) matérialiserait un exemplaire depuis
// rien. Ce module ne connaît donc PAS la classification retenue lors de
// l'assemblage (`plan.owned`/`missing`/`borrowed` — périmée dès que le stock
// a pu bouger depuis) : pour chaque ligne du deck, `decrementLooseStock` recalcule
// ICI, dans la même transaction, combien d'exemplaires sont réellement
// adossés à du stock physique ailleurs dans la collection (racine, binder,
// liste — jamais un autre deck, dont les propres lignes sont elles-mêmes des
// réclamations, pas du stock) et retire exactement ce montant avant de le
// recréer dans le binder cible — un vrai transfert, jamais une duplication.
// La part non adossée (une carte jamais acquise) reste une simple ligne de
// besoin dans le deck, désormais `dismantled` donc non réservante
// (`availableQtyExpr` ne soustrait que les decks `built`) : `returned`
// compte les exemplaires effectivement transférés, pas le nombre de lignes.
// Ce même recalcul couvre aussi bien les cartes empruntées à un autre deck
// (déjà réellement adossées à la racine/un binder depuis leur emprunt,
// `reduceSourceDeckHolding` n'ayant jamais créé de second stock) que les
// achats cochés (`addPhysicalStock` avait déjà écrit le stock réel à la
// racine) — aucun cas particulier n'est nécessaire par origine de
// réservation. Refuse avant toute écriture un binder inexistant ou d'une
// autre collection.
//
// `decrementLooseStock` retourne `consumed`, un groupe par identité RÉELLE d'exemplaire
// prélevé (finish/condition/language de la ligne consommée) — la boucle
// ci-dessous crée/fusionne UNE ligne par groupe dans le binder cible avec
// CETTE identité, jamais celle de `row` (la ligne de besoin du deck, presque
// toujours nonfoil/NM/en par défaut du builder). Un exemplaire foil/LP/non-
// anglais adossant une déclaration nonfoil-NM-en renaît foil/LP/
// non-anglais dans le binder cible, jamais réécrit en nonfoil-NM-en — sans
// quoi le holding d'origine serait détruit et remplacé par un autre, faussant
// la valorisation (docs/development.md, « données utilisateur irremplaçables »).
//
// `decrementLooseStock` n'exclut pas `targetBinderId` du pool source ; `depositedThisRun` ci-dessous porte la même distinction que
// son commentaire, tenue à jour par CETTE boucle. Après chaque groupe réglé
// (déposé dans la cible OU consommé en place, voir plus bas), le montant
// est ajouté à `depositedThisRun` sous la clé de SON identité réelle — carte
// ET finition/condition/langue, jamais seulement celle de `row` (la clé doit
// inclure `cardId`, sans quoi le dépôt de la carte A retranche à tort son montant du `consumableQty` des
// cartes B, C, D… qui partagent la même finition/condition/langue par
// défaut) — avant l'itération suivante : si le deck porte une seconde ligne
// pour la même carte (main + side, ou deux finitions, clés d'unicité
// distinctes), la copie déjà comptée pour la cible ne peut
// plus servir une seconde fois d'adossement, tandis que le reste de la
// ligne de la cible — le stock qui s'y trouvait déjà avant ce démontage —
// reste une source pleinement légitime pour cette seconde ligne.
//
// `consumeStockRows` sépare `consumed` (prélevé HORS de la cible, doit être déplacé)
// de `settledInPlace` (prélevé DANS la cible, déjà à sa place). Seul
// `consumed` traverse la boucle fusion-ou-insertion ci-dessous ;
// `settledInPlace` ne produit AUCUNE écriture sur `holdings` — la ligne
// source, qui vivait déjà dans la cible, garde son `id` et son `added_at`
// intacts (patron `moveHoldings`, `lib/containers/holdings.ts:359-362`),
// exactement comme si rien ne s'était passé, ce qui est littéralement le
// cas : aucun transfert physique n'était nécessaire.
//
// `mode` : `'keep'` (défaut, comportement décrit ci-dessus) dépose le stock
// réglé dans `targetBinderId` ; `'discard'` s'arrête au règlement physique
// (`decrementLooseStock` a déjà supprimé/décrémenté les lignes sources
// ailleurs dans la collection) et ne dépose nulle part — l'exemplaire quitte
// la collection pour de bon, jamais recréé. `NIL_TARGET_ID` garantit que
// `decrementLooseStock` ne traite jamais aucune ligne comme « déjà dans la
// cible » en mode `discard` (aucune cible réelle n'existe à ce moment-là) :
// sans ce sentinel, une ligne qui vivrait par coïncidence dans le binder
// pointé par un `targetBinderId` fourni malgré tout par l'appelant serait
// classée `settledInPlace` et survivrait, alors qu'un démontage « discard »
// doit la faire disparaître comme n'importe quelle autre ligne source.
const NIL_TARGET_ID = '00000000-0000-0000-0000-000000000000'

export async function dismantleDeck(
  userId: string,
  deckId: string,
  targetBinderId: string,
  mode: 'keep' | 'discard' = 'keep',
): Promise<DismantleDeckResult> {
  return db.transaction(async (tx) => {
    const deckRow = await lockDeckContainer(tx, userId, deckId, 'write')
    assertTransition(deckRow.deckState ?? 'plan', 'dismantled')

    // En mode `discard`, `targetBinderId` n'est jamais une destination réelle
    // (rien n'est déposé) — la validation d'accès/appartenance du binder ne
    // s'applique donc qu'au mode `keep`, seul où ce container reçoit une
    // écriture.
    if (mode === 'keep') {
      await requireContainerAccess(userId, targetBinderId, 'write')
      const [target] = await tx
        .select({ id: containers.id, collectionId: containers.collectionId, kind: containers.kind })
        .from(containers)
        .where(eq(containers.id, targetBinderId))
        .for('update')
        .limit(1)
      if (!target) throw new Error(`Container ${targetBinderId} not found.`)
      if (target.collectionId !== deckRow.collectionId) {
        throw new Error('Cannot dismantle a deck into a binder from another collection.')
      }
      if (target.kind !== 'binder' && target.kind !== 'collection') {
        throw new Error(`Container ${targetBinderId} is not a binder or the collection root.`)
      }
    }

    const decrementTargetId = mode === 'keep' ? targetBinderId : NIL_TARGET_ID

    // `orderBy(holdings.id)` : déterministe entre deux lignes qui
    // partagent la même carte sous des finitions différentes — le stock
    // hors-deck limité, agnostique de la finition (même simplification que
    // `planAssembly`, `DeckSlot` ne porte pas de champ `finish`), doit
    // toujours être consommé dans le même ordre plutôt qu'un ordre de lecture
    // Postgres non garanti.
    const rows: Holding[] = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, deckId))
      .orderBy(holdings.id)
      .for('update')

    const touchedContainerIds = new Set<string>([deckId, ...(mode === 'keep' ? [targetBinderId] : [])])
    // Suivi des dépôts déjà réglés dans `targetBinderId` PAR CETTE
    // TRANSACTION, identité par identité (`finish|condition|language`) —
    // voir le commentaire de `decrementLooseStock` : distingue le stock déjà
    // présent dans la cible avant ce démontage (source légitime) de celui
    // que ce même règlement vient d'y déposer (jamais re-consommable). Reste
    // vide en mode `discard` : `decrementTargetId` (le sentinel ci-dessus)
    // ne correspond jamais à un container réel, donc `settledInPlace` n'est
    // jamais peuplé et cette carte n'est jamais consultée.
    const depositedThisRun = new Map<string, number>()
    let returned = 0

    for (const row of rows) {
      const {
        takenQty,
        touchedContainerIds: sources,
        consumed,
        settledInPlace,
      } = await decrementLooseStock(tx, deckRow.collectionId, decrementTargetId, depositedThisRun, row.cardId, row.qty)
      for (const containerId of sources) touchedContainerIds.add(containerId)

      if (mode === 'keep') {
        // Consommé DANS la cible :
        // rien à écrire, la ligne source n'a jamais bougé — seule la
        // comptabilité anti-double-consommation doit avancer, sous la clé
        // CARTE + identité, pour qu'une éventuelle
        // seconde ligne du deck pour la même carte ne re-consomme pas ce qui
        // vient d'être compté ici.
        for (const group of settledInPlace) {
          const depositKey = `${row.cardId}|${group.finish}|${group.condition}|${group.language}`
          depositedThisRun.set(depositKey, (depositedThisRun.get(depositKey) ?? 0) + group.qty)
        }

        // Une ligne par groupe d'identité RÉELLE : `group.finish`/`condition`/`language` sont ceux de
        // l'exemplaire effectivement prélevé, jamais `row.finish`/`condition`/
        // `language` (la déclaration de besoin du deck, presque toujours
        // nonfoil/NM/en). La zone n'a de sens que sur un deck
        // (`lib/containers/holdings.ts`) : le stock transféré
        // atterrit toujours sur la zone par défaut pour pouvoir fusionner avec
        // une ligne déjà présente dans le binder cible.
        for (const group of consumed) {
          const [existing] = await tx
            .select()
            .from(holdings)
            .where(matchHoldingKey(targetBinderId, row.cardId, group.finish, group.condition, group.language))
            .for('update')
            .limit(1)

          if (existing) {
            await tx.update(holdings).set({ qty: existing.qty + group.qty }).where(eq(holdings.id, existing.id))
          } else {
            await tx.insert(holdings).values({
              containerId: targetBinderId,
              cardId: row.cardId,
              finish: group.finish,
              condition: group.condition,
              language: group.language,
              zone: 'main',
              qty: group.qty,
              isCommander: false,
            })
          }

          // Clé cardId + identité :
          // sans `cardId`, cette écriture retrancherait à tort le dépôt de
          // CETTE carte du `consumableQty` de toute autre carte du deck
          // partageant la même finition/condition/langue par défaut dans la
          // même cible.
          const depositKey = `${row.cardId}|${group.finish}|${group.condition}|${group.language}`
          depositedThisRun.set(depositKey, (depositedThisRun.get(depositKey) ?? 0) + group.qty)
        }
      }
      // Mode `discard` : `consumed`/`settledInPlace` ne portent aucune
      // écriture supplémentaire — `decrementLooseStock` a déjà supprimé ou
      // décrémenté les lignes sources ailleurs dans la collection (racine,
      // binder, liste), et ce règlement s'arrête là. L'exemplaire quitte la
      // collection, il ne réapparaît nulle part.
      returned += takenQty

      const remainder = row.qty - takenQty
      if (remainder > 0) {
        if (remainder !== row.qty) {
          await tx.update(holdings).set({ qty: remainder }).where(eq(holdings.id, row.id))
        }
      } else {
        await tx.delete(holdings).where(eq(holdings.id, row.id))
      }
    }

    await tx.update(containers).set({ deckState: 'dismantled' }).where(eq(containers.id, deckId))

    for (const containerId of touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    return { returned }
  })
}

// Reprend un deck démonté depuis son contenu déclaré (« dismantled → plan,
// repartir du même contenu ») — une simple transition
// d'état : les lignes encore non adossées à du stock physique au moment du
// démontage (jamais acquises, voir `dismantleDeck` ci-dessus) restent en
// place dans le container du deck, donc déjà visibles comme manquantes après
// `restartDeck` — les rajouter ici les dupliquerait. Les lignes qui ONT été
// transférées vers le binder de démontage ne reviennent volontairement pas :
// elles sont désormais des exemplaires ordinaires de ce binder, à ajouter de
// nouveau au deck comme n'importe quelle carte déjà possédée (`ownedElsewhere`
// les couvrira alors immédiatement). « Repartir du même contenu » désigne
// l'identité du deck (nom, format, commandant) qui survit à son démontage,
// pas une restauration automatique de la totalité de sa liste.
export async function restartDeck(userId: string, deckId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deckRow = await lockDeckContainer(tx, userId, deckId, 'write')
    assertTransition(deckRow.deckState ?? 'plan', 'plan')
    await tx.update(containers).set({ deckState: 'plan' }).where(eq(containers.id, deckId))
  })
}

// Remet un deck `built` en chantier (« built → assemble ») — simple
// transition d'état : aucun holding
// ne bouge, `availableQtyExpr` (`lib/decks/availability.ts`) cesse
// simplement de compter ses lignes en réservation dès que `deck_state`
// change, sans qu'aucune ligne de `holdings` n'ait besoin d'être touchée.
export async function unbuildDeck(userId: string, deckId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deckRow = await lockDeckContainer(tx, userId, deckId, 'write')
    assertTransition(deckRow.deckState ?? 'plan', 'assemble')
    await tx.update(containers).set({ deckState: 'assemble' }).where(eq(containers.id, deckId))
  })
}

// Utilitaire pour `lifecycle-actions.ts` : lit la devise du compte comme
// `getDeck`/`planAssembly` (même correspondance que partout ailleurs,
// docs/development.md, unique source de vérité).
export async function priceSourceCurrency(userId: string): Promise<Currency> {
  const [row] = await db
    .select({ priceSource: users.priceSource })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return toCurrency(row?.priceSource ?? 'cardmarket_eur')
}

export interface AcquireTarget {
  id: string
  name: string
  cardCount: number
}

// Binders de la collection pour la feuille `File them where?` (`PickerSheet`),
// avec leur compte de cartes déjà précalculé (`container_stats`, docs/development.md
// « valeurs précalculées dans `container_stats` »), jamais agrégé ici.
// `null` (« No binder », la racine) est un choix géré par l'appelant, pas
// une ligne de cette liste.
export async function listAcquireTargets(userId: string, deckId: string): Promise<AcquireTarget[]> {
  const access = await requireContainerAccess(userId, deckId, 'read')

  return db
    .select({ id: containers.id, name: containers.name, cardCount: containerStats.cardCount })
    .from(containers)
    .innerJoin(containerStats, eq(containerStats.containerId, containers.id))
    .where(and(eq(containers.collectionId, access.collectionId), eq(containers.kind, 'binder')))
    .orderBy(asc(containers.sortOrder), asc(containers.createdAt))
}

export interface AcquireMissingResult {
  added: number
}

// Écrit dans la collection ce que ce deck est court, une fois pour toutes
// (« Add all N to the collection ») — pour quand la commande arrive : les
// cartes deviennent loose (jamais dans le deck, dont la ligne de besoin
// existe déjà), au binder choisi (`targetContainerId`) ou à la racine
// (`null`, « No binder »). Même périmètre que `computeCoverage`/
// `planAssembly` (commandant + mainboard, jamais le côté) ; le déficit réel
// par carte (`need - ownedElsewhere`), jamais le besoin entier — même règle
// que les achats cochés d'`assembleDeck` ci-dessus, pour la même raison :
// une carte déjà partiellement possédée ailleurs ne doit pas voir sa part
// déjà possédée dupliquée. Toujours nonfoil/NM/anglais (aucun réglage de
// finition/condition n'existe sur cette feuille), même choix par défaut que
// `addToDeckAction`.
export async function acquireMissing(
  userId: string,
  deckId: string,
  targetContainerId: string | null,
): Promise<AcquireMissingResult> {
  return db.transaction(async (tx) => {
    const deckRow = await lockDeckContainer(tx, userId, deckId, 'write')

    let destinationId = targetContainerId
    if (destinationId !== null) {
      await requireContainerAccess(userId, destinationId, 'write')
      const [target] = await tx
        .select({ id: containers.id, collectionId: containers.collectionId, kind: containers.kind })
        .from(containers)
        .where(eq(containers.id, destinationId))
        .limit(1)
      if (!target) throw new Error(`Container ${destinationId} not found.`)
      if (target.collectionId !== deckRow.collectionId) {
        throw new Error('Cannot acquire missing cards into a binder from another collection.')
      }
      if (target.kind !== 'binder') {
        throw new Error(`Container ${destinationId} is not a binder.`)
      }
    } else {
      destinationId = await rootContainerOf(tx, deckRow.collectionId)
    }

    // Lecture hors transaction (même compromis que `assembleDeck` pour
    // `getDeck`) : ce module n'a pas de second calcul de couverture, il
    // relit celui déjà tenu à jour par `getDeck` plutôt que d'en dupliquer
    // un troisième.
    const deck = await getDeck(userId, deckId)
    const relevantSlots = deck.slots.filter((slot) => slot.zone !== 'side')

    let added = 0
    for (const slot of relevantSlots) {
      const deficit = Math.max(0, slot.need - slot.ownedElsewhere)
      if (deficit <= 0) continue
      await addPhysicalStock(tx, destinationId, slot.cardId, 'nonfoil', 'nm', 'en', deficit)
      added += deficit
    }

    if (added > 0) await recomputeContainerStats(destinationId, tx)

    return { added }
  })
}
