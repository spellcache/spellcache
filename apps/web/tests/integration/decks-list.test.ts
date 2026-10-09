// Test d'intégration : `listDecks` calcule un statut par deck depuis le
// catalogue réel, sans N+1, et les compteurs de puces
// (`all`/`legal`/`needsWork`) correspondent exactement aux statuts rendus.
// Contre la base éphémère `postgres-test` (voir packages/db/testing/global-setup.ts) ; se
// saute lui-même si `TEST_DATABASE_URL` n'est pas exposé (Docker
// indisponible).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Legality } from '@spellcache/db/schema'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Decks list data', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let updateHolding: typeof import('@/lib/containers/holdings').updateHolding
  let listDecks: typeof import('@/app/(app)/decks/decks-data').listDecks

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding, updateHolding } = await import('@/lib/containers/holdings'))
    ;({ listDecks } = await import('@/app/(app)/decks/decks-data'))
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

  async function createUser(username: string) {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username, priceSource: 'tcgplayer_usd' })
      .returning({ id: users.id })
    return row!.id
  }

  async function insertCard(
    id: string,
    name: string,
    options: { colorIdentity?: string[]; typeLine?: string; legalities?: Record<string, Legality> } = {},
  ): Promise<void> {
    const colorIdentity = options.colorIdentity ?? []
    const typeLine = options.typeLine ?? 'Creature — Human'
    const legalities = options.legalities ?? {}
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ('e2e', 'E2E set', 0) ON CONFLICT (code) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1::uuid, $2, $3, 'e2e', $1::text, 'common', 0, $4, '{}', $5::text[], '{nonfoil}', $6::jsonb)`,
      [id, randomUUID(), name, typeLine, colorIdentity, JSON.stringify(legalities)],
    )
  }

  let queryCount = 0
  let originalQuery: typeof Pool.prototype.query

  beforeEach(() => {
    queryCount = 0
    originalQuery = Pool.prototype.query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
    Pool.prototype.query = function (this: any, ...args: unknown[]) {
      queryCount += 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature variadique de pg
      return (originalQuery as any).apply(this, args)
    } as typeof Pool.prototype.query
  })

  afterEach(() => {
    Pool.prototype.query = originalQuery
  })

  it(
    'computes a needsWork status for an under-sized Commander deck, without a per-deck query',
    async () => {
      const userId = await createUser('planeswalker')
      const { collectionId } = await bootstrapCollection(userId, { username: 'planeswalker', displayName: null })

      const deck = await createContainer(userId, collectionId, {
        kind: 'deck',
        name: 'Atraxa Superfriends',
        format: 'commander',
        deckState: 'plan',
      })

      const commanderId = randomUUID()
      await insertCard(commanderId, 'Atraxa, Praetors’ Voice', { colorIdentity: ['W', 'U', 'B', 'G'] })
      const { holdingId } = await addHolding(
        userId,
        { containerId: deck.id, cardId: commanderId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        1,
      )
      await updateHolding(userId, holdingId, { isCommander: true })

      const plainsId = randomUUID()
      await insertCard(plainsId, 'Plains', { typeLine: 'Basic Land — Plains' })
      await addHolding(
        userId,
        { containerId: deck.id, cardId: plainsId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        63,
      )

      queryCount = 0
      const result = await listDecks(userId)

      // Une seule requête pour la liste (recalculer le statut deck par deck
      // avec une requête chacun fabriquerait un N+1 dès quatre decks) — une
      // seconde pour résoudre `collectionId`/la devise.
      expect(queryCount).toBeLessThanOrEqual(2)

      expect(result.decks).toHaveLength(1)
      const summary = result.decks[0]!
      expect(summary.status.kind).toBe('needsWork')
      expect(summary.status.label).toBe('36 short')
      expect(summary.colorIdentity).toEqual(['W', 'U', 'B', 'G'])
      // Aucun habillage choisi : l'illustration du commandant.
      expect(summary.artUrl).toContain(commanderId)
      expect(summary.coverGradient).toBeNull()
    },
  )

  it('buckets built+legal under Legal, needsWork/noFormat under Needs work, and formats without rules in neither', async () => {
    const userId = await createUser('fourdecks')
    const { collectionId } = await bootstrapCollection(userId, { username: 'fourdecks', displayName: null })

    // Deck 1 : Commander sous-dimensionné → needsWork.
    const deckA = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Needs work A',
      format: 'commander',
      deckState: 'plan',
    })
    const commanderCardId = randomUUID()
    await insertCard(commanderCardId, 'Krenko, Mob Boss', { colorIdentity: ['R'] })
    const { holdingId: commanderHoldingId } = await addHolding(
      userId,
      { containerId: deckA.id, cardId: commanderCardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    await updateHolding(userId, commanderHoldingId, { isCommander: true })

    // Deck 2 : Commander légal (commandant + 99 terrains de base, exemptés
    // du singleton), deck_state = 'built' → bucket Legal (kind 'built').
    // Seul Commander porte des règles (lib/decks/legality.ts) : c'est le seul
    // format qui peut atteindre ce bucket. Créé en `plan` et rempli avant de
    // passer `built` (`addHolding` refuse toute écriture sur un deck déjà
    // `built`) — le passage à `built` se fait par écriture directe.
    const deckB = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Legal B',
      format: 'commander',
      deckState: 'plan',
    })
    const legalCommanderId = randomUUID()
    await insertCard(legalCommanderId, 'Torbran, Thane of Red Fell', {
      colorIdentity: ['R'],
      typeLine: 'Legendary Creature — Dwarf Noble',
    })
    const { holdingId: legalCommanderHoldingId } = await addHolding(
      userId,
      { containerId: deckB.id, cardId: legalCommanderId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
    await updateHolding(userId, legalCommanderHoldingId, { isCommander: true })
    const mountainId = randomUUID()
    await insertCard(mountainId, 'Mountain', { typeLine: 'Basic Land — Mountain' })
    await addHolding(
      userId,
      { containerId: deckB.id, cardId: mountainId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      99,
    )
    await pool.query(`UPDATE containers SET deck_state = 'built' WHERE id = $1`, [deckB.id])

    // Deck 3 : sans format → noFormat, bucket Needs work.
    await createContainer(userId, collectionId, { kind: 'deck', name: 'No format C', deckState: 'plan' })

    // Deck 4 : Modern, format sans règles aujourd'hui → noRules, compté dans
    // `all` seulement, ni Legal ni Needs work.
    await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'No rules D',
      format: 'modern',
      deckState: 'plan',
    })

    const result = await listDecks(userId)

    expect(result.counts.all).toBe(4)
    expect(result.counts.legal).toBe(1)
    expect(result.counts.needsWork).toBe(2)
    expect(result.decks.find((d) => d.name === 'Legal B')?.status.kind).toBe('built')
    expect(result.decks.find((d) => d.name === 'No rules D')?.status.kind).toBe('noRules')

    // Les compteurs correspondent exactement aux statuts de la liste rendue
    // — recomptés indépendamment ici.
    const recomputedLegal = result.decks.filter((d) => d.status.kind === 'legal' || d.status.kind === 'built').length
    const recomputedNeedsWork = result.decks.filter(
      (d) => d.status.kind === 'needsWork' || d.status.kind === 'noFormat',
    ).length
    expect(recomputedLegal).toBe(result.counts.legal)
    expect(recomputedNeedsWork).toBe(result.counts.needsWork)
  })

  it('scopes decks to the caller collection only, never leaking another member', async () => {
    const userA = await createUser('deckowner')
    const { collectionId: collectionA } = await bootstrapCollection(userA, {
      username: 'deckowner',
      displayName: null,
    })
    await createContainer(userA, collectionA, { kind: 'deck', name: "Owner's deck", deckState: 'plan' })

    const userB = await createUser('otherplayer')
    await bootstrapCollection(userB, { username: 'otherplayer', displayName: null })

    const resultB = await listDecks(userB)
    expect(resultB.decks).toHaveLength(0)

    const resultA = await listDecks(userA)
    expect(resultA.decks.map((d) => d.name)).toEqual(["Owner's deck"])
  })
})
