// Test d'intégration : résolution (`planAssembly`) et exécution
// (`assembleDeck`/`dismantleDeck`) — emprunts à un autre deck monté,
// réservation, assemblage partiel, démontage transactionnel. Contre la base
// éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ; se
// saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible), même garde que `tests/integration/holdings.test.ts`.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('planAssembly / assembleDeck / dismantleDeck', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let containers: typeof import('@spellcache/db/schema').containers
  let holdings: typeof import('@spellcache/db/schema').holdings
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let planAssembly: typeof import('@/lib/decks/assemble').planAssembly
  let assembleDeck: typeof import('@/lib/decks/assemble').assembleDeck
  let dismantleDeck: typeof import('@/lib/decks/assemble').dismantleDeck
  let getDeck: typeof import('@/app/(app)/decks/[id]/deck-data').getDeck
  let InvalidTransitionError: typeof import('@/lib/decks/lifecycle').InvalidTransitionError

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, containers, holdings } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ getDeck } = await import('@/app/(app)/decks/[id]/deck-data'))
    ;({ planAssembly, assembleDeck, dismantleDeck } = await import('@/lib/decks/assemble'))
    ;({ InvalidTransitionError } = await import('@/lib/decks/lifecycle'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(
      'TRUNCATE holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE',
    )
  })

  async function createUser(username: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    return row!.id
  }

  async function insertCard(id: string, name: string, priceUsd?: number): Promise<void> {
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('asm', 'Assemble set', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $2, $3, 'asm', $1::text, 'common', 1, 'Creature', '{}', '{}', '{nonfoil}', '{}'::jsonb)`,
      [id, randomUUID(), name],
    )
    if (priceUsd !== undefined) {
      await pool.query(
        `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
         VALUES ($1, current_date, $2, null, $2, null)`,
        [id, priceUsd.toFixed(2)],
      )
    }
  }

  async function setDeckState(deckId: string, state: string): Promise<void> {
    await db.update(containers).set({ deckState: state as never }).where(eq(containers.id, deckId))
  }

  it('classifies missing vs borrowed depending on fromOtherBuiltDecks', async () => {
    const userId = await createUser('borrower')
    const { collectionId } = await bootstrapCollection(userId, { username: 'borrower', displayName: null })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring', 3.2)

    const sourceDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Source deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: sourceDeck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    await setDeckState(sourceDeck.id, 'built')

    const targetDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Target deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: targetDeck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const withoutBorrow = await planAssembly(userId, targetDeck.id, {
      fromLooseCollection: true,
      fromOtherBuiltDecks: false,
    })
    expect(withoutBorrow.missing).toHaveLength(1)
    expect(withoutBorrow.borrowed).toHaveLength(0)
    expect(withoutBorrow.owned).toHaveLength(0)

    const withBorrow = await planAssembly(userId, targetDeck.id, {
      fromLooseCollection: true,
      fromOtherBuiltDecks: true,
    })
    expect(withBorrow.missing).toHaveLength(0)
    expect(withBorrow.borrowed).toHaveLength(1)
    expect(withBorrow.borrowed[0]?.fromDeckId).toBe(sourceDeck.id)
    expect(withBorrow.borrowed[0]?.fromDeckName).toBe('Source deck')
  })

  // Régression : `planAssembly` calculait auparavant sa propre somme de stock hors-deck
  // (`loadCardAvailability`/`looseQty`), qui ne savait rien des
  // réclamations d'un AUTRE deck déjà monté — une carte possédée une seule
  // fois et déjà sleevée dans un deck A passait `owned` pour un deck B, qui
  // pouvait la réclamer aussi. Ce test possède réellement la carte à la
  // racine (contrairement au test ci-dessus, où elle n'existe que dans le
  // deck source) : c'est exactement le scénario que la somme ad hoc
  // manquait.
  it('never classifies a copy already claimed by another built deck as owned', async () => {
    const userId = await createUser('doubleclaim')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'doubleclaim',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring', 3.2)
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deckA = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Deck A',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deckA.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    const planA = await planAssembly(userId, deckA.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(planA.owned).toHaveLength(1)
    await assembleDeck(userId, deckA.id, { plan: planA })

    const deckB = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Deck B',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deckB.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const planB = await planAssembly(userId, deckB.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(planB.owned).toHaveLength(0)
    expect(planB.missing).toHaveLength(1)
  })

  // Régression (`ownedElsewhere` unifié sur `availableQtyExpr` sans son
  // exclusion) : une carte
  // possédée en un seul exemplaire, sleevée dans CE deck une fois `built`,
  // ne doit jamais s'afficher `missing` sur sa PROPRE ligne — la formule ne
  // doit pas soustraire la réclamation du deck qui consulte sa propre
  // liste.
  it('a built deck never sees its own claimed copy as missing on its own screen', async () => {
    const userId = await createUser('selfclaim')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'selfclaim',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring', 2)
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Self-claim deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    await assembleDeck(userId, deck.id, { plan })

    const built = await getDeck(userId, deck.id)
    const slot = built.slots.find((s) => s.cardId === cardId)
    expect(slot?.state).toBe('owned')
    expect(slot?.ownedElsewhere).toBeGreaterThanOrEqual(1)
  })

  it('assembles a partial deck: reserved reflects owned+borrowed+acquired, stillMissing the rest', async () => {
    const userId = await createUser('partial')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'partial',
      displayName: null,
    })

    const ownedCardId = randomUUID()
    await insertCard(ownedCardId, 'Doubling Season')
    await addHolding(userId, { containerId: rootId, cardId: ownedCardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const missingCardId = randomUUID()
    await insertCard(missingCardId, 'Wrath of God', 8.9)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Partial deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId: ownedCardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
    const { holdingId: missingHoldingId } = await addHolding(
      userId,
      { containerId: deck.id, cardId: missingCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.owned).toHaveLength(1)
    expect(plan.missing).toHaveLength(1)
    expect(plan.toBuyMinor).toBe(890)

    const result = await assembleDeck(userId, deck.id, { plan })
    expect(result).toEqual({ deckState: 'built', reserved: 1, stillMissing: 1 })

    const [deckRow] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(deckRow?.deckState).toBe('built')

    // Le holding manquant n'a pas bougé : ni supprimé, ni transformé.
    const [stillThere] = await db.select().from(holdings).where(eq(holdings.id, missingHoldingId)).limit(1)
    expect(stillThere?.qty).toBe(1)
  })

  it('checking a missing card adds physical stock to the collection root without touching the deck row', async () => {
    const userId = await createUser('acquirer')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'acquirer',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Cultivate', 0.9)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Acquirer deck',
      format: 'commander',
      deckState: 'plan',
    })
    const { holdingId } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      2,
    )

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.missing).toHaveLength(1)

    const result = await assembleDeck(userId, deck.id, { plan, acquiredHoldingIds: [holdingId] })
    // `reserved`/`stillMissing` comptent des exemplaires, pas des lignes
    // (`4× Mountain` vaut 4 réservées, pas 1) — cette carte a `need = 2`, donc `reserved`
    // vaut 2, pas le nombre de lignes acquises (1).
    expect(result).toEqual({ deckState: 'built', reserved: 2, stillMissing: 0 })

    const [rootHolding] = await db
      .select()
      .from(holdings)
      .where(eq(holdings.containerId, rootId))
      .limit(1)
    expect(rootHolding?.cardId).toBe(cardId)
    expect(rootHolding?.qty).toBe(2)

    const [deckHolding] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1)
    expect(deckHolding?.qty).toBe(2)
  })

  // Régression : `planAssembly` facturait auparavant le besoin ENTIER d'une carte
  // partiellement possédée, et `assembleDeck` matérialisait ce même montant
  // entier à l'achat — une carte déjà possédée à moitié se retrouvait donc
  // dupliquée à la racine dès que l'utilisateur cochait « je l'ai achetée ».
  it('a partially-owned missing card only charges and buys the real deficit, never the whole need', async () => {
    const userId = await createUser('partialdeficit')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'partialdeficit',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Demonic Tutor', 20)
    // Un seul exemplaire déjà possédé, hors du deck.
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Partial deficit deck',
      format: 'commander',
      deckState: 'plan',
    })
    // Le deck en veut 2 : disponible (1) < besoin (2), donc `fromLooseCollection`
    // ne le classe pas `owned` — il tombe en `missing`, mais le déficit réel
    // n'est que d'UN exemplaire, pas deux.
    const { holdingId } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      2,
    )

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.missing).toHaveLength(1)
    // 1 exemplaire manquant à 20 (unité en minor = 2000), pas 2 (4000) —
    // même montant que `computeCoverage` (`deck-data.ts`) afficherait
    // sur l'écran Planning pour cette même carte.
    expect(plan.toBuyMinor).toBe(2000)

    const result = await assembleDeck(userId, deck.id, { plan, acquiredHoldingIds: [holdingId] })
    expect(result).toEqual({ deckState: 'built', reserved: 2, stillMissing: 0 })

    // La racine ne gagne qu'UN exemplaire neuf (le déficit réel) — jamais
    // deux, ce qui aurait dupliqué la copie déjà possédée en plus de la
    // neuve.
    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(1)
    expect(rootHoldings[0]?.qty).toBe(2)
  })

  it('borrowing reduces the source deck holding and can empty it entirely', async () => {
    const userId = await createUser('reallocator')
    const { collectionId } = await bootstrapCollection(userId, { username: 'reallocator', displayName: null })

    const cardId = randomUUID()
    await insertCard(cardId, 'Rhystic Study')

    const sourceDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Donor deck',
      format: 'commander',
      deckState: 'plan',
    })
    const { holdingId: sourceHoldingId } = await addHolding(
      userId,
      { containerId: sourceDeck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    await setDeckState(sourceDeck.id, 'built')

    const targetDeck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Recipient deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: targetDeck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const plan = await planAssembly(userId, targetDeck.id, {
      fromLooseCollection: true,
      fromOtherBuiltDecks: true,
    })
    expect(plan.borrowed).toHaveLength(1)

    await assembleDeck(userId, targetDeck.id, { plan })

    const [sourceRow] = await db.select().from(holdings).where(eq(holdings.id, sourceHoldingId)).limit(1)
    expect(sourceRow).toBeUndefined()
  })

  it('refuses to assemble a dismantled deck without touching the database', async () => {
    const userId = await createUser('blocked')
    const { collectionId } = await bootstrapCollection(userId, { username: 'blocked', displayName: null })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Dismantled deck',
      format: 'modern',
      deckState: 'dismantled',
    })

    const emptyPlan = { owned: [], missing: [], borrowed: [], toBuyMinor: 0 }
    await expect(assembleDeck(userId, deck.id, { plan: emptyPlan })).rejects.toThrow(InvalidTransitionError)

    const [row] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(row?.deckState).toBe('dismantled')
  })

  // Régression : un deck forcé `deck_state = 'built'` par une écriture
  // directe (`setDeckState`, contournant `assembleDeck`), sans AUCUN stock
  // physique nulle part, ne doit pas faire apparaître d'exemplaire dans le
  // binder au démontage — un deck construit à moitié ferait sinon sortir
  // des cartes jamais achetées de nulle part. Les deux tests ci-dessous
  // prouvent le comportement cohérent (un holding appartient au deck ou à la
  // collection, jamais aux deux) : ce que le
  // démontage rend au binder est exactement ce qui était réellement adossé
  // à du stock physique, ni plus, ni moins — jamais recalculé depuis un
  // `AssemblePlan` figé, mais depuis l'état réel de la collection au moment
  // du démontage (voir le commentaire de `dismantleDeck`).
  it('dismantle transfers exactly the physically-backed quantity, without duplicating it', async () => {
    const userId = await createUser('dismantletransfer')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'dismantletransfer',
      displayName: null,
    })

    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vault' })

    const cardId = randomUUID()
    await insertCard(cardId, 'The Ur-Dragon')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Ur-Dragon Tribal',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.owned).toHaveLength(1)
    await assembleDeck(userId, deck.id, { plan })

    const result = await dismantleDeck(userId, deck.id, binder.id)
    expect(result.returned).toBe(1)

    // Le deck n'a plus de ligne pour cette carte (entièrement adossée, donc
    // entièrement transférée) ; la racine, dont le stock a réellement fourni
    // la réservation, est décrémentée d'autant — jamais laissée intacte
    // (ce qui doublerait le total).
    const deckHoldings = await db.select().from(holdings).where(eq(holdings.containerId, deck.id))
    expect(deckHoldings).toHaveLength(0)

    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(0)

    const binderHoldings = await db.select().from(holdings).where(eq(holdings.containerId, binder.id))
    expect(binderHoldings).toHaveLength(1)
    expect(binderHoldings[0]?.cardId).toBe(cardId)
    expect(binderHoldings[0]?.qty).toBe(1)
    expect(binderHoldings[0]?.zone).toBe('main')

    const [deckRow] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(deckRow?.deckState).toBe('dismantled')
  })

  it('dismantle carries the physically-consumed copy’s own identity, never the deck row’s declared finish/condition/language', async () => {
    const userId = await createUser('identitycarry')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'identitycarry',
      displayName: null,
    })

    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vault' })

    const cardId = randomUUID()
    await insertCard(cardId, 'Rhystic Study')
    // Le stock RÉEL est foil / LP / français.
    await addHolding(userId, { containerId: rootId, cardId, finish: 'foil', condition: 'lp', language: 'fr' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Identity deck',
      format: 'commander',
      deckState: 'plan',
    })
    // La ligne de besoin du deck, elle, est nonfoil / NM / anglais — les
    // valeurs par défaut du builder (`availabilityMap` est agnostique de la finition, une copie foil peut
    // donc adosser une déclaration nonfoil).
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.owned).toHaveLength(1)
    await assembleDeck(userId, deck.id, { plan })

    const result = await dismantleDeck(userId, deck.id, binder.id)
    expect(result.returned).toBe(1)

    // Le binder reçoit l'exemplaire tel qu'il existait réellement — jamais
    // réécrit avec l'identité de la ligne de deck qui le réclamait, ce qui
    // aurait détruit le holding foil/LP/fr d'origine et fait renaître une
    // copie nonfoil/NM/en depuis rien.
    const binderHoldings = await db.select().from(holdings).where(eq(holdings.containerId, binder.id))
    expect(binderHoldings).toHaveLength(1)
    expect(binderHoldings[0]).toMatchObject({ cardId, finish: 'foil', condition: 'lp', language: 'fr', qty: 1 })

    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(0)
  })

  it('dismantle excludes the target container from the settlement pool across multiple deck lines for the same card', async () => {
    const userId = await createUser('multirow')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'multirow',
      displayName: null,
    })

    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vault' })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring')
    // Un seul exemplaire réel dans toute la collection.
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Two lines deck',
      format: 'commander',
      deckState: 'plan',
    })
    // Deux lignes de deck pour la MÊME carte, sous deux finitions
    // différentes (clé d'unicité distincte) : main + une
    // seconde finition. `assembleDeck` n'est
    // volontairement pas appelé ici (le modèle déclaratif n'a besoin
    // d'aucun stock physique bougé pour passer `built` — voir l'en-tête de
    // fichier) ; le deck est forcé `built` directement, comme
    // `dismantlephantom` ci-dessus.
    const { holdingId: line1 } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    const { holdingId: line2 } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'foil', condition: 'nm', language: 'en' },
      1,
    )
    await setDeckState(deck.id, 'built')

    const result = await dismantleDeck(userId, deck.id, binder.id)

    // Un seul exemplaire réel existait : `returned` ne peut jamais compter 2
    // en relisant, pour la seconde ligne, la copie que la première vient de
    // déposer dans le binder cible.
    expect(result.returned).toBe(1)

    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(0)

    const binderHoldings = await db.select().from(holdings).where(eq(holdings.containerId, binder.id))
    expect(binderHoldings).toHaveLength(1)
    // L'identité déposée dans le binder est celle de l'exemplaire RÉEL
    // consommé (nonfoil, la seule copie physique qui existait) — jamais
    // celle de la ligne de deck qui a déclenché la consommation, que ce
    // soit la ligne nonfoil ou la ligne foil (`decrementLooseStock` ne
    // filtre pas sa source par finition, l'ordre exact des deux
    // lignes du deck n'est donc pas garanti par ce test).
    expect(binderHoldings[0]).toMatchObject({ cardId, finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 })

    // La ligne réellement adossée disparaît ; l'AUTRE, jamais couverte par
    // du stock réel (un seul exemplaire existait pour deux lignes), SURVIT
    // comme déclaration de besoin — exactement ce que le modèle déclaratif
    // promet de ne jamais perdre, plutôt que d'être supprimée à tort comme
    // si elle aussi avait été transférée. Laquelle des deux lignes survit
    // dépend de `orderBy(holdings.id)` (déterministe mais indépendant de
    // l'ordre d'insertion) — ce test ne fixe donc pas laquelle,
    // seulement qu'EXACTEMENT une des deux survit avec sa qty intacte.
    const [line1Row] = await db.select().from(holdings).where(eq(holdings.id, line1))
    const [line2Row] = await db.select().from(holdings).where(eq(holdings.id, line2))
    const survivors = [line1Row, line2Row].filter((row) => row !== undefined)
    expect(survivors).toHaveLength(1)
    expect(survivors[0]?.containerId).toBe(deck.id)
    expect(survivors[0]?.qty).toBe(1)
  })

  // Régression : `listDismantleTargetsAction` renvoie la racine en
  // premier et la feuille la présélectionne (« Loose collection ») — c'est
  // le chemin PAR DÉFAUT, pas un cas limite. Exclure entièrement
  // `targetBinderId` du pool source vidait ce pool dès que la cible ÉTAIT le container qui détenait déjà le stock adossant : `taken`
  // tombait à 0, rien n'était écrit, et la ligne du deck survivait intacte
  // pendant que `deck_state` basculait quand même à `'dismantled'`.
  it('dismantle into the root container that already holds the backing stock still settles the claim', async () => {
    const userId = await createUser('rootdestination')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'rootdestination',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Command Tower')
    // Le seul exemplaire réel vit déjà dans la racine — exactement la
    // destination par défaut de la feuille de démontage.
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Root target deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const plan = await planAssembly(userId, deck.id, { fromLooseCollection: true, fromOtherBuiltDecks: false })
    expect(plan.owned).toHaveLength(1)
    await assembleDeck(userId, deck.id, { plan })

    // Démonte vers la racine ELLE-MÊME — la destination qui détient déjà le
    // stock adossant.
    const result = await dismantleDeck(userId, deck.id, rootId)
    expect(result.returned).toBe(1)

    const deckHoldings = await db.select().from(holdings).where(eq(holdings.containerId, deck.id))
    expect(deckHoldings).toHaveLength(0)

    // La racine garde exactement 1 exemplaire — ni 0 (le bug corrigé : rien
    // n'aurait bougé, le deck restant intact) ni 2 (une duplication).
    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(1)
    expect(rootHoldings[0]).toMatchObject({ cardId, finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 })

    const [deckRow] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(deckRow?.deckState).toBe('dismantled')
  })

  // Combine le destination-racine ci-dessus avec le scénario à deux lignes
  // du test « excludes the target container » plus haut : prouve que corriger l'exclusion du
  // container cible n'a pas rouvert le double-comptage qu'elle fermait —
  // un seul exemplaire réel ne peut toujours pas régler deux lignes.
  it('dismantle into the root that backs only one of two deck lines for the same card settles exactly one, never two', async () => {
    const userId = await createUser('rootmultirow')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'rootmultirow',
      displayName: null,
    })

    const cardId = randomUUID()
    await insertCard(cardId, 'Sol Ring')
    // Un seul exemplaire réel dans toute la collection, déjà dans la racine.
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Two lines, root target',
      format: 'commander',
      deckState: 'plan',
    })
    const { holdingId: line1 } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    const { holdingId: line2 } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'foil', condition: 'nm', language: 'en' },
      1,
    )
    await setDeckState(deck.id, 'built')

    const result = await dismantleDeck(userId, deck.id, rootId)
    expect(result.returned).toBe(1)

    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(1)
    expect(rootHoldings[0]).toMatchObject({ cardId, finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 })

    const [line1Row] = await db.select().from(holdings).where(eq(holdings.id, line1))
    const [line2Row] = await db.select().from(holdings).where(eq(holdings.id, line2))
    const survivors = [line1Row, line2Row].filter((row) => row !== undefined)
    expect(survivors).toHaveLength(1)
    expect(survivors[0]?.containerId).toBe(deck.id)
    expect(survivors[0]?.qty).toBe(1)
  })

  // Le pendant « binder » du test racine ci-dessus : la destination détient
  // DÉJÀ une partie du stock adossant (2 en racine + 2 en Vault, démontage
  // vers Vault : `returned` doit valoir 4, pas 2). La cible n'est pas exclue
  // de son propre pool : ses 2 exemplaires
  // pré-existants comptent, en plus des 2 de la racine.
  it('dismantle into a binder that already holds part of the backing stock settles the full quantity', async () => {
    const userId = await createUser('partialtarget')
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username: 'partialtarget',
      displayName: null,
    })

    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vault' })

    const cardId = randomUUID()
    await insertCard(cardId, 'Arcane Signet')
    await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)
    await addHolding(userId, { containerId: binder.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 2)

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Partial target deck',
      format: 'commander',
      deckState: 'plan',
    })
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 4)
    await setDeckState(deck.id, 'built')

    const result = await dismantleDeck(userId, deck.id, binder.id)
    expect(result.returned).toBe(4)

    const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
    expect(rootHoldings).toHaveLength(0)

    const binderHoldings = await db.select().from(holdings).where(eq(holdings.containerId, binder.id))
    expect(binderHoldings).toHaveLength(1)
    expect(binderHoldings[0]).toMatchObject({ cardId, finish: 'nonfoil', condition: 'nm', language: 'en', qty: 4 })

    const deckHoldings = await db.select().from(holdings).where(eq(holdings.containerId, deck.id))
    expect(deckHoldings).toHaveLength(0)
  })

  it('dismantle never materializes stock for a claim that was never backed', async () => {
    const userId = await createUser('dismantlephantom')
    const { collectionId } = await bootstrapCollection(userId, {
      username: 'dismantlephantom',
      displayName: null,
    })

    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Vault' })

    const cardId = randomUUID()
    await insertCard(cardId, 'Never Bought')
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Half-built deck',
      format: 'commander',
      deckState: 'plan',
    })
    const { holdingId } = await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    // Aucun stock physique nulle part dans la collection, et
    // `deck_state = 'built'` forcé directement sans passer par `assembleDeck` (un deck monté
    // à moitié en base, est précisément le
    // cas que `dismantleDeck` doit rester capable de démonter proprement).
    await setDeckState(deck.id, 'built')

    const result = await dismantleDeck(userId, deck.id, binder.id)
    expect(result.returned).toBe(0)

    const binderHoldings = await db.select().from(holdings).where(eq(holdings.containerId, binder.id))
    expect(binderHoldings).toHaveLength(0)

    // La ligne reste attachée au deck, désormais `dismantled` (non
    // réservante) — la déclaration de besoin survit, visible pour
    // `restartDeck` (repartir du même contenu).
    const [deckHolding] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1)
    expect(deckHolding?.qty).toBe(1)
    expect(deckHolding?.containerId).toBe(deck.id)
  })

  it('refuses to dismantle into a binder from another collection before any write', async () => {
    const ownerId = await createUser('ownerdismantle')
    const { collectionId } = await bootstrapCollection(ownerId, { username: 'ownerdismantle', displayName: null })
    const deck = await createContainer(ownerId, collectionId, {
      kind: 'deck',
      name: 'Locked deck',
      format: 'modern',
      deckState: 'plan',
    })
    await setDeckState(deck.id, 'built')

    const otherId = await createUser('otherdismantle')
    const { containerId: otherRootId } = await bootstrapCollection(otherId, {
      username: 'otherdismantle',
      displayName: null,
    })

    await expect(dismantleDeck(ownerId, deck.id, otherRootId)).rejects.toThrow()

    const [deckRow] = await db.select().from(containers).where(eq(containers.id, deck.id)).limit(1)
    expect(deckRow?.deckState).toBe('built')
  })
})
