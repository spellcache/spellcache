// Test d'intégration du scanner de cartes : la lecture d'un texte reconnu
// contre le catalogue (`lib/scanner/lookup.ts`, route `/api/scanner/lookup`)
// et l'ajout groupé de l'écran de revue (`tools/scanner/actions.ts`).
//
// Seul `auth()` est mocké, le reste tourne contre la base éphémère
// `postgres-test`.
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { TRUNCATE_ALL, aggregateHoldings, insertCard, insertUser, readStats } from '../utils/collection-fixture'

const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string
    email: string
    username: string
    displayName: string | null
    role: string
  },
}))
vi.mock('@/lib/auth', () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}))

describe.skipIf(!process.env.TEST_DATABASE_URL)('card scanner', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let lookupScannedCard: typeof import('@/lib/scanner/lookup').lookupScannedCard
  let lookupScannedCardIn: typeof import('@/lib/scanner/lookup').lookupScannedCardIn
  let lookupRoute: typeof import('@/app/api/scanner/lookup/route').GET
  let settingsRoute: typeof import('@/app/api/scanner/settings/route')
  let saveScannedCardsAction: typeof import('@/app/(app)/tools/scanner/actions').saveScannedCardsAction
  let getScannedCardsAction: typeof import('@/app/(app)/tools/scanner/actions').getScannedCardsAction

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ lookupScannedCard, lookupScannedCardIn } = await import('@/lib/scanner/lookup'))
    ;({ GET: lookupRoute } = await import('@/app/api/scanner/lookup/route'))
    settingsRoute = await import('@/app/api/scanner/settings/route')
    ;({ saveScannedCardsAction, getScannedCardsAction } = await import('@/app/(app)/tools/scanner/actions'))
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    authState.user = null
    await pool.query(TRUNCATE_ALL)
  })

  async function setup(username: string, scanner = true) {
    const userId = await insertUser(pool, username)
    await pool.query('UPDATE users SET tool_card_scanner = $2 WHERE id = $1', [userId, scanner])
    const { collectionId, containerId: rootId } = await bootstrapCollection(userId, {
      username,
      displayName: null,
    })
    authState.user = {
      id: userId,
      email: `${username}@example.com`,
      username,
      displayName: null,
      role: 'member',
    }
    return { userId, collectionId, rootId }
  }

  describe('lookupScannedCard', () => {
    it('finds the exact printing from the set code and the four-digit number', async () => {
      const id = await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })
      await insertCard(pool, { name: 'Lightning Bolt', setCode: '2x2', collectorNumber: '117' })

      expect(await lookupScannedCard({ setCode: 'M10', collectorNumber: '0146' })).toEqual({
        cardId: id,
        name: 'Lightning Bolt',
        setCode: 'm10',
        setName: 'm10',
        collectorNumber: '146',
        setIconUri: null,
        finishes: ['nonfoil', 'foil'],
        exact: true,
      })
    })

    it('corrects a set code misread by the recognition', async () => {
      const id = await insertCard(pool, { name: 'Pacifism', setCode: 'm20', collectorNumber: '32' })
      expect((await lookupScannedCard({ setCode: 'M2O', collectorNumber: '32/280' }))?.cardId).toBe(id)
    })

    it('falls back to the name, preferring a printing of the set read', async () => {
      await insertCard(pool, { name: 'Counterspell', setCode: 'mh2', collectorNumber: '267' })
      const inSet = await insertCard(pool, { name: 'Counterspell', setCode: 'cmr', collectorNumber: '395' })

      const match = await lookupScannedCard({
        setCode: 'CMR',
        collectorNumber: '9999',
        names: ['Counterspell ®', 'Instant'],
      })
      expect(match).toMatchObject({ cardId: inSet, exact: false })
    })

    it('matches the front face of a double-faced card', async () => {
      const id = await insertCard(pool, {
        name: 'Delver of Secrets // Insectile Aberration',
        setCode: 'isd',
        collectorNumber: '51',
      })
      expect((await lookupScannedCard({ names: ['Delver of Secrets'] }))?.cardId).toBe(id)
    })

    it('never takes a line of rules text for a name', async () => {
      await insertCard(pool, { name: 'Shock', setCode: 'm19', collectorNumber: '156' })
      expect(await lookupScannedCard({ names: ['Shock deals 2 damage to any target.', 'Sh'] })).toBeNull()
      expect(await lookupScannedCard({ setCode: 'M19', collectorNumber: '157' })).toBeNull()
    })

    it('finds the exact printing of a 2008-2014 card from its number and name', async () => {
      await insertCard(pool, { name: 'Delver of Secrets // Insectile Aberration', setCode: 'inr', collectorNumber: '457' })
      const isd = await insertCard(pool, {
        name: 'Delver of Secrets // Insectile Aberration',
        setCode: 'isd',
        collectorNumber: '51a',
      })
      expect(await lookupScannedCard({ collectorNumber: '51A/264', names: ['Delver of Secrets'] })).toMatchObject({
        cardId: isd,
        exact: true,
      })
    })

    it('trusts the read name over a number missing a digit', async () => {
      await insertCard(pool, { name: 'Dwarven Castle Guard', setCode: 'fin', collectorNumber: '18' })
      const shinra = await insertCard(pool, { name: 'Shinra Reinforcements', setCode: 'fin', collectorNumber: '118' })
      const read = { setCode: 'FIN', collectorNumber: 'O18', names: ['Shinra Reinforcements', 'Human Soldier'] }

      expect(await lookupScannedCard(read)).toMatchObject({ cardId: shinra, exact: true })
      expect((await lookupScannedCardIn(read, ['fin'])).match).toMatchObject({ cardId: shinra, exact: true })
    })

    it('keeps the printing of the number when the read name is not found', async () => {
      const id = await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })
      const read = { setCode: 'M10', collectorNumber: '0146', names: ['Foudre'] }

      expect(await lookupScannedCard(read)).toMatchObject({ cardId: id, exact: true })
    })

    it('looks a token up in the token set of the printed set', async () => {
      await insertCard(pool, { name: 'Case of the Shattered Pact', setCode: 'mkm', collectorNumber: '1' })
      const token = await insertCard(pool, { name: 'Detective', setCode: 'tmkm', collectorNumber: '3' })
      await insertCard(pool, { name: 'Other', setCode: 'mkm', collectorNumber: '3' })

      expect(await lookupScannedCard({ setCode: 'MKM', collectorNumber: '0003', token: true })).toMatchObject({
        cardId: token,
        exact: true,
      })
    })
  })

  describe('lookupScannedCardIn (filtre de sets)', () => {
    it('only returns cards of the chosen sets and says when the card is elsewhere', async () => {
      await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })
      const inFin = await insertCard(pool, { name: 'Shinra Reinforcements', setCode: 'fin', collectorNumber: '118' })

      expect(await lookupScannedCardIn({ setCode: 'M10', collectorNumber: '146' }, ['fin'])).toEqual({
        match: null,
        outsideSets: true,
      })
      expect((await lookupScannedCardIn({ setCode: 'FIN', collectorNumber: '0118' }, ['fin'])).match).toMatchObject({
        cardId: inFin,
        exact: true,
      })
    })

    it('finds the number in the chosen sets when the set code is misread, confirmed by the name', async () => {
      const inFin = await insertCard(pool, { name: 'Shinra Reinforcements', setCode: 'fin', collectorNumber: '118' })
      await insertCard(pool, { name: 'Other Card', setCode: 'mkm', collectorNumber: '118' })

      const read = { setCode: 'F1N', collectorNumber: '0118', names: ['Shinra Reinforcements'] }
      expect((await lookupScannedCardIn(read, ['fin', 'mkm'])).match).toMatchObject({ cardId: inFin, exact: true })
    })

    it('falls back to the name within the chosen sets, exact when it has a single printing there', async () => {
      await insertCard(pool, { name: 'Counterspell', setCode: 'mh2', collectorNumber: '267' })
      const inCmr = await insertCard(pool, { name: 'Counterspell', setCode: 'cmr', collectorNumber: '395' })

      expect((await lookupScannedCardIn({ names: ['Counterspell'] }, ['cmr'])).match).toMatchObject({
        cardId: inCmr,
        exact: true,
      })
      expect(await lookupScannedCardIn({ names: ['Counterspell'] }, ['fin'])).toEqual({
        match: null,
        outsideSets: true,
      })
    })
  })

  describe('GET /api/scanner/lookup', () => {
    function request(query: string) {
      return new Request(`http://localhost/api/scanner/lookup?${query}`)
    }

    it('refuses a request without session, then with the tool turned off', async () => {
      expect((await lookupRoute(request('set=M10&number=146'))).status).toBe(401)
      await setup('scanneroff', false)
      expect((await lookupRoute(request('set=M10&number=146'))).status).toBe(404)
    })

    it('answers the card and the holding language of the printed code', async () => {
      await setup('scannerroute')
      const id = await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })

      const response = await lookupRoute(request('set=M10&number=0146&lang=JP&name=Lightning%20Bolt'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        match: {
          cardId: id,
          name: 'Lightning Bolt',
          setCode: 'm10',
          setName: 'm10',
          collectorNumber: '146',
          setIconUri: null,
          finishes: ['nonfoil', 'foil'],
          exact: true,
          language: 'ja',
        },
        confirmed: true,
        outsideSets: false,
      })

      const none = await lookupRoute(request('set=M10&number=999'))
      expect(await none.json()).toEqual({ match: null, confirmed: false, outsideSets: false })
    })

    it('confirms a printing only when its name is read too', async () => {
      await setup('scannerconfirm')
      await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })

      const confirmed = async (query: string) => (await (await lookupRoute(request(query))).json()).confirmed
      expect(await confirmed('set=M10&number=146&name=Lightning%20Bolt&name=Instant')).toBe(true)
      expect(await confirmed('set=M10&number=146&name=Foudre')).toBe(false)
      expect(await confirmed('set=M10&number=146')).toBe(false)
      expect(await confirmed('name=Lightning%20Bolt')).toBe(false)
    })
  })

  describe('/api/scanner/settings', () => {
    function put(body: unknown, contentType = 'application/json') {
      return settingsRoute.PUT(
        new Request('http://localhost/api/scanner/settings', {
          method: 'PUT',
          headers: { 'content-type': contentType },
          body: JSON.stringify(body),
        }),
      )
    }

    it('keeps the scanner settings on the account, merging each write', async () => {
      await setup('scannersettings')
      expect(await (await settingsRoute.GET()).json()).toEqual({ settings: {} })

      const camera = { scanMode: 'auto', frameSize: 0.75, cameraId: '0', torchOn: true, torchLevel: 12 }
      expect((await put(camera)).status).toBe(200)
      // L'écran de revue n'envoie que ses clés : celles de l'app restent.
      expect((await put({ sound: false, sets: ['FIN', 'fin', 'mkm'] })).status).toBe(200)
      expect(await (await settingsRoute.GET()).json()).toEqual({
        settings: { ...camera, sound: false, sets: ['fin', 'mkm'] },
      })
    })

    it('reads only the cards of the sets chosen in the settings', async () => {
      await setup('scannerfilter')
      await insertCard(pool, { name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146' })
      await put({ sets: ['fin'] })
      const response = await lookupRoute(new Request('http://localhost/api/scanner/lookup?set=M10&number=146'))
      expect(await response.json()).toEqual({ match: null, confirmed: false, outsideSets: true })
    })

    it('refuses invalid settings, other content types and a disabled tool', async () => {
      await setup('scannersettingsbad')
      expect((await put({ scanMode: 'everything' })).status).toBe(400)
      expect((await put({ unknown: true })).status).toBe(400)
      expect((await put({ torchOn: true }, 'text/plain')).status).toBe(415)

      authState.user = null
      expect((await settingsRoute.GET()).status).toBe(401)
      await setup('scannersettingsoff', false)
      expect((await settingsRoute.GET()).status).toBe(404)
    })
  })

  describe('saveScannedCardsAction', () => {
    it('adds every scanned card to a binder in one write, merged with what is there', async () => {
      const { userId, collectionId } = await setup('scannersave')
      const bolt = await insertCard(pool, { name: 'Lightning Bolt', priceEur: 2, priceEurFoil: 5 })
      const shock = await insertCard(pool, { name: 'Shock', priceEur: 0.5 })
      const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Scanned' })

      const lines = [
        { cardId: bolt, finish: 'nonfoil', condition: 'lp', language: 'fr', qty: 2 },
        { cardId: bolt, finish: 'foil', condition: 'lp', language: 'fr', qty: 1 },
        { cardId: shock, finish: 'nonfoil', condition: 'lp', language: 'fr', qty: 1 },
      ]
      expect(await saveScannedCardsAction({ containerId: binder.id, lines })).toEqual({
        ok: true,
        added: 4,
      })
      expect(
        await saveScannedCardsAction({
          containerId: binder.id,
          lines: [{ cardId: shock, finish: 'nonfoil', condition: 'lp', language: 'fr', qty: 2 }],
        }),
      ).toEqual({ ok: true, added: 2 })

      const { rows } = await pool.query(
        `SELECT card_id, finish, condition, language, qty FROM holdings WHERE container_id = $1 ORDER BY qty`,
        [binder.id],
      )
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.condition === 'lp' && row.language === 'fr')).toBe(true)
      expect(rows.find((row) => row.card_id === shock)?.qty).toBe(3)
      expect(await readStats(pool, binder.id)).toEqual(await aggregateHoldings(pool, [binder.id]))
    })

    it('refuses a deck, a container of another collection and a disabled tool', async () => {
      const { userId, collectionId } = await setup('scannerdeny')
      const card = await insertCard(pool, { name: 'Opt' })
      const lines = [{ cardId: card, finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }]
      const deck = await createContainer(userId, collectionId, {
        kind: 'deck',
        name: 'Deck',
        format: 'commander',
        deckState: 'plan',
      })
      expect(await saveScannedCardsAction({ containerId: deck.id, lines })).toEqual({
        ok: false,
        error: 'invalid',
      })

      const otherId = await insertUser(pool, 'scannerother')
      const other = await bootstrapCollection(otherId, { username: 'scannerother', displayName: null })
      expect(
        await saveScannedCardsAction({ containerId: other.containerId, lines }),
      ).toEqual({ ok: false, error: 'failed' })

      const { rows } = await pool.query('SELECT count(*)::int AS n FROM holdings')
      expect(rows[0].n).toBe(0)

      await pool.query('UPDATE users SET tool_card_scanner = false WHERE id = $1', [userId])
      await expect(getScannedCardsAction([card])).rejects.toThrow()
    })

    it('loads the scanned cards with their finishes', async () => {
      await setup('scannerread')
      const foilOnly = await insertCard(pool, { name: 'Promo', finishes: ['foil'] })
      const { cards } = await getScannedCardsAction([foilOnly, foilOnly])
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ id: foilOnly, name: 'Promo', finishes: ['foil'] })
    })
  })
})
