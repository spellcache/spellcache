// Actions groupées transactionnelles : `bulkEdit`/`bulkDelete` résolvent la
// cible (une sélection explicite d'ids ou la vue filtrée entière : passer la
// vue au serveur, laisser la requête déterminer l'ensemble) dans la même
// transaction que l'écriture — tout réussit ou rien n'est appliqué — et
// recalculent `container_stats` une seule fois par container touché, jamais
// une fois par ligne (déjà la règle de `lib/containers/holdings.ts`).
//
// La jointure et le `WHERE` d'une cible « vue filtrée » réutilisent
// `HOLDINGS_JOIN_CHAIN`/`buildWhereConditions` de `holdings-data.ts` (un seul
// point de construction) plutôt que de réécrire la même logique ici — un
// second point de filtrage dérive tôt ou tard de celui-ci (précédent déjà
// rencontré avec `countHoldings`).
import { randomUUID } from 'node:crypto'

import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'

import {
  containers,
  holdings,
  users,
  type Condition,
  type Container,
  type DeckZone,
  type Finish,
  type Holding,
} from '@spellcache/db/schema'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'
import type { Currency } from '@/lib/format/money'
import type { ViewState } from '@/lib/view-state/parse'

import {
  buildWhereConditions,
  HOLDINGS_JOIN_CHAIN,
  resolveContainerScope,
} from '@/app/(app)/container/[id]/holdings-data'

import { assertNotDeckLocked, DeckLockedError } from './holdings'
import { recomputeContainerStats } from './stats'

// Réexporté pour compatibilité (`bulk-actions.ts` et ses tests importent
// cette classe depuis ce module) — la définition canonique a déménagé vers
// `lib/containers/holdings.ts` : le refus d'écriture sur un deck built couvre
// désormais aussi les mutations unitaires, pas seulement les actions
// groupées, donc un seul verrou/une seule erreur pour les deux voies.
export { DeckLockedError }

export interface BulkTarget {
  containerId: string
  holdingIds?: string[]
  // Vue filtrée entière — seuls `query`/`filters`
  // sont lus ici (`sort`/`groupBy`/`density` n'ont aucun effet sur
  // l'ensemble ciblé, seulement sur son affichage), mais le type porté par le
  // contrat est `ViewState` en entier, pas un sous-ensemble ad hoc.
  matching?: ViewState
}

export interface BulkEdit {
  qty?: number
  condition?: Condition
  finish?: Finish
  targetContainerId?: string
  // Ligne « Language » de `BulkEditSheet` : la langue fait partie de la clé
  // de fusion (`bulkEditGroupKey` ci-dessous, via `row.language`) ;
  // la clé lit simplement `edit.language` en priorité.
  language?: string
}

export interface BulkEditResult {
  affected: number
  undoToken: string
}

export interface BulkDeleteResult {
  affected: number
  undoToken: string
}

export interface BulkUndoResult {
  restored: number
  // Distingue un jeton réellement périmé
  // d'une action qui n'avait touché aucune ligne (`affected: 0`,
  // `operations: []`, toujours un jeton valide tant que la fenêtre de 6s
  // court) — les deux valaient `restored === 0`, ce que `bulkUndoAction`
  // confondait pour construire son toast d'erreur.
  expired: boolean
}

// Même correspondance que `holdings-data.ts`/`collection-data.ts` (docs/development.md,
// unique source de vérité) — dupliquée plutôt que partagée, un ternaire à
// deux branches ne justifie pas un fichier commun hors périmètre (même
// précédent que `holdings-data.ts`).
function toCurrency(priceSource: 'tcgplayer_usd' | 'cardmarket_eur'): Currency {
  return priceSource === 'tcgplayer_usd' ? 'usd' : 'eur'
}

type Executor = Pick<typeof db, 'select' | 'execute' | 'update' | 'delete' | 'insert'>

async function getContainerRow(tx: Executor, containerId: string): Promise<Container> {
  const [row] = await tx
    .select()
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1)
  if (!row) throw new Error(`Container ${containerId} not found.`)
  return row
}

const DEFAULT_ZONE: DeckZone = 'main'

// Résout la cible d'une action groupée (`BulkTarget`) : soit une sélection
// explicite (`holdingIds`, jamais hors du PÉRIMÈTRE ciblé — filtrée par
// `container_id` plutôt que reçue telle quelle), soit la vue filtrée entière
// (`matching` : un « Select all » qui accumulerait les ids déjà chargés
// donnerait un faux total) — la requête détermine l'ensemble, jamais le client.
//
// `scope` (voir le commentaire de tête de `listHoldings`,
// `holdings-data.ts`) : le périmètre
// réel de containers dans lequel chercher, résolu par `resolveContainerScope`
// — racine ⇒ elle-même + tous les binders de la collection, tout autre `kind`
// ⇒ lui-même seul. Par défaut `[target.containerId]`,
// pour ne rien changer aux trois tests unitaires de
// `tests/unit/bulk.test.ts` (leur `fakeTx` ne mock qu'une seule requête
// `holdings`, sans la requête `containers` que `resolveContainerScope`
// ajouterait) — `bulkEdit`/`bulkDelete` (les seuls appelants réels) résolvent
// et passent `scope` explicitement.
export async function resolveTargetHoldingIds(
  tx: Executor,
  userId: string,
  target: BulkTarget,
  scope: string[] = [target.containerId],
): Promise<string[]> {
  if (target.holdingIds) {
    if (target.holdingIds.length === 0) return []
    const rows = await tx
      .select({ id: holdings.id })
      .from(holdings)
      .where(
        and(
          inArray(holdings.id, target.holdingIds),
          inArray(holdings.containerId, scope),
        ),
      )
      .for('update')
    // Une cible explicite qui ne résout pas au complet (un holding a disparu
    // entre le moment où l'écran a construit la sélection et celui où
    // l'action groupée s'exécute) doit annuler toute la transaction.
    // Comparer ce total au nombre d'ids *reçus* — pas
    // au nombre d'ids déjà filtrés sur les lignes existantes : un total déjà
    // filtré comparé à lui-même ne pourrait se déclencher que sur une course
    // de quelques microsecondes entre deux lectures, jamais sur le cas du
    // critère.
    if (rows.length !== target.holdingIds.length) {
      throw new Error('Selection changed before the bulk action could be applied.')
    }
    return rows.map((row) => row.id)
  }

  if (target.matching) {
    const [userRow] = await tx
      .select({ priceSource: users.priceSource })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const currency = toCurrency(userRow?.priceSource ?? 'cardmarket_eur')

    const whereConditions = buildWhereConditions({
      containerId: target.containerId,
      containerIds: scope,
      query: target.matching.query,
      filters: target.matching.filters,
      currency,
    })

    const { rows } = await tx.execute<{ holding_id: string }>(sql`
      select holdings.id as holding_id
      ${HOLDINGS_JOIN_CHAIN}
      where (${sql.join(whereConditions, sql` and `)})
    `)
    return rows.map((row) => row.holding_id)
  }

  return []
}

// Une opération d'annulation par ligne touchée (un undoToken par action) —
// `mergedInto` couvre le cas où l'édition groupée
// déplace/fusionne une ligne dans une autre déjà présente à la clé cible
// (même sémantique de fusion que `moveHoldings`/`updateHolding`) :
// annuler retire d'abord la quantité fusionnée de la ligne d'accueil, avant
// de réinsérer la ligne d'origine à l'identique.
export interface BulkOperation {
  before: Holding
  // `isCommanderBefore` capture l'état de la ligne d'accueil *avant* la
  // fusion (réversible par bulkUndo) :
  // sans lui, annuler une fusion qui a fait passer la ligne d'accueil en
  // commandant n'aurait aucun moyen de revenir à `false` (restaurer `qty`
  // seul ne suffit pas).
  mergedInto: { id: string; addedQty: number; isCommanderBefore: boolean } | null
}

interface BulkUndoEntry {
  userId: string
  operations: BulkOperation[]
  touchedContainerIds: string[]
  expiresAt: number
}

// Jeton d'annulation en mémoire, même patron que `lib/containers/holdings.ts` :
// fenêtre de 6 secondes, singleton de process. Un second jeton actif remplace
// le précédent côté écran (empiler plusieurs undos concurrents rendrait le
// retour arrière ambigu) — ce module ne porte qu'un magasin par jeton, la
// règle du jeton unique actif vit côté composant (`UndoToast` déjà remplacé à
// chaque nouvelle action destructive).
const UNDO_TTL_MS = 6_000

declare global {
  var __spellcacheBulkUndo: Map<string, BulkUndoEntry> | undefined
}

function undoStore(): Map<string, BulkUndoEntry> {
  if (!globalThis.__spellcacheBulkUndo) {
    globalThis.__spellcacheBulkUndo = new Map()
  }
  return globalThis.__spellcacheBulkUndo
}

function storeUndo(entry: Omit<BulkUndoEntry, 'expiresAt'>): string {
  const undoToken = randomUUID()
  const expiresAt = Date.now() + UNDO_TTL_MS
  undoStore().set(undoToken, { ...entry, expiresAt })
  const timer = setTimeout(() => undoStore().delete(undoToken), UNDO_TTL_MS)
  timer.unref?.()
  return undoToken
}

// La zone rejoint la clé d'unicité (meme regle que HoldingKey) :
// `bulkEdit` fusionnait sans le voir une ligne `main` et une ligne `side` de
// la meme carte. `BulkEdit` (ci-dessous) n'expose aucun champ pour editer la
// zone, hors de son contrat : la zone cible d'une ligne editee en lot
// reste toujours sa propre zone d'origine (`row.zone`), jamais celle d'une
// autre ligne du lot.
function matchKey(
  containerId: string,
  cardId: string,
  finish: Finish,
  condition: Condition,
  language: string,
  zone: DeckZone,
) {
  return and(
    eq(holdings.containerId, containerId),
    eq(holdings.cardId, cardId),
    eq(holdings.finish, finish),
    eq(holdings.condition, condition),
    eq(holdings.language, language),
    eq(holdings.zone, zone),
  )
}

// Séparateur improbable dans un uuid/code de langue — sert uniquement de clé
// de `Map` en mémoire, jamais envoyé à la base.
const GROUP_KEY_SEP = ' '

export function bulkEditGroupKey(
  containerId: string,
  cardId: string,
  finish: Finish,
  condition: Condition,
  language: string,
  zone: DeckZone,
): string {
  return [containerId, cardId, finish, condition, language, zone].join(GROUP_KEY_SEP)
}

function splitGroupKey(
  key: string,
): [string, string, Finish, Condition, string, DeckZone] {
  const [containerId, cardId, finish, condition, language, zone] =
    key.split(GROUP_KEY_SEP)
  return [
    containerId!,
    cardId!,
    finish as Finish,
    condition as Condition,
    language!,
    zone as DeckZone,
  ]
}

export interface BulkEditPlanItem {
  survivorId: string
  containerId: string
  finish: Finish
  condition: Condition
  language: string
  // Zone effective de la ligne survivante — jamais
  // `row.zone` telle quelle : `bulkEdit` (plus bas) la retombe sur
  // `DEFAULT_ZONE` quand la destination n'est pas un deck, exactement la même
  // règle que `moveHoldings` (`lib/containers/holdings.ts`).
  zone: DeckZone
  qty: number
  isCommander: boolean
  removedIds: string[]
}

export interface BulkEditPlan {
  items: BulkEditPlanItem[]
  operations: BulkOperation[]
}

// Planifie une édition groupée — fonction pure, sans accès base (testée
// directement par `tests/unit/bulk.test.ts` sans Postgres). Évite le piège
// de l'instantané périmé : itérer sur `rows`
// — un instantané pris *avant* toute écriture — en recalculant `nextQty`
// depuis ce même instantané à chaque tour, y compris pour une ligne déjà
// devenue la cible d'une fusion lors d'un tour précédent, ferait repartir la
// seconde écriture sur cette ligne de sa quantité d'avant-lot et effacerait
// la quantité tout juste fusionnée (perte silencieuse, non déterministe
// faute d'`ORDER BY` sur la sélection).
//
// Ici, `rows` est groupé une seule fois par clé cible (container, carte,
// finish, condition, langue *après* application de `edit`) avant toute
// écriture : chaque groupe ne produit qu'une seule ligne survivante, dont la
// quantité est la somme de toutes les contributions du groupe — un ordre de
// lecture différent produit le même total, la somme étant commutative.
// `externalCollisions` (une ligne déjà en base, hors du lot édité, qui
// partage la même clé cible) est résolu par l'appelant *avant* d'appeler ce
// planificateur, une requête par clé distincte du plan plutôt qu'une par
// ligne — ce qui élimine aussi toute relecture DB en cours de boucle :
// toutes les lectures ont lieu avant toute écriture.
export function planBulkEdit(
  rows: Holding[],
  edit: BulkEdit,
  externalCollisions: ReadonlyMap<string, Holding>,
  // La zone ne distingue deux lignes que si la destination est un deck :
  // grouper sur `row.zone` quand la cible est un binder ou la racine, où la
  // zone n'a aucun sens, laisserait deux lignes pour la même carte.
  // Défaut `true` — comportement inchangé pour toute édition qui ne déplace
  // pas de container, ou qui déplace vers un autre deck (même clé qu'avant,
  // les tests de `tests/unit/bulk.test.ts` qui n'en passent pas l'attendent
  // ainsi) ; `bulkEdit` (plus bas) le fixe à `false` quand
  // `edit.targetContainerId` désigne un container dont le `kind` n'est pas
  // `deck`, pour fusionner avec la ligne déjà présente comme avant les zones.
  targetZoneMatters = true,
): BulkEditPlan {
  interface EditedRow {
    row: Holding
    qty: number
    containerId: string
    finish: Finish
    condition: Condition
    language: string
    zone: DeckZone
    key: string
  }

  const groups = new Map<string, EditedRow[]>()
  for (const row of rows) {
    const containerId = edit.targetContainerId ?? row.containerId
    const finish = edit.finish ?? row.finish
    const condition = edit.condition ?? row.condition
    const language = edit.language ?? row.language
    const qty = edit.qty ?? row.qty
    const zone = targetZoneMatters ? row.zone : DEFAULT_ZONE
    const key = bulkEditGroupKey(containerId, row.cardId, finish, condition, language, zone)
    const entry: EditedRow = { row, qty, containerId, finish, condition, language, zone, key }
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }

  const items: BulkEditPlanItem[] = []
  const operations: BulkOperation[] = []

  for (const [key, group] of groups) {
    const totalQty = group.reduce((sum, entry) => sum + entry.qty, 0)
    const anyCommander = group.some((entry) => entry.row.isCommander)
    const external = externalCollisions.get(key)

    if (external) {
      const isCommanderBefore = external.isCommander
      items.push({
        survivorId: external.id,
        containerId: external.containerId,
        finish: external.finish,
        condition: external.condition,
        language: external.language,
        zone: external.zone,
        qty: external.qty + totalQty,
        isCommander: external.isCommander || anyCommander,
        removedIds: group.map((entry) => entry.row.id),
      })
      for (const entry of group) {
        operations.push({
          before: entry.row,
          mergedInto: { id: external.id, addedQty: entry.qty, isCommanderBefore },
        })
      }
      continue
    }

    // Survivant déterministe : id le plus petit du lot — sans `ORDER BY`
    // côté SQL sur la sélection verrouillée, l'ordre de `rows` n'est pas
    // garanti.
    const sorted = [...group].sort((a, b) =>
      a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0,
    )
    const survivor = sorted[0]!
    const isCommanderBefore = survivor.row.isCommander

    items.push({
      survivorId: survivor.row.id,
      containerId: survivor.containerId,
      finish: survivor.finish,
      condition: survivor.condition,
      language: survivor.language,
      zone: survivor.zone,
      qty: totalQty,
      isCommander: anyCommander,
      removedIds: sorted.slice(1).map((entry) => entry.row.id),
    })

    for (const entry of sorted) {
      if (entry.row.id === survivor.row.id) {
        operations.push({ before: entry.row, mergedInto: null })
      } else {
        operations.push({
          before: entry.row,
          mergedInto: { id: survivor.row.id, addedQty: entry.qty, isCommanderBefore },
        })
      }
    }
  }

  return { items, operations }
}

// Applique une édition groupée : verrouille les lignes ciblées
// (`for('update')`), échoue toute la transaction si l'une d'elles a disparu
// entre la résolution de la cible et l'écriture (vérifié par
// `resolveTargetHoldingIds` ci-dessus), puis
// planifie et applique la fusion via `planBulkEdit` — une seule écriture par
// ligne survivante, jamais une réécriture en boucle qui relit son propre
// résultat (le défaut corrigé ci-dessus).
export async function bulkEdit(
  userId: string,
  target: BulkTarget,
  edit: BulkEdit,
): Promise<BulkEditResult> {
  await requireContainerAccess(userId, target.containerId, 'write')
  await assertNotDeckLocked(db, target.containerId)
  if (edit.targetContainerId) {
    await requireContainerAccess(userId, edit.targetContainerId, 'write')
    await assertNotDeckLocked(db, edit.targetContainerId)
  }

  // La zone n'a de sens que sur un deck (même règle
  // que `moveHoldings`, `lib/containers/holdings.ts`) : une édition groupée
  // qui déplace des lignes vers un binder ou la racine de collection ne doit
  // pas les distinguer par leur zone d'origine, sous peine de laisser deux
  // lignes pour la même carte là où elles fusionnaient avant les zones.
  const destinationContainer = await getContainerRow(
    db,
    edit.targetContainerId ?? target.containerId,
  )
  const targetZoneMatters = destinationContainer.kind === 'deck'

  return db.transaction(async (tx) => {
    // Périmètre réel de la cible (voir le
    // commentaire de tête de `listHoldings`, `holdings-data.ts`) : une
    // sélection groupée depuis « All collection » peut mêler des lignes de
    // la racine ET de plusieurs binders — `target.containerId` seul (l'écran
    // ouvert) ne suffit plus à borner ni la résolution de la cible, ni la
    // relecture verrouillée ci-dessous.
    const scope = await resolveContainerScope(tx, target.containerId)
    const ids = await resolveTargetHoldingIds(tx, userId, target, scope)
    if (ids.length === 0) {
      const undoToken = storeUndo({ userId, operations: [], touchedContainerIds: [] })
      return { affected: 0, undoToken }
    }

    const rows = await tx
      .select()
      .from(holdings)
      .where(and(inArray(holdings.id, ids), inArray(holdings.containerId, scope)))
      .for('update')

    if (rows.length !== ids.length) {
      throw new Error('Selection changed before the bulk edit could be applied.')
    }

    // Résout les collisions externes (une ligne déjà en base à la clé
    // cible, hors du lot édité) — une requête par clé distincte, avant toute
    // écriture (voir le commentaire de `planBulkEdit`).
    const keys = new Set<string>()
    for (const row of rows) {
      const containerId = edit.targetContainerId ?? row.containerId
      const finish = edit.finish ?? row.finish
      const condition = edit.condition ?? row.condition
      const language = edit.language ?? row.language
      const zone = targetZoneMatters ? row.zone : DEFAULT_ZONE
      keys.add(bulkEditGroupKey(containerId, row.cardId, finish, condition, language, zone))
    }

    const externalCollisions = new Map<string, Holding>()
    for (const key of keys) {
      const [containerId, cardId, finish, condition, language, zone] = splitGroupKey(key)
      const [collision] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            matchKey(containerId, cardId, finish, condition, language, zone),
            notInArray(holdings.id, ids),
          ),
        )
        .for('update')
        .limit(1)
      if (collision) externalCollisions.set(key, collision)
    }

    const plan = planBulkEdit(rows, edit, externalCollisions, targetZoneMatters)

    const touchedContainerIds = new Set<string>([target.containerId])
    for (const item of plan.items) {
      await tx
        .update(holdings)
        .set({
          containerId: item.containerId,
          finish: item.finish,
          condition: item.condition,
          language: item.language,
          zone: item.zone,
          qty: item.qty,
          isCommander: item.isCommander,
        })
        .where(eq(holdings.id, item.survivorId))
      if (item.removedIds.length > 0) {
        await tx.delete(holdings).where(inArray(holdings.id, item.removedIds))
      }
      touchedContainerIds.add(item.containerId)
    }

    for (const containerId of touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    const undoToken = storeUndo({
      userId,
      operations: plan.operations,
      touchedContainerIds: [...touchedContainerIds],
    })
    return { affected: rows.length, undoToken }
  })
}

// Supprime la sélection en une transaction (chaque suppression passe par
// bulkDelete avec jeton d'annulation, jamais un DELETE direct), même
// verrou/échec-tout-ou-rien que `bulkEdit` ci-dessus.
export async function bulkDelete(
  userId: string,
  target: BulkTarget,
): Promise<BulkDeleteResult> {
  await requireContainerAccess(userId, target.containerId, 'write')
  await assertNotDeckLocked(db, target.containerId)

  return db.transaction(async (tx) => {
    // Même périmètre élargi que `bulkEdit` ci-dessus — voir son commentaire.
    const scope = await resolveContainerScope(tx, target.containerId)
    const ids = await resolveTargetHoldingIds(tx, userId, target, scope)
    if (ids.length === 0) {
      const undoToken = storeUndo({ userId, operations: [], touchedContainerIds: [] })
      return { affected: 0, undoToken }
    }

    const rows = await tx
      .select()
      .from(holdings)
      .where(and(inArray(holdings.id, ids), inArray(holdings.containerId, scope)))
      .for('update')

    if (rows.length !== ids.length) {
      throw new Error('Selection changed before the bulk delete could be applied.')
    }

    await tx.delete(holdings).where(inArray(holdings.id, ids))

    // Recalcule chaque container RÉELLEMENT touché : `target.containerId`
    // seul ne suffit pas, car une suppression groupée depuis « All
    // collection » peut retirer des lignes de
    // plusieurs binders à la fois — chacun doit recalculer sa propre
    // `container_stats`, pas seulement la racine.
    const touchedContainerIds = new Set(rows.map((row) => row.containerId))
    touchedContainerIds.add(target.containerId)
    for (const containerId of touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }

    const operations: BulkOperation[] = rows.map((row) => ({
      before: row,
      mergedInto: null,
    }))
    const undoToken = storeUndo({
      userId,
      operations,
      touchedContainerIds: [...touchedContainerIds],
    })

    return { affected: rows.length, undoToken }
  })
}

// Rejoue un `undoToken` retourné par `bulkEdit`/`bulkDelete` : déroule les
// opérations en ordre inverse (une fusion
// annulée redonne d'abord sa quantité à la ligne d'accueil, avant de
// réinsérer la ligne d'origine), à l'identique — mêmes `qty`, `finish`,
// `condition`, `added_at` (même contrat que `restoreHoldings`).
export async function bulkUndo(
  userId: string,
  undoToken: string,
): Promise<BulkUndoResult> {
  const entry = undoStore().get(undoToken)
  if (!entry || entry.expiresAt < Date.now()) {
    undoStore().delete(undoToken)
    return { restored: 0, expired: true }
  }
  if (entry.userId !== userId) {
    throw new Error(`Undo token ${undoToken} does not belong to user ${userId}.`)
  }

  // Verrou `built` (même vérification que les trois autres voies d'écriture :
  // `bulkEdit`, `bulkDelete`, `restoreHoldings`). Un deck peut devenir `built`
  // entre l'action groupée d'origine et son annulation dans la fenêtre de 6 secondes
  // (supprimer une ligne d'un deck `assemble`, l'assembler, annuler) —
  // rejouer l'opération réinsérerait alors une ligne dans un deck verrouillé,
  // exactement le trou que `assertNotDeckLocked` referme ailleurs.
  for (const containerId of entry.touchedContainerIds) {
    await assertNotDeckLocked(db, containerId)
  }

  await db.transaction(async (tx) => {
    for (const op of [...entry.operations].reverse()) {
      if (op.mergedInto) {
        // Restaure aussi `isCommander` à son état d'avant fusion : sans ce
        // champ, une ligne d'accueil qui
        // n'était pas commandant avant la fusion resterait marquée commandant
        // après `bulkUndo`, `qty` seul ne suffisant pas à
        // une restauration « à l'identique ».
        await tx
          .update(holdings)
          .set({
            qty: sql`${holdings.qty} - ${op.mergedInto.addedQty}`,
            isCommander: op.mergedInto.isCommanderBefore,
          })
          .where(eq(holdings.id, op.mergedInto.id))
      }
      await tx.delete(holdings).where(eq(holdings.id, op.before.id))
      await tx.insert(holdings).values(op.before)
    }

    for (const containerId of entry.touchedContainerIds) {
      await recomputeContainerStats(containerId, tx)
    }
  })

  undoStore().delete(undoToken)
  return { restored: entry.operations.length, expired: false }
}
