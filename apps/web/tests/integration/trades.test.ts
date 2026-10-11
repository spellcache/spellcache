// Test d'intégration de l'outil Trading mode : échange en personne (et son
// annulation), échange entre deux comptes à double acceptation, révisions
// périmées, quantités devenues insuffisantes, et cloisonnement des
// collections. Contre la base éphémère `postgres-test` ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Trades', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let schema: typeof import('@spellcache/db/schema')
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let trades: typeof import('@/lib/trades/trades')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    schema = await import('@spellcache/db/schema')
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    trades = await import('@/lib/trades/trades')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    await pool.query(
      'TRUNCATE trade_lines, trades, holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE',
    )
  })

  async function createAccount(
    username: string,
    opts: { trading?: boolean; priceSource?: 'cardmarket_eur' | 'tcgplayer_usd' } = {},
  ): Promise<{ userId: string; collectionId: string; rootId: string }> {
    const [row] = await db
      .insert(schema.users)
      .values({
        email: `${username}@example.com`,
        username,
        toolTradingMode: opts.trading ?? true,
        priceSource: opts.priceSource ?? 'cardmarket_eur',
      })
      .returning({ id: schema.users.id })
    const { collectionId, containerId } = await bootstrapCollection(row!.id, {
      username,
      displayName: null,
    })
    return { userId: row!.id, collectionId, rootId: containerId }
  }

  async function createBinder(collectionId: string, name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO containers (collection_id, kind, name) VALUES ($1, 'binder', $2) RETURNING id`,
      [collectionId, name],
    )
    return rows[0]!.id
  }

  async function insertCard(
    name: string,
    prices: { eur?: number; eurFoil?: number; usd?: number } = {},
  ) {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('tst', 'Test', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, 'tst', '1', 'rare', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')`,
      [id, randomUUID(), name],
    )
    await pool.query(
      `INSERT INTO card_prices (card_id, day, usd, eur, eur_foil) VALUES ($1, current_date, $2, $3, $4)`,
      [id, prices.usd ?? null, prices.eur ?? null, prices.eurFoil ?? null],
    )
    return id
  }

  async function holdingsOf(containerId: string) {
    const { rows } = await pool.query<{
      id: string
      card_id: string
      qty: number
      finish: string
    }>(
      'SELECT id, card_id, qty, finish FROM holdings WHERE container_id = $1 ORDER BY card_id',
      [containerId],
    )
    return rows
  }

  async function cardCountOf(containerId: string): Promise<number> {
    const { rows } = await pool.query<{ card_count: number }>(
      'SELECT card_count FROM container_stats WHERE container_id = $1',
      [containerId],
    )
    return rows[0]?.card_count ?? 0
  }

  async function expectTradeError(
    promise: Promise<unknown>,
    code: string,
  ): Promise<void> {
    await expect(promise).rejects.toMatchObject({ code })
  }

  describe('in person', () => {
    it('removes what is given, adds what is received, freezes prices, and undoes', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3, eurFoil: 10 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        4,
      )

      const { tradeId } = await trades.createTrade(me.userId, {
        counterpartyName: 'Bob at the LGS',
      })
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 3)
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: sol,
        finish: 'foil',
        condition: 'lp',
        language: 'en',
        qty: 1,
      })

      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.mode).toBe('in_person')
      expect(view.partnerName).toBe('Bob at the LGS')
      expect(view.give.lines).toHaveLength(1)
      expect(view.give.lines[0]).toMatchObject({
        qty: 3,
        marketPriceMinor: 200,
        maxQty: 4,
        sourceName: expect.any(String),
      })
      expect(view.get.lines[0]).toMatchObject({
        qty: 1,
        marketPriceMinor: 1000,
        finish: 'foil',
      })

      const { undoToken } = await trades.completeInPerson(
        me.userId,
        tradeId,
        view.revision,
      )

      const after = await holdingsOf(me.rootId)
      expect(after.find((row) => row.card_id === bolt)?.qty).toBe(1)
      expect(after.find((row) => row.card_id === sol)).toMatchObject({
        qty: 1,
        finish: 'foil',
      })
      expect(await cardCountOf(me.rootId)).toBe(2)

      // Les prix bougent, l'historique non.
      await pool.query(`UPDATE card_prices SET eur = 50 WHERE card_id = $1`, [bolt])
      const done = await trades.getTradeView(me.userId, tradeId)
      expect(done.status).toBe('completed')
      expect(done.give.lines[0]!.marketPriceMinor).toBe(200)

      await trades.undoInPerson(me.userId, undoToken!)
      const restored = await holdingsOf(me.rootId)
      expect(restored).toHaveLength(1)
      expect(restored[0]).toMatchObject({ id: holdingId, qty: 4 })
      expect(await cardCountOf(me.rootId)).toBe(4)
      const reopened = await trades.getTradeView(me.userId, tradeId)
      expect(reopened.status).toBe('open')
      expect(reopened.give.lines[0]!.maxQty).toBe(4)
    })

    it('restores a holding that the trade emptied', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        2,
      )
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 2)
      const { revision } = await trades.getTradeView(me.userId, tradeId)

      const { undoToken } = await trades.completeInPerson(me.userId, tradeId, revision)
      expect(await holdingsOf(me.rootId)).toHaveLength(0)

      await trades.undoInPerson(me.userId, undoToken!)
      expect(await holdingsOf(me.rootId)).toEqual([
        expect.objectContaining({ id: holdingId, qty: 2 }),
      ])
      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.give.lines[0]!.maxQty).toBe(2)

      // Le jeton ne sert qu'une fois ; un jeton inconnu ou expiré refuse.
      await expectTradeError(trades.undoInPerson(me.userId, undoToken!), 'expired')
    })

    it('refuses to undo once a received card left the collection', async () => {
      const me = await createAccount('alice')
      const sol = await insertCard('Sol Ring', { eur: 3 })
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: sol,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 1,
      })
      const { revision } = await trades.getTradeView(me.userId, tradeId)
      const { undoToken } = await trades.completeInPerson(me.userId, tradeId, revision)

      // Rangée dans une liste entre-temps : elle n'est plus en jeu.
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name) VALUES ($1, 'list', 'Wants') RETURNING id`,
        [me.collectionId],
      )
      await pool.query('UPDATE holdings SET container_id = $1 WHERE card_id = $2', [
        rows[0]!.id,
        sol,
      ])

      await expectTradeError(trades.undoInPerson(me.userId, undoToken!), 'unavailable')
      expect((await trades.getTradeView(me.userId, tradeId)).status).toBe('completed')
    })

    it('lists open trades first, whatever the history', async () => {
      const me = await createAccount('alice')
      const first = await trades.createTrade(me.userId, {})
      const second = await trades.createTrade(me.userId, {})
      await trades.cancelTrade(me.userId, first.tradeId)

      const list = await trades.listTrades(me.userId)
      expect(list.map((trade) => trade.id)).toEqual([second.tradeId, first.tradeId])
    })

    it('refuses a revision the screen did not show', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const { tradeId } = await trades.createTrade(me.userId, {})
      const { revision } = await trades.getTradeView(me.userId, tradeId)
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: bolt,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 1,
      })
      await expectTradeError(
        trades.completeInPerson(me.userId, tradeId, revision),
        'stale',
      )
    })

    it('rolls everything back when a given holding no longer has enough copies', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        3,
      )
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 3)
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: sol,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 1,
      })
      await pool.query('UPDATE holdings SET qty = 1 WHERE id = $1', [holdingId])
      const { revision } = await trades.getTradeView(me.userId, tradeId)

      await expectTradeError(
        trades.completeInPerson(me.userId, tradeId, revision),
        'unavailable',
      )
      expect(await holdingsOf(me.rootId)).toEqual([
        expect.objectContaining({ id: holdingId, qty: 1 }),
      ])
      expect((await trades.getTradeView(me.userId, tradeId)).status).toBe('open')
    })

    it('caps a line at the copies owned and rejects lists', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        2,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name) VALUES ($1, 'list', 'Wants') RETURNING id`,
        [me.collectionId],
      )
      const listHolding = await addHolding(
        me.userId,
        {
          containerId: rows[0]!.id,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        1,
      )

      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 2)
      await expectTradeError(
        trades.addHoldingLine(me.userId, tradeId, holdingId, 1),
        'unavailable',
      )
      await expectTradeError(
        trades.addHoldingLine(me.userId, tradeId, listHolding.holdingId, 1),
        'unavailable',
      )

      const found = await trades.browseTradeable(me.userId, tradeId, { query: 'bolt' })
      expect(found).toEqual([
        expect.objectContaining({
          name: 'Collection',
          kind: 'collection',
          selectedCount: 2,
          holdings: [
            expect.objectContaining({
              holdingId,
              qty: 2,
              inTrade: 2,
              lineId: expect.any(String),
            }),
          ],
        }),
      ])
    })

    it('browses containers, puts a whole binder in, and leaves built decks out', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3 })
      const binder = await createBinder(me.collectionId, 'Trade binder')
      await addHolding(
        me.userId,
        {
          containerId: binder,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        3,
      )
      await addHolding(
        me.userId,
        {
          containerId: binder,
          cardId: sol,
          finish: 'foil',
          condition: 'lp',
          language: 'en',
        },
        1,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name, deck_state) VALUES ($1, 'deck', 'Burn', 'built') RETURNING id`,
        [me.collectionId],
      )
      await pool.query(
        `INSERT INTO holdings (container_id, card_id, qty) VALUES ($1, $2, 4)`,
        [rows[0]!.id, bolt],
      )

      const { tradeId } = await trades.createTrade(me.userId, {})
      const groups = await trades.browseTradeable(me.userId, tradeId)
      expect(
        groups.map((group) => [group.name, group.kind, group.cardCount, group.tradeable]),
      ).toEqual([
        ['Collection', 'collection', 0, true],
        ['Trade binder', 'binder', 4, true],
        ['Burn', 'deck', 4, false],
      ])
      expect(groups.every((group) => group.holdings === null)).toBe(true)

      const opened = await trades.browseTradeable(me.userId, tradeId, {
        containerId: binder,
      })
      expect(opened.find((group) => group.containerId === binder)?.holdings).toHaveLength(
        2,
      )
      const deck = await trades.browseTradeable(me.userId, tradeId, {
        containerId: rows[0]!.id,
      })
      expect(deck.find((group) => group.kind === 'deck')?.holdings).toBeNull()
      await expectTradeError(
        trades.addContainerLines(me.userId, tradeId, rows[0]!.id),
        'unavailable',
      )

      expect(await trades.addContainerLines(me.userId, tradeId, binder)).toEqual({
        added: 4,
      })
      // Une seconde fois : rien ne double, chaque holding reste à sa quantité.
      await trades.addContainerLines(me.userId, tradeId, binder)
      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.give.lines.map((line) => line.qty).sort()).toEqual([1, 3])
      const scoped = await trades.browseTradeable(me.userId, tradeId, {
        scope: 'binders',
      })
      expect(scoped).toEqual([
        expect.objectContaining({ name: 'Trade binder', selectedCount: 4 }),
      ])
    })

    it('imports a pasted list, then fixes finish and condition of a received card', async () => {
      const me = await createAccount('alice')
      const sol = await insertCard('Sol Ring', { eur: 3, eurFoil: 9 })
      await insertCard('Brainstorm', { eur: 1 })
      const { tradeId } = await trades.createTrade(me.userId, {})

      const preview = await trades.previewImport(
        me.userId,
        tradeId,
        '2 Sol Ring\n1 Brainstorm\n1 Nonexistent Card\nnot a card line',
      )
      expect(preview.ignored).toBe(1)
      expect(preview.lines.map((line) => [line.name, line.status])).toEqual([
        ['Sol Ring', 'resolved'],
        ['Brainstorm', 'resolved'],
        ['Nonexistent Card', 'unknown'],
      ])

      await trades.addCatalogLines(
        me.userId,
        tradeId,
        preview.lines
          .filter((line) => line.cardId)
          .map((line) => ({
            cardId: line.cardId!,
            finish: line.finish,
            condition: line.condition,
            language: line.language,
            qty: line.qty,
          })),
      )
      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.get.lines.map((line) => [line.name, line.qty])).toEqual([
        ['Brainstorm', 1],
        ['Sol Ring', 2],
      ])
      const solLine = view.get.lines.find((line) => line.cardId === sol)!
      expect(solLine.fromCatalog).toBe(true)

      await trades.updateLine(me.userId, tradeId, solLine.id, {
        finish: 'foil',
        condition: 'lp',
      })
      const updated = (await trades.getTradeView(me.userId, tradeId)).get.lines.find(
        (line) => line.id === solLine.id,
      )!
      expect(updated).toMatchObject({
        finish: 'foil',
        condition: 'lp',
        marketPriceMinor: 900,
      })

      // Une carte d'un holding garde la finition de son holding.
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        1,
      )
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 1)
      const mine = (await trades.getTradeView(me.userId, tradeId)).give.lines[0]!
      await expectTradeError(
        trades.updateLine(me.userId, tradeId, mine.id, { finish: 'foil' }),
        'forbidden',
      )
    })

    it('counts cash at face value and keeps notes editable after completion', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        2,
      )
      const { tradeId } = await trades.createTrade(me.userId, { counterpartyName: 'Sam' })
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 2)
      await trades.setCash(me.userId, tradeId, 'counterparty', 500)
      await trades.setRate(me.userId, tradeId, 'counterparty', 50)
      await trades.setNotes(
        me.userId,
        tradeId,
        'counterparty',
        '  Sam brings the rest on Friday.  ',
      )
      await expectTradeError(
        trades.setCash(me.userId, tradeId, 'initiator', -1),
        'invalid',
      )

      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.get).toMatchObject({
        cashMinor: 500,
        notes: 'Sam brings the rest on Friday.',
        canEditNotes: true,
      })
      const [summary] = await trades.listTrades(me.userId)
      expect(summary).toMatchObject({ giveMinor: 400, getMinor: 500 })

      await trades.completeInPerson(me.userId, tradeId, view.revision)
      await trades.setNotes(me.userId, tradeId, 'initiator', 'Done at the LGS.')
      const done = await trades.getTradeView(me.userId, tradeId)
      expect(done).toMatchObject({
        status: 'completed',
        give: { notes: 'Done at the LGS.' },
      })
      await expectTradeError(
        trades.setCash(me.userId, tradeId, 'initiator', 100),
        'not_open',
      )
    })

    it('values each side with its rate and price overrides', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3 })
      const { holdingId } = await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        5,
      )
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addHoldingLine(me.userId, tradeId, holdingId, 5)
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: sol,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 2,
      })
      const view = await trades.getTradeView(me.userId, tradeId)
      await trades.updateLine(me.userId, tradeId, view.get.lines[0]!.id, {
        priceOverrideMinor: 450,
      })
      await trades.setRate(me.userId, tradeId, 'initiator', 90)
      // Hors bornes : ramené à la borne plutôt que refusé.
      await trades.setRate(me.userId, tradeId, 'counterparty', 400)

      const [summary] = await trades.listTrades(me.userId)
      expect(summary).toMatchObject({
        giveCount: 5,
        getCount: 2,
        giveMinor: 900,
        getMinor: 1350,
      })
    })

    it('values a side at a fixed amount instead of a percentage', async () => {
      const me = await createAccount('alice')
      const sol = await insertCard('Sol Ring', { eur: 3 })
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addCatalogLine(me.userId, tradeId, {
        cardId: sol,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        qty: 4,
      })
      await trades.setCash(me.userId, tradeId, 'counterparty', 100)
      await trades.setSideValue(me.userId, tradeId, 'counterparty', 1000)

      const view = await trades.getTradeView(me.userId, tradeId)
      expect(view.get).toMatchObject({ fixedMinor: 1000, ratePct: 100 })
      expect((await trades.listTrades(me.userId))[0]!.getMinor).toBe(1100)

      // Un pourcentage remplace la valeur fixe.
      await trades.setRate(me.userId, tradeId, 'counterparty', 50)
      expect((await trades.getTradeView(me.userId, tradeId)).get.fixedMinor).toBeNull()
      expect((await trades.listTrades(me.userId))[0]!.getMinor).toBe(700)
      await expectTradeError(
        trades.setSideValue(me.userId, tradeId, 'counterparty', -5),
        'invalid',
      )
    })

    it('gives a whole built deck away, dismantled, without undo', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3 })
      // Le deck réserve 4 Bolt et 1 Sol Ring, adossés au stock de la racine.
      await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        4,
      )
      await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: sol,
          finish: 'foil',
          condition: 'lp',
          language: 'en',
        },
        1,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name, deck_state) VALUES ($1, 'deck', 'Burn', 'built') RETURNING id`,
        [me.collectionId],
      )
      const deckId = rows[0]!.id
      await pool.query(
        `INSERT INTO holdings (container_id, card_id, qty) VALUES ($1, $2, 4), ($1, $3, 1)`,
        [deckId, bolt, sol],
      )

      const { tradeId } = await trades.createTrade(me.userId, {})
      const deckHolding = (
        await pool.query<{ id: string }>(
          'SELECT id FROM holdings WHERE container_id = $1 LIMIT 1',
          [deckId],
        )
      ).rows[0]!.id
      await expectTradeError(
        trades.addHoldingLine(me.userId, tradeId, deckHolding, 1),
        'unavailable',
      )

      expect(await trades.addDeckLines(me.userId, tradeId, deckId)).toEqual({ added: 5 })
      let view = await trades.getTradeView(me.userId, tradeId)
      expect(view.give.lines.every((line) => line.deck?.name === 'Burn')).toBe(true)
      await expectTradeError(
        trades.updateLine(me.userId, tradeId, view.give.lines[0]!.id, { qty: 1 }),
        'forbidden',
      )

      // Retirer une carte du deck retire tout le deck.
      await trades.removeLine(me.userId, tradeId, view.give.lines[0]!.id)
      expect((await trades.getTradeView(me.userId, tradeId)).give.lines).toHaveLength(0)
      await trades.addDeckLines(me.userId, tradeId, deckId)
      const groups = await trades.browseTradeable(me.userId, tradeId, { scope: 'decks' })
      expect(groups).toEqual([
        expect.objectContaining({
          name: 'Burn',
          selectedCount: 5,
          lineId: expect.any(String),
        }),
      ])

      view = await trades.getTradeView(me.userId, tradeId)
      expect(await trades.completeInPerson(me.userId, tradeId, view.revision)).toEqual({
        undoToken: null,
      })
      expect(await holdingsOf(me.rootId)).toEqual([])
      const { rows: deck } = await pool.query<{ deck_state: string }>(
        'SELECT deck_state FROM containers WHERE id = $1',
        [deckId],
      )
      expect(deck[0]!.deck_state).toBe('dismantled')
    })

    it('refuses a deck that changed since it was offered', async () => {
      const me = await createAccount('alice')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      await addHolding(
        me.userId,
        {
          containerId: me.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        4,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name, deck_state) VALUES ($1, 'deck', 'Burn', 'built') RETURNING id`,
        [me.collectionId],
      )
      await pool.query(
        `INSERT INTO holdings (container_id, card_id, qty) VALUES ($1, $2, 4)`,
        [rows[0]!.id, bolt],
      )
      const { tradeId } = await trades.createTrade(me.userId, {})
      await trades.addDeckLines(me.userId, tradeId, rows[0]!.id)
      await pool.query(`UPDATE holdings SET qty = 3 WHERE container_id = $1`, [
        rows[0]!.id,
      ])

      const { revision } = await trades.getTradeView(me.userId, tradeId)
      await expectTradeError(
        trades.completeInPerson(me.userId, tradeId, revision),
        'unavailable',
      )
      expect(await holdingsOf(me.rootId)).toEqual([expect.objectContaining({ qty: 4 })])
    })
  })

  describe('between two accounts', () => {
    it('hands the real copies of a whole deck to the other account', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      // Exemplaires réels foil/LP derrière une ligne de besoin nonfoil/NM.
      await addHolding(
        alice.userId,
        {
          containerId: alice.rootId,
          cardId: bolt,
          finish: 'foil',
          condition: 'lp',
          language: 'en',
        },
        2,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name, deck_state) VALUES ($1, 'deck', 'Burn', 'built') RETURNING id`,
        [alice.collectionId],
      )
      await pool.query(
        `INSERT INTO holdings (container_id, card_id, qty) VALUES ($1, $2, 2)`,
        [rows[0]!.id, bolt],
      )

      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })
      await trades.addDeckLines(alice.userId, tradeId, rows[0]!.id)
      await trades.joinTrade(bob.userId, tradeId)
      const { revision } = await trades.getTradeView(alice.userId, tradeId)
      await trades.acceptTrade(alice.userId, tradeId, revision)
      expect(await trades.acceptTrade(bob.userId, tradeId, revision)).toEqual({
        completed: true,
      })

      expect(await holdingsOf(alice.rootId)).toEqual([])
      expect(await holdingsOf(bob.rootId)).toEqual([
        expect.objectContaining({ card_id: bolt, qty: 2, finish: 'foil' }),
      ])
    })

    it('refuses a whole deck that declares cards its owner does not have', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob')
      const bolt = await insertCard('Lightning Bolt', { eur: 2 })
      const sol = await insertCard('Sol Ring', { eur: 3 })
      // 1 seul Bolt réel derrière un deck qui en annonce 4.
      await addHolding(
        alice.userId,
        {
          containerId: alice.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        1,
      )
      await addHolding(
        bob.userId,
        {
          containerId: bob.rootId,
          cardId: sol,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        1,
      )
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO containers (collection_id, kind, name, deck_state) VALUES ($1, 'deck', 'Burn', 'built') RETURNING id`,
        [alice.collectionId],
      )
      await pool.query(
        `INSERT INTO holdings (container_id, card_id, qty) VALUES ($1, $2, 4)`,
        [rows[0]!.id, bolt],
      )

      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })
      await trades.addDeckLines(alice.userId, tradeId, rows[0]!.id)
      await trades.joinTrade(bob.userId, tradeId)
      const bobSol = (await holdingsOf(bob.rootId))[0]!
      await trades.addHoldingLine(bob.userId, tradeId, bobSol.id, 1)
      const { revision } = await trades.getTradeView(alice.userId, tradeId)
      await trades.acceptTrade(alice.userId, tradeId, revision)
      await expectTradeError(trades.acceptTrade(bob.userId, tradeId, revision), 'unavailable')

      expect(await holdingsOf(bob.rootId)).toEqual([
        expect.objectContaining({ card_id: sol, qty: 1 }),
      ])
      expect(await holdingsOf(alice.rootId)).toEqual([
        expect.objectContaining({ card_id: bolt, qty: 1 }),
      ])
    })

    it('applies the swap once both accepted the same revision', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob', { priceSource: 'tcgplayer_usd' })
      const bolt = await insertCard('Lightning Bolt', { eur: 2, usd: 3 })
      const sol = await insertCard('Sol Ring', { eur: 3, usd: 4 })
      const aliceBolt = await addHolding(
        alice.userId,
        {
          containerId: alice.rootId,
          cardId: bolt,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        2,
      )
      const bobSol = await addHolding(
        bob.userId,
        {
          containerId: bob.rootId,
          cardId: sol,
          finish: 'nonfoil',
          condition: 'nm',
          language: 'en',
        },
        1,
      )
      const bobBinder = await createBinder(bob.collectionId, 'Trade binder')

      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })
      await trades.addHoldingLine(alice.userId, tradeId, aliceBolt.holdingId, 2)

      // Avant d'avoir accepté l'offre, Bob ne fait que la voir.
      const offer = await trades.getTradeView(bob.userId, tradeId)
      expect(offer).toMatchObject({ joined: false, give: { canEdit: false } })
      expect((await trades.listTrades(bob.userId))[0]!.awaitingMe).toBe(true)
      await expectTradeError(
        trades.addHoldingLine(bob.userId, tradeId, bobSol.holdingId, 1),
        'forbidden',
      )
      await expectTradeError(
        trades.acceptTrade(alice.userId, tradeId, offer.revision),
        'forbidden',
      )
      await expectTradeError(trades.joinTrade(alice.userId, tradeId), 'forbidden')
      await trades.joinTrade(bob.userId, tradeId)
      await expectTradeError(trades.joinTrade(bob.userId, tradeId), 'forbidden')

      // Bob ne peut pas puiser dans la collection d'Alice, ni toucher ses lignes.
      await expectTradeError(
        trades.addHoldingLine(bob.userId, tradeId, aliceBolt.holdingId, 1),
        'unavailable',
      )
      const aliceLine = (await trades.getTradeView(alice.userId, tradeId)).give.lines[0]!
      await expectTradeError(
        trades.updateLine(bob.userId, tradeId, aliceLine.id, { qty: 1 }),
        'forbidden',
      )
      await expectTradeError(
        trades.removeLine(bob.userId, tradeId, aliceLine.id),
        'forbidden',
      )

      await trades.addHoldingLine(bob.userId, tradeId, bobSol.holdingId, 1)
      await trades.setDestination(bob.userId, tradeId, bobBinder)
      // Chacun ne paie et n'annote que son côté.
      await trades.setCash(bob.userId, tradeId, 'counterparty', 100)
      await expectTradeError(
        trades.setCash(bob.userId, tradeId, 'initiator', 100),
        'forbidden',
      )
      await trades.setNotes(bob.userId, tradeId, 'counterparty', 'Cash by transfer.')
      await expectTradeError(
        trades.setNotes(bob.userId, tradeId, 'initiator', 'Nope'),
        'forbidden',
      )
      expect((await trades.getTradeView(alice.userId, tradeId)).get).toMatchObject({
        cashMinor: 100,
        notes: 'Cash by transfer.',
        canEditNotes: false,
      })

      // Bob voit les lignes d'Alice, jamais sa collection.
      const bobView = await trades.getTradeView(bob.userId, tradeId)
      expect(bobView.me).toBe('counterparty')
      expect(bobView.currency).toBe('eur')
      expect(bobView.get.lines[0]).toMatchObject({
        qty: 2,
        sourceName: null,
        maxQty: null,
      })
      expect(bobView.give.lines[0]!.maxQty).toBe(1)

      const first = await trades.getTradeView(alice.userId, tradeId)
      expect(await trades.acceptTrade(alice.userId, tradeId, first.revision)).toEqual({
        completed: false,
      })

      // Une modification invalide l'acceptation d'Alice.
      await trades.updateLine(bob.userId, tradeId, aliceLine.id, {
        priceOverrideMinor: 150,
      })
      const changed = await trades.getTradeView(alice.userId, tradeId)
      expect(changed.acceptedByMe).toBe(false)
      await expectTradeError(
        trades.acceptTrade(bob.userId, tradeId, first.revision),
        'stale',
      )

      expect(await trades.acceptTrade(bob.userId, tradeId, changed.revision)).toEqual({
        completed: false,
      })
      const [aliceSummary] = await trades.listTrades(alice.userId)
      expect(aliceSummary!.awaitingMe).toBe(true)
      expect(await trades.acceptTrade(alice.userId, tradeId, changed.revision)).toEqual({
        completed: true,
      })

      expect(await holdingsOf(alice.rootId)).toEqual([
        expect.objectContaining({ card_id: sol, qty: 1 }),
      ])
      expect(await holdingsOf(bob.rootId)).toEqual([])
      expect(await holdingsOf(bobBinder)).toEqual([
        expect.objectContaining({ card_id: bolt, qty: 2 }),
      ])
      expect(await cardCountOf(bobBinder)).toBe(2)

      const done = await trades.getTradeView(bob.userId, tradeId)
      expect(done.status).toBe('completed')
      await expectTradeError(
        trades.addHoldingLine(bob.userId, tradeId, bobSol.holdingId, 1),
        'not_open',
      )
    })

    it('only offers accounts that turned the tool on', async () => {
      const alice = await createAccount('alice')
      await createAccount('bob')
      const carol = await createAccount('bobby', { trading: false })

      expect(
        (await trades.searchTradePartners(alice.userId, 'bo')).map((p) => p.username),
      ).toEqual(['bob'])
      expect(await trades.searchTradePartners(alice.userId, 'al')).toEqual([])
      await expectTradeError(
        trades.createTrade(alice.userId, { counterpartyId: carol.userId }),
        'not_found',
      )
      await expectTradeError(
        trades.createTrade(alice.userId, { counterpartyId: alice.userId }),
        'not_found',
      )
    })

    it('hides a trade from anyone who is not a party', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob')
      const eve = await createAccount('eve')
      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })

      await expectTradeError(trades.getTradeView(eve.userId, tradeId), 'not_found')
      await expectTradeError(trades.cancelTrade(eve.userId, tradeId), 'not_found')
      expect(await trades.listTrades(eve.userId)).toEqual([])
    })

    it('refuses writes from a read-only member', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob')
      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })
      await pool.query(
        `UPDATE collection_members SET role = 'viewer' WHERE user_id = $1`,
        [alice.userId],
      )

      await expectTradeError(
        trades.setRate(alice.userId, tradeId, 'counterparty', 90),
        'forbidden',
      )
      expect((await trades.getTradeView(alice.userId, tradeId)).canWrite).toBe(false)
    })

    it('keeps a cancelled trade in both histories', async () => {
      const alice = await createAccount('alice')
      const bob = await createAccount('bob')
      const { tradeId } = await trades.createTrade(alice.userId, {
        counterpartyId: bob.userId,
      })
      await trades.cancelTrade(bob.userId, tradeId)

      expect((await trades.listTrades(alice.userId))[0]).toMatchObject({
        id: tradeId,
        status: 'cancelled',
      })
      expect((await trades.listTrades(bob.userId))[0]).toMatchObject({
        id: tradeId,
        status: 'cancelled',
        partnerName: 'alice',
      })
      await expectTradeError(trades.cancelTrade(alice.userId, tradeId), 'not_open')
    })
  })
})
