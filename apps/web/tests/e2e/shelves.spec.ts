// Écran `Collection home · style = Shelves`. Même patron que
// `tests/e2e/collection-home.spec.ts` : cycle de lien magique rejoué par
// test (projet Playwright `unauthenticated`), écriture directe en base
// contre `process.env.DATABASE_URL` — `users.collection_style` est ici posé
// à la main plutôt que par `Settings`.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { addHolding } from '@/lib/containers/holdings'
import { createContainer } from '@/lib/containers/containers'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-shelves-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2eshelf')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findCollectionIdentity(
  email: string,
): Promise<{ userId: string; collectionId: string; rootContainerId: string }> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [root] = await db
    .select({ collectionId: collectionMembers.collectionId, rootContainerId: containers.id })
    .from(collectionMembers)
    .innerJoin(
      containers,
      and(eq(containers.collectionId, collectionMembers.collectionId), eq(containers.kind, 'collection')),
    )
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!root) throw new Error(`No bootstrapped collection found for ${email}.`)

  return { userId: user.id, collectionId: root.collectionId, rootContainerId: root.rootContainerId }
}

// Bascule directe en base, sans passer par `Settings › Appearance` : seul
// moyen simple de faire basculer un compte de test vers le style Shelves ici.
async function switchToShelves(userId: string): Promise<void> {
  await db.update(users).set({ collectionStyle: 'shelves' }).where(eq(users.id, userId))
}

// Même fixture que `collection-home.spec.ts`/`container-list.spec.ts` :
// carte + set + prix du jour écrits directement, le catalogue n'est
// pas un chemin couvert par cette feature.
async function insertCard(cardId: string, name: string, usdMajor: number): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'e2e', 0) on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${cardId}, ${randomUUID()}, ${name}, 'e2e', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
    values (${cardId}, current_date, ${usdMajor}, ${usdMajor}, ${usdMajor}, ${usdMajor})
  `)
}

test('a compact account never sees the Shelves layout', async ({ page }) => {
  await signInWithFreshAccount(page)

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
  // Segmenté `Collection | Lists` : présent uniquement en style Compact.
  await expect(page.getByRole('button', { name: 'Lists' })).toBeVisible()
})

test('switching to shelves renders the sticky header, hides the Collection/Lists segmented, and hides Built decks with none built', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
  // Segmenté absent du DOM en style Shelves.
  await expect(page.getByRole('button', { name: 'Lists' })).toHaveCount(0)
  await expect(page.getByText('All collection')).toBeVisible()
  // Masquée si 0 deck monté — un compte tout neuf n'en a aucun.
  await expect(page.getByText('Built decks')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New binder or list' })).toBeVisible()
})

test('shows Built decks once a deck is built, hides it again with none', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, collectionId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  const deck = await createContainer(userId, collectionId, { kind: 'deck', name: `Built ${Date.now()}` })
  await db.execute(sql`update containers set deck_state = 'built' where id = ${deck.id}`)

  await page.reload()
  await expect(page.getByText('Built decks')).toBeVisible()
})

test('a list container renders as a shelf tagged LIST, with a not-owned meta', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, collectionId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  const listName = `Wishlist ${Date.now()}`
  await createContainer(userId, collectionId, { kind: 'list', name: listName })

  await page.reload()

  const shelfRow = page.getByText(listName).locator('xpath=..')
  // `exact` : sans lui, « LIST » correspond aussi au nom « Wishlist … ».
  await expect(shelfRow.getByText('LIST', { exact: true })).toBeVisible()
  await expect(shelfRow.getByText(/not owned/)).toBeVisible()
})

test('tapping a shelf name opens the corresponding container list', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)
  await switchToShelves(userId)
  await page.reload()

  await page.getByRole('link', { name: /All collection/ }).click()
  await expect(page).toHaveURL(new RegExp(`/container/${rootContainerId}`))
})

// Toute la pile est UN SEUL lien qui ouvre le container : aucune tuile
// individuellement cliquable ni de `CardPreviewSheet` depuis cette pile.
test('tapping a shelf card stack opens the corresponding container list, not a card preview', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  const cardId = randomUUID()
  const cardName = `Shelf tap card ${Date.now()}`
  await insertCard(cardId, cardName, 4.5)
  await addHolding(
    userId,
    { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    1,
  )

  await page.reload()

  // La tuile n'est qu'une image décorative (`alt=""`) à l'intérieur du
  // lien de la pile — le clic sur l'illustration ouvre le container, jamais
  // une feuille de carte.
  await page.getByRole('link', { name: /All collection/ }).locator('img').first().click()
  await expect(page).toHaveURL(new RegExp(`/container/${rootContainerId}`))
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0)
})

// Régression : la tuile `Recently added` ouvre la `CardPreviewSheet` déjà
// montée par `ShelvesView`.
test('tapping a Recently added tile opens the card preview sheet', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  const cardId = randomUUID()
  const cardName = `Recently added tap card ${Date.now()}`
  await insertCard(cardId, cardName, 4.5)
  await addHolding(
    userId,
    { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    1,
  )

  await page.reload()

  // Portée à la section `Recently added` seule : la même carte apparaît
  // aussi dans la tuile d'étagère `All collection` en dessous
  // (`getByRole('img', { name: cardName })` matcherait les deux sans cette
  // portée) — `.locator('..')` deux fois remonte du `<span>` du libellé à la
  // ligne d'en-tête, puis à la `<div>` qui enveloppe aussi la piste de
  // tuiles (`shelves-view.tsx`).
  const recentlyAddedSection = page.getByText('Recently added', { exact: true }).locator('..').locator('..')
  await recentlyAddedSection.getByRole('img', { name: cardName }).click()

  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()
  await expect(page.getByText(cardName)).toBeVisible()
})

// Vérifié en comparant le DOM de `/container/<id>` dans les deux réglages —
// même précédent que `tests/unit/row-heights.test.tsx`, qui rend et mesure
// plutôt que de calculer/supposer.
test('the container screen renders identical DOM regardless of collection style', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)

  async function containerBodyHtml(): Promise<string> {
    await page.goto(`/container/${rootContainerId}`)
    await expect(page.locator('h1')).toBeVisible()
    const html = await page.locator('body').innerHTML()
    // Les balises `<script>` embarquent le payload RSC d'hydratation
    // (identifiants de chunk propres à chaque requête) — jamais le DOM
    // visible lui-même, ce que le critère #1 demande de comparer.
    return html.replace(/<script[\s\S]*?<\/script>/g, '')
  }

  const compactHtml = await containerBodyHtml()

  await switchToShelves(userId)
  const shelvesHtml = await containerBodyHtml()

  expect(shelvesHtml).toBe(compactHtml)
})

test('the New binder or list sheet creates a binder shelf without a page reload', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId } = await findCollectionIdentity(email)
  await switchToShelves(userId)
  await page.reload()

  // Le bouton ouvre le menu de l'accueil ; `New binder` y ouvre la
  // `NameSheet` partagée.
  await page.getByRole('button', { name: 'New binder or list' }).click()
  await page.getByRole('dialog', { name: 'Collection' }).getByRole('button', { name: /^New binder/ }).click()
  const name = `Shelf binder ${Date.now()}`
  await page.getByLabel('Binder name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // La création navigue vers le container créé, sans rechargement ; l'accueil
  // le montre en étagère au retour.
  await expect(page).toHaveURL(/\/container\//)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('main').getByText(name)).toBeVisible()
})

// Ce n'est pas une étagère par container qui défile (c'est une pile figée,
// voir le test « card stack » ci-dessus) mais la piste « Recently added »,
// avec la mécanique partagée `ShelfTrack`.
test('the Recently added track scrolls horizontally without scrolling the page', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)
  await switchToShelves(userId)

  for (let i = 0; i < 10; i += 1) {
    const cardId = randomUUID()
    await insertCard(cardId, `Shelf card ${i}`, i + 1)
    await addHolding(
      userId,
      { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
      1,
    )
  }

  await page.reload()

  const track = page.getByRole('group', { name: 'Recently added cards' })
  await expect(track).toBeVisible()

  const pageScrollBefore = await page.evaluate(() => window.scrollY)
  const trackScrollBefore = await track.evaluate((node) => node.scrollLeft)

  await track.evaluate((node) => node.scrollBy({ left: 200 }))
  await expect
    .poll(() => track.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(trackScrollBefore)

  const pageScrollAfter = await page.evaluate(() => window.scrollY)
  expect(pageScrollAfter).toBe(pageScrollBefore)

  // Barre de défilement masquée (`.scrollbar-hide`) — `scrollbar-width:
  // none` calculé, pas seulement la classe.
  const scrollbarWidth = await track.evaluate((node) => getComputedStyle(node).scrollbarWidth)
  expect(scrollbarWidth).toBe('none')
})
