// Trading mode, de bout en bout : un échange en personne conclu depuis
// l'écran, puis un échange entre deux comptes accepté de part et d'autre.
// Même patron que `life-tracker.spec.ts` : comptes neufs par lien magique,
// écriture directe en base pour amorcer ce que l'écran ne construit pas
// lui-même (l'outil activé, les cartes du catalogue et les holdings).
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { collectionMembers, containers, holdings, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(
  page: Page,
  prefix: string,
): Promise<{ email: string; username: string }> {
  const email = `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  await page.goto(await readMagicLink(email))
  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername(prefix)
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  await db.update(users).set({ toolTradingMode: true }).where(eq(users.email, email))
  return { email, username }
}

async function rootContainerOf(email: string): Promise<string> {
  const [row] = await db
    .select({ id: containers.id })
    .from(containers)
    .innerJoin(
      collectionMembers,
      eq(collectionMembers.collectionId, containers.collectionId),
    )
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .where(and(eq(users.email, email), eq(containers.kind, 'collection')))
    .limit(1)
  return row!.id
}

// Une carte au nom unique par run, avec son prix du jour en euros. Set
// `expansion` : la recherche du catalogue ne montre par défaut que les sets
// de sortie.
async function seedCard(name: string, eur: number): Promise<string> {
  const id = randomUUID()
  await db.execute(sql`
    insert into sets (code, name, card_count, set_type) values ('e2et', 'E2E trading set', 0, 'expansion')
    on conflict (code) do update set set_type = excluded.set_type
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${id}::uuid, gen_random_uuid(), ${name}, 'e2et', '1', 'rare', 0, 'Artifact', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into card_prices (card_id, day, eur) values (${id}::uuid, current_date, ${eur})
  `)
  return id
}

async function seedHolding(
  containerId: string,
  cardId: string,
  qty: number,
): Promise<void> {
  await db.insert(holdings).values({ containerId, cardId, qty })
}

async function qtyOf(containerId: string, cardId: string): Promise<number> {
  const rows = await db
    .select({ qty: holdings.qty })
    .from(holdings)
    .where(and(eq(holdings.containerId, containerId), eq(holdings.cardId, cardId)))
  return rows.reduce((sum, row) => sum + row.qty, 0)
}

test('an in-person trade swaps cards in the collection, then undoes', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  const { email } = await signInWithFreshAccount(page, 'trade')
  const root = await rootContainerOf(email)
  const given = await seedCard(`Trade Given ${run}`, 4)
  const received = await seedCard(`Trade Received ${run}`, 5)
  await seedHolding(root, given, 2)

  await page.goto('/tools/trade')
  await page.getByRole('button', { name: 'New trade' }).click()
  await page.getByLabel('Trade partner (optional)').fill('Sam')
  await page.getByRole('button', { name: 'Start trade' }).click()
  await expect(page).toHaveURL(/\/tools\/trade\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Sam' })).toBeVisible()

  await page.getByRole('button', { name: 'Add from your collection' }).click()
  await page.getByRole('button', { name: new RegExp(`Trade Given ${run}`) }).click()
  await expect(page.getByText('All in trade').or(page.getByText('1 left'))).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Add a card you get' }).click()
  await page.getByPlaceholder('Search card name...').fill(`Trade Received ${run}`)
  await page
    .getByRole('button', { name: new RegExp(`Trade Received ${run}`) })
    .first()
    .click()
  await page
    .getByRole('button', { name: new RegExp(`Trade Received ${run}`) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Add to trade' }).click()

  const balance = page.getByTestId('trade-balance')
  await expect(balance).toContainText('+€1.00')
  // Ce que je reçois, valorisé à 80 % : 5 € → 4 €, l'échange est à l'équilibre.
  await page
    .getByRole('group', { name: 'Value adjustment' })
    .last()
    .getByRole('button', { name: '80%' })
    .click()
  await expect(balance).toContainText('Even')

  await page.getByRole('button', { name: 'Complete trade' }).click()
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Trade completed')
  await expect(page.getByText(/^Completed /)).toBeVisible()
  expect(await qtyOf(root, given)).toBe(1)
  expect(await qtyOf(root, received)).toBe(1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('button', { name: 'Complete trade' })).toBeVisible()
  expect(await qtyOf(root, given)).toBe(2)
  expect(await qtyOf(root, received)).toBe(0)
})

test('a trade between two accounts applies once both accepted', async ({ browser }) => {
  const run = Date.now().toString(36)
  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()

  const alice = await signInWithFreshAccount(alicePage, 'tradea')
  const bob = await signInWithFreshAccount(bobPage, 'tradeb')
  const aliceRoot = await rootContainerOf(alice.email)
  const bobRoot = await rootContainerOf(bob.email)
  const aliceCard = await seedCard(`Alice Card ${run}`, 3)
  const bobCard = await seedCard(`Bob Card ${run}`, 3)
  await seedHolding(aliceRoot, aliceCard, 1)
  await seedHolding(bobRoot, bobCard, 1)

  await alicePage.goto('/tools/trade')
  await alicePage.getByRole('button', { name: 'New trade' }).click()
  await alicePage.getByRole('button', { name: 'With a user' }).click()
  await alicePage.getByPlaceholder('Search a username...').fill(bob.username)
  await alicePage.getByRole('button', { name: bob.username }).click()
  await alicePage.getByRole('button', { name: 'Start trade' }).click()
  await expect(alicePage).toHaveURL(/\/tools\/trade\/[0-9a-f-]{36}$/)
  const tradeUrl = alicePage.url()

  await alicePage.getByRole('button', { name: 'Add from your collection' }).click()
  await alicePage.getByRole('button', { name: new RegExp(`Alice Card ${run}`) }).click()
  await expect(alicePage.getByText('All in trade')).toBeVisible()
  await alicePage.keyboard.press('Escape')

  // Bob trouve l'échange dans sa liste et y met sa propre carte.
  await bobPage.goto('/tools/trade')
  await bobPage.getByRole('link', { name: new RegExp(alice.username) }).click()
  await expect(bobPage).toHaveURL(tradeUrl)
  await expect(bobPage.getByText(`Alice Card ${run}`)).toBeVisible()
  await bobPage.getByRole('button', { name: 'Add from your collection' }).click()
  await bobPage.getByRole('button', { name: new RegExp(`Bob Card ${run}`) }).click()
  await expect(bobPage.getByText('All in trade')).toBeVisible()
  await bobPage.keyboard.press('Escape')

  await alicePage.reload()
  await expect(alicePage.getByText(`Bob Card ${run}`)).toBeVisible()
  await alicePage.getByRole('button', { name: 'Accept trade' }).click()
  await alicePage.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(alicePage.getByTestId('trade-acceptance')).toContainText('You accepted')

  await bobPage.reload()
  await expect(bobPage.getByTestId('trade-acceptance')).toContainText(
    'accepted this version',
  )
  await bobPage.getByRole('button', { name: 'Accept and apply trade' }).click()
  await bobPage.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(bobPage.getByText(/^Completed /)).toBeVisible()

  expect(await qtyOf(aliceRoot, aliceCard)).toBe(0)
  expect(await qtyOf(aliceRoot, bobCard)).toBe(1)
  expect(await qtyOf(bobRoot, bobCard)).toBe(0)
  expect(await qtyOf(bobRoot, aliceCard)).toBe(1)

  // Alice voit la conclusion au prochain rafraîchissement automatique.
  await expect(alicePage.getByText(/^Completed /)).toBeVisible({ timeout: 10_000 })

  await aliceContext.close()
  await bobContext.close()
})
