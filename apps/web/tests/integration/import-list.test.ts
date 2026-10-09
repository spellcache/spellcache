// Test d'intégration de l'import de liste : résolution, ambiguïtés,
// annulation. Contre la base éphémère `postgres-test` (voir
// packages/db/testing/global-setup.ts) ; se saute lui-même si
// `TEST_DATABASE_URL` n'est pas exposé (Docker indisponible), même garde que
// les autres tests d'intégration.
//
// Couvre le classement, l'absence d'écriture avant validation, l'import des
// seules lignes arbitrées, l'annulation par delta, la projection publique et
// l'aller-retour export → import sur 100 cartes, plus la normalisation des
// noms et la garde `owner` du basculement de visibilité.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Type seul : effacé à la compilation, donc sans effet sur l'ordre
// d'import réel (le module `@spellcache/db/schema` reste chargé après que
// `DATABASE_URL` a été réécrit, comme les autres).
import type { DeckZone } from '@spellcache/db/schema'

// Les Server Actions appellent `requireSession()` (lib/auth-guards.ts), qui
// lit `auth()` — mocké ici comme dans `folders.test.ts` : seul `auth()`
// est remplacé, tout le reste tourne pour de vrai contre la base éphémère.
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

// `revalidatePath` n'a de sens que dans un contexte de requête Next : appelé
// depuis Vitest il n'a aucun store à invalider. Neutralisé ici pour que le
// test porte sur la logique d'écriture et d'autorisation des actions, pas
// sur le cache du framework — le comportement de cache est vérifié de bout
// en bout par `tests/e2e/public-share.spec.ts`.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}))

describe.skipIf(!process.env.TEST_DATABASE_URL)('import de liste et partage public', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

  let pool: Pool
  let db: typeof import('@spellcache/db').db
  let users: typeof import('@spellcache/db/schema').users
  let holdings: typeof import('@spellcache/db/schema').holdings
  let containers: typeof import('@spellcache/db/schema').containers
  let importLists: typeof import('@spellcache/db/schema').importLists
  let collectionMembers: typeof import('@spellcache/db/schema').collectionMembers
  let bootstrapCollection: typeof import('@/lib/collections/bootstrap').bootstrapCollection
  let createContainer: typeof import('@/lib/containers/containers').createContainer
  let addHolding: typeof import('@/lib/containers/holdings').addHolding
  let parseList: typeof import('@/lib/lists/parse-list').parseList
  let resolveList: typeof import('@/lib/lists/resolve-list').resolveList
  let getPublicContainer: typeof import('@/lib/sharing/public-container').getPublicContainer
  let formatContainerList: typeof import('@/components/lists/export-sheet').formatContainerList
  let actions: typeof import('@/app/(app)/container/[id]/sharing-actions')

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    ;({ db } = await import('@spellcache/db'))
    ;({ users, holdings, containers, importLists, collectionMembers } = await import('@spellcache/db/schema'))
    ;({ bootstrapCollection } = await import('@/lib/collections/bootstrap'))
    ;({ createContainer } = await import('@/lib/containers/containers'))
    ;({ addHolding } = await import('@/lib/containers/holdings'))
    ;({ parseList } = await import('@/lib/lists/parse-list'))
    ;({ resolveList } = await import('@/lib/lists/resolve-list'))
    ;({ getPublicContainer } = await import('@/lib/sharing/public-container'))
    ;({ formatContainerList } = await import('@/components/lists/export-sheet'))
    actions = await import('@/app/(app)/container/[id]/sharing-actions')
  })

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl
    await pool.end()
  })

  afterEach(async () => {
    authState.user = null
    await pool.query(
      'TRUNCATE import_lists, deck_folders, holdings, container_stats, containers, collection_members, collections, users, card_prices, cards, sets CASCADE',
    )
  })

  async function setup(username: string) {
    const [row] = await db
      .insert(users)
      .values({ email: `${username}@example.com`, username })
      .returning({ id: users.id })
    const userId = row!.id
    const { collectionId } = await bootstrapCollection(userId, { username, displayName: null })
    signIn(userId, username)
    return { userId, collectionId }
  }

  function signIn(userId: string, username: string) {
    authState.user = {
      id: userId,
      email: `${username}@example.com`,
      username,
      displayName: null,
      role: 'member',
    }
  }

  interface CardFixture {
    name: string
    setCode?: string
    collectorNumber?: string
    priceEur?: number
    typeLine?: string
  }

  async function insertCard(fixture: CardFixture): Promise<string> {
    const id = randomUUID()
    const setCode = fixture.setCode ?? 'tst'
    await pool.query(
      `INSERT INTO sets (code, name, card_count) VALUES ($1, $1, 0) ON CONFLICT (code) DO NOTHING`,
      [setCode],
    )
    await pool.query(
      `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
       VALUES ($1, $2, $3, $4, $5, 'common', 1, $6, '{}', '{}', '{nonfoil}', '{"modern":"legal"}'::jsonb)`,
      [
        id,
        randomUUID(),
        fixture.name,
        setCode,
        fixture.collectorNumber ?? id.slice(0, 8),
        fixture.typeLine ?? 'Instant',
      ],
    )
    if (fixture.priceEur !== undefined) {
      await pool.query(
        `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
         VALUES ($1, current_date, $2, null, $2, null)`,
        [id, fixture.priceEur.toFixed(2)],
      )
    }
    return id
  }

  async function holdingRows(containerId: string) {
    return db
      .select({
        cardId: holdings.cardId,
        qty: holdings.qty,
        zone: holdings.zone,
        isCommander: holdings.isCommander,
        finish: holdings.finish,
      })
      .from(holdings)
      .where(eq(holdings.containerId, containerId))
  }

  // ------------------------------------------------------------ résolution

  it('classe resolved, ambiguous (candidats remplis) et unknown', async () => {
    await setup('resolver')
    await insertCard({ name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' })
    await insertCard({ name: 'Lightning Bolt', setCode: '2x2', collectorNumber: '117', priceEur: 3 })
    await insertCard({ name: 'Lightning Bolt', setCode: 'lea', collectorNumber: '161', priceEur: 900 })

    const { lines } = parseList('1 Sol Ring\n4 Lightning Bolt\n2 Not A Real Card At All')
    const resolved = await resolveList(lines)

    expect(resolved.lines[0]!.status).toBe('resolved')
    expect(resolved.lines[0]!.cardId).not.toBeNull()

    expect(resolved.lines[1]!.status).toBe('ambiguous')
    expect(resolved.lines[1]!.cardId).toBeNull()
    expect(resolved.lines[1]!.candidates).toHaveLength(2)
    // Triés par prix croissant : l'impression la moins chère est le défaut
    // d'arbitrage.
    expect(resolved.lines[1]!.candidates![0]!.setCode).toBe('2x2')

    expect(resolved.lines[2]!.status).toBe('unknown')
    expect(resolved.lines[2]!.cardId).toBeNull()

    expect(resolved.summary).toEqual({ resolved: 1, ambiguous: 1, unknown: 1 })
  })

  it('résout malgré les accents, l’apostrophe typographique et le digramme Æ', async () => {
    await setup('normaliser')
    await insertCard({ name: 'Márton Stromgald' })
    await insertCard({ name: 'Gaea’s Cradle' })
    await insertCard({ name: 'Æther Vial' })

    const { lines } = parseList("1 Marton Stromgald\n1 Gaea's Cradle\n1 Aether Vial")
    const resolved = await resolveList(lines)

    expect(resolved.lines.map((line) => line.status)).toEqual(['resolved', 'resolved', 'resolved'])
  })

  it('résout une carte double face citée par sa seule face avant', async () => {
    await setup('doublefaced')
    await insertCard({ name: 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen' })

    const front = await resolveList(parseList('1 Nicol Bolas, the Ravager').lines)
    expect(front.lines[0]!.status).toBe('resolved')

    const full = await resolveList(
      parseList('1 Nicol Bolas, the Ravager // Nicol Bolas, the Arisen').lines,
    )
    expect(full.lines[0]!.status).toBe('resolved')
  })

  it('propose des candidats trigramme pour un nom inconnu', async () => {
    await setup('fuzzy')
    await insertCard({ name: 'Lightning Bolt' })

    const resolved = await resolveList(parseList('1 Lightnin Bolt').lines)
    expect(resolved.lines[0]!.status).toBe('unknown')
    expect(resolved.lines[0]!.candidates?.length).toBeGreaterThan(0)
  })

  it('résout 300 lignes sans requête par ligne', async () => {
    await setup('bulkimporter')
    for (let i = 0; i < 60; i += 1) {
      await insertCard({ name: `Bulk Card ${i}`, collectorNumber: String(i) })
    }

    const text = Array.from({ length: 300 }, (_, i) => `1 Bulk Card ${i % 60}`).join('\n')
    const resolved = await resolveList(parseList(text).lines)
    expect(resolved.summary.resolved).toBe(300)
  })

  // ------------------------------------------------- aperçu sans écriture

  it("n'écrit aucun holding pour une simple résolution", async () => {
    const { userId, collectionId } = await setup('previewer')
    await insertCard({ name: 'Sol Ring' })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trades' })

    const result = await actions.resolveListAction({ containerId: binder.id, text: '4 Sol Ring' })
    expect(result.ok).toBe(true)

    expect(await holdingRows(binder.id)).toHaveLength(0)
    expect(await db.select().from(importLists)).toHaveLength(0)
  })

  // ----------------------------------------------------------- écriture

  it('importe les resolved et les ambiguous arbitrées, ignore les unknown', async () => {
    const { userId, collectionId } = await setup('importer')
    await insertCard({ name: 'Sol Ring' })
    const cheap = await insertCard({
      name: 'Lightning Bolt',
      setCode: '2x2',
      collectorNumber: '117',
      priceEur: 3,
    })
    const expensive = await insertCard({
      name: 'Lightning Bolt',
      setCode: 'lea',
      collectorNumber: '161',
      priceEur: 900,
    })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trades' })

    const text = '1 Sol Ring\n4 Lightning Bolt\n3 Not A Real Card At All'
    const result = await actions.importListAction({ containerId: binder.id, text })
    expect(result).toMatchObject({ ok: true })

    const rows = await holdingRows(binder.id)
    // Deux lignes seulement : l'inconnue n'est jamais écrite.
    expect(rows).toHaveLength(2)
    // L'ambiguë non arbitrée retombe sur l'impression la moins chère.
    expect(rows.find((row) => row.cardId === cheap)?.qty).toBe(4)
    expect(rows.find((row) => row.cardId === expensive)).toBeUndefined()
    // `imported` compte les exemplaires écrits, pas les lignes du texte.
    expect(result.ok && result.imported).toBe(5)

    const journal = await db.select().from(importLists)
    expect(journal).toHaveLength(1)
    expect(journal[0]!.lineCount).toBe(2)
    expect(journal[0]!.containerId).toBe(binder.id)
  })

  it('importe un export CSV avec la finition, l’état et la langue de chaque ligne', async () => {
    const { userId, collectionId } = await setup('csvimporter')
    const bolt2x2 = await insertCard({ name: 'Lightning Bolt', setCode: '2x2', collectorNumber: '117' })
    await insertCard({ name: 'Lightning Bolt', setCode: 'lea', collectorNumber: '161' })
    const ring = await insertCard({ name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'ManaBox' })

    // En-tête ManaBox, colonnes réordonnées et en partie inconnues : seul le
    // nom de colonne compte. La 3e ligne n'a ni état ni langue : les défauts
    // de la feuille s'appliquent.
    const text = [
      'Binder Name,Binder Type,Name,Set code,Collector number,Foil,Quantity,Condition,Language',
      'Trade,binder,Lightning Bolt,2X2,117,foil,2,lightly_played,fr',
      'Trade,binder,Lightning Bolt,2X2,117,normal,3,near_mint,en',
      'Trade,binder,Sol Ring,C21,263,normal,1,,',
    ].join('\n')
    const result = await actions.importListAction({
      containerId: binder.id,
      text,
      condition: 'mp',
    })
    expect(result).toMatchObject({ ok: true, imported: 6 })

    const rows = await db
      .select({
        cardId: holdings.cardId,
        qty: holdings.qty,
        finish: holdings.finish,
        condition: holdings.condition,
        language: holdings.language,
      })
      .from(holdings)
      .where(eq(holdings.containerId, binder.id))

    // Le set et le numéro désignent l'impression exacte, sans ambiguïté ; foil
    // et non-foil restent deux lignes distinctes.
    expect(rows).toHaveLength(3)
    expect(rows).toEqual(
      expect.arrayContaining([
        { cardId: bolt2x2, qty: 2, finish: 'foil', condition: 'lp', language: 'fr' },
        { cardId: bolt2x2, qty: 3, finish: 'nonfoil', condition: 'nm', language: 'en' },
        { cardId: ring, qty: 1, finish: 'nonfoil', condition: 'mp', language: 'en' },
      ]),
    )
  })

  it('refuse une liste au-delà de la borne de taille', async () => {
    const { userId, collectionId } = await setup('toolarge')
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Big' })

    const result = await actions.resolveListAction({
      containerId: binder.id,
      text: '1 Sol Ring\n'.repeat(200_000),
    })
    expect(result).toEqual({ ok: false, error: 'invalid' })
  })

  it('honore l’arbitrage explicite et refuse un cardId hors candidats', async () => {
    const { userId, collectionId } = await setup('arbiter')
    await insertCard({ name: 'Lightning Bolt', setCode: '2x2', collectorNumber: '117', priceEur: 3 })
    const expensive = await insertCard({
      name: 'Lightning Bolt',
      setCode: 'lea',
      collectorNumber: '161',
      priceEur: 900,
    })
    const unrelated = await insertCard({ name: 'Sol Ring' })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trades' })

    await actions.importListAction({
      containerId: binder.id,
      text: '1 Lightning Bolt',
      choices: [{ lineIndex: 0, cardId: expensive }],
    })
    expect((await holdingRows(binder.id))[0]!.cardId).toBe(expensive)

    const other = await createContainer(userId, collectionId, { kind: 'binder', name: 'Other' })
    // `unrelated` n'est candidat d'aucune ligne : le serveur l'ignore et
    // retombe sur l'impression la moins chère, il ne l'écrit jamais.
    await actions.importListAction({
      containerId: other.id,
      text: '1 Lightning Bolt',
      choices: [{ lineIndex: 0, cardId: unrelated }],
    })
    const rows = await holdingRows(other.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cardId).not.toBe(unrelated)
  })

  it('range le sideboard en zone side, et couple Commander à is_commander', async () => {
    const { userId, collectionId } = await setup('zoner')
    const bolt = await insertCard({ name: 'Lightning Bolt' })
    const blast = await insertCard({ name: 'Pyroblast' })
    const krenko = await insertCard({
      name: 'Krenko, Mob Boss',
      typeLine: 'Legendary Creature — Goblin',
    })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Burn',
      format: 'commander',
      deckState: 'plan',
    })

    await actions.importListAction({
      containerId: deck.id,
      text: 'Commander\n1 Krenko, Mob Boss\nDeck\n4 Lightning Bolt\nSideboard\n2 Pyroblast',
    })

    const rows = await holdingRows(deck.id)
    expect(rows.find((row) => row.cardId === bolt)?.zone).toBe('main')
    expect(rows.find((row) => row.cardId === blast)?.zone).toBe('side')

    const commander = rows.find((row) => row.cardId === krenko)
    expect(commander?.zone).toBe('commander')
    // `zone` et `is_commander` s'écrivent ensemble : sans
    // ce couplage, `getDeck` n'afficherait jamais ce commandant et
    // `hasCommanderHolding` resterait bloqué sur `commander_full`.
    expect(commander?.isCommander).toBe(true)
  })

  // ---------------------------------------------------------- annulation

  it('annule en retirant le delta, pas en restaurant un état final', async () => {
    const { userId, collectionId } = await setup('undoer')
    const existing = await insertCard({ name: 'Sol Ring' })
    const fresh = await insertCard({ name: 'Cultivate' })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trades' })

    // Une ligne préexistante de 2 exemplaires : l'import va l'incrémenter,
    // l'annulation doit la ramener à 2 — pas la supprimer.
    await addHolding(
      userId,
      { containerId: binder.id, cardId: existing, finish: 'nonfoil', condition: 'nm', language: 'en' },
      2,
    )

    const result = await actions.importListAction({
      containerId: binder.id,
      text: '3 Sol Ring\n1 Cultivate',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const afterImport = await holdingRows(binder.id)
    expect(afterImport.find((row) => row.cardId === existing)?.qty).toBe(5)
    expect(afterImport.find((row) => row.cardId === fresh)?.qty).toBe(1)

    const undone = await actions.undoImportAction({ undoToken: result.undoToken })
    expect(undone).toEqual({ ok: true, undone: true })

    const afterUndo = await holdingRows(binder.id)
    // La ligne préexistante retrouve exactement sa quantité d'origine.
    expect(afterUndo.find((row) => row.cardId === existing)?.qty).toBe(2)
    // La ligne créée par l'import disparaît.
    expect(afterUndo.find((row) => row.cardId === fresh)).toBeUndefined()
    // Le journal de l'import annulé disparaît aussi.
    expect(await db.select().from(importLists)).toHaveLength(0)
  })

  it('ne rejoue pas deux fois la même annulation', async () => {
    const { userId, collectionId } = await setup('doubleundoer')
    await insertCard({ name: 'Sol Ring' })
    const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'Trades' })

    const result = await actions.importListAction({ containerId: binder.id, text: '3 Sol Ring' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await actions.undoImportAction({ undoToken: result.undoToken })
    const second = await actions.undoImportAction({ undoToken: result.undoToken })
    expect(second).toEqual({ ok: true, undone: false })
    expect(await holdingRows(binder.id)).toHaveLength(0)
  })

  // ------------------------------------------------------- aller-retour

  it('aller-retour export → import sur un deck de 100 cartes', async () => {
    const { userId, collectionId } = await setup('roundtripper')

    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Commander deck',
      format: 'commander',
      deckState: 'plan',
    })

    // 100 exemplaires de mainboard. Chaque carte porte deux impressions au
    // catalogue, si bien que l'aller-retour ne peut réussir que si le set et
    // le numéro survivent au formatage puis à l'analyse.
    interface ExpectedHolding {
      qty: number
      zone: DeckZone
      isCommander: boolean
    }
    const expected = new Map<string, ExpectedHolding>()
    let copies = 0
    let index = 0
    while (copies < 100) {
      const qty = copies <= 75 && copies + 3 <= 100 ? 3 : 1
      const name = `Round Trip ${index}`
      const cardId = await insertCard({
        name,
        setCode: 'rt1',
        collectorNumber: String(index),
        priceEur: 1,
      })
      // Une seconde impression du même nom, moins chère : sans le set et le
      // numéro, la réimportation choisirait celle-ci.
      await insertCard({ name, setCode: 'rt2', collectorNumber: String(index), priceEur: 0.1 })

      await addHolding(
        userId,
        { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
        qty,
      )
      expected.set(cardId, { qty, zone: 'main', isCommander: false })
      copies += qty
      index += 1
    }
    expect(copies).toBe(100)

    // Un commandant et deux cartes de côté : la structure du deck fait partie
    // des « mêmes cartes » attendues après l'aller-retour. Sans en-tête de section
    // à l'export, ces trois exemplaires revenaient en `zone = 'main'` et le
    // commandant perdait son `is_commander` — un deck Commander réimporté
    // n'était alors plus le même deck.
    const commanderName = 'Round Trip Commander'
    const commanderId = await insertCard({
      name: commanderName,
      setCode: 'rt1',
      collectorNumber: 'c1',
      priceEur: 1,
    })
    await insertCard({ name: commanderName, setCode: 'rt2', collectorNumber: 'c1', priceEur: 0.1 })
    await addHolding(
      userId,
      {
        containerId: deck.id,
        cardId: commanderId,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        zone: 'commander',
      },
      1,
      { isCommander: true },
    )
    expected.set(commanderId, { qty: 1, zone: 'commander', isCommander: true })

    const sideName = 'Round Trip Sideboarder'
    const sideId = await insertCard({
      name: sideName,
      setCode: 'rt1',
      collectorNumber: 's1',
      priceEur: 1,
    })
    await insertCard({ name: sideName, setCode: 'rt2', collectorNumber: 's1', priceEur: 0.1 })
    await addHolding(
      userId,
      {
        containerId: deck.id,
        cardId: sideId,
        finish: 'nonfoil',
        condition: 'nm',
        language: 'en',
        zone: 'side',
      },
      2,
    )
    expected.set(sideId, { qty: 2, zone: 'side', isCommander: false })

    const exported = await actions.getContainerListAction({ containerId: deck.id })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const text = formatContainerList(exported.lines)
    // Une ligne de carte par holding, plus les trois en-têtes de section.
    const cardLines = text.split('\n').filter((line) => /^\d/.test(line))
    expect(cardLines).toHaveLength(expected.size)
    expect(text.split('\n')).toContain('Commander')
    expect(text.split('\n')).toContain('Deck')
    expect(text.split('\n')).toContain('Sideboard')

    const target = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Imported deck',
      format: 'commander',
      deckState: 'plan',
    })
    const imported = await actions.importListAction({ containerId: target.id, text })
    expect(imported).toMatchObject({ ok: true, imported: 103 })

    const rows = await holdingRows(target.id)
    expect(rows).toHaveLength(expected.size)
    for (const row of rows) {
      expect(expected.get(row.cardId)).toEqual({
        qty: row.qty,
        zone: row.zone,
        isCommander: row.isCommander,
      })
    }
  })

  // ---------------------------------------------------- partage public

  it('ne rend un container qu’une fois public, et ne projette aucune donnée privée', async () => {
    const { userId, collectionId } = await setup('publisher')
    const cardId = await insertCard({ name: 'Sol Ring', setCode: 'c21', collectorNumber: '263', priceEur: 2 })
    const deck = await createContainer(userId, collectionId, {
      kind: 'deck',
      name: 'Public deck',
      format: 'modern',
      deckState: 'plan',
    })
    await addHolding(
      userId,
      { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      2,
    )
    // Le même compte possède 4 autres exemplaires ailleurs : ils ne doivent
    // apparaître nulle part dans la projection.
    const root = await createContainer(userId, collectionId, { kind: 'binder', name: 'Stock' })
    await addHolding(
      userId,
      { containerId: root.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      4,
    )

    expect(await getPublicContainer(deck.id)).toBeNull()

    const flipped = await actions.setVisibilityAction({ containerId: deck.id, visibility: 'public' })
    expect(flipped).toEqual({ ok: true, visibility: 'public' })

    const published = await getPublicContainer(deck.id)
    expect(published).not.toBeNull()
    expect(published!.name).toBe('Public deck')
    expect(published!.ownerUsername).toBe('publisher')
    expect(published!.cards).toHaveLength(1)
    expect(published!.cards[0]!.qty).toBe(2)

    // La projection porte exactement les champs du contrat — ni un de plus,
    // ni l'email du propriétaire, ni une quantité possédée ailleurs.
    expect(Object.keys(published!).sort()).toEqual(
      [
        'cards',
        'coverArtist',
        'coverArtUrl',
        'coverGradient',
        'currency',
        'format',
        'id',
        'kind',
        'name',
        'ownerUsername',
        'status',
        'valueMinor',
      ].sort(),
    )
    expect(Object.keys(published!.cards[0]!).sort()).toEqual(
      [
        'collectorNumber',
        'manaCost',
        'name',
        'priceMinor',
        'qty',
        'setCode',
        'thumbUrl',
      ].sort(),
    )
    const serialised = JSON.stringify(published)
    expect(serialised).not.toContain('publisher@example.com')
    expect(serialised).not.toContain('legalities')
    expect(serialised).not.toContain('typeLine')

    // Repassé privé, la même lecture répond `null` — donc 404 côté page.
    await actions.setVisibilityAction({ containerId: deck.id, visibility: 'private' })
    expect(await getPublicContainer(deck.id)).toBeNull()
  })

  it('refuse de partager la collection racine', async () => {
    const { collectionId } = await setup('rootsharer')
    const [root] = await db
      .select({ id: containers.id })
      .from(containers)
      .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')))

    const result = await actions.setVisibilityAction({
      containerId: root!.id,
      visibility: 'public',
    })
    expect(result).toEqual({ ok: false, error: 'not_shareable' })
    expect(await getPublicContainer(root!.id)).toBeNull()
  })

  it('un editor ne peut pas publier ce que le owner n’a pas publié', async () => {
    const { userId: ownerId, collectionId } = await setup('ownerofdeck')
    const deck = await createContainer(ownerId, collectionId, {
      kind: 'deck',
      name: 'Owner deck',
      format: 'modern',
      deckState: 'plan',
    })

    const [editorRow] = await db
      .insert(users)
      .values({ email: 'editorofdeck@example.com', username: 'editorofdeck' })
      .returning({ id: users.id })
    const editorId = editorRow!.id
    await db
      .insert(collectionMembers)
      .values({ collectionId, userId: editorId, role: 'editor' })

    signIn(editorId, 'editorofdeck')
    const refused = await actions.setVisibilityAction({
      containerId: deck.id,
      visibility: 'public',
    })
    expect(refused).toEqual({ ok: false, error: 'not_owner' })
    expect(await getPublicContainer(deck.id)).toBeNull()

    // L'éditeur garde en revanche l'écriture de contenu : importer reste
    // permis, c'est une mutation de collection comme une autre.
    await insertCard({ name: 'Sol Ring' })
    const imported = await actions.importListAction({ containerId: deck.id, text: '1 Sol Ring' })
    expect(imported).toMatchObject({ ok: true })

    signIn(ownerId, 'ownerofdeck')
    const allowed = await actions.setVisibilityAction({
      containerId: deck.id,
      visibility: 'public',
    })
    expect(allowed).toEqual({ ok: true, visibility: 'public' })
  })
})
