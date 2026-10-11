// Trading mode, de bout en bout : un échange en personne mené pas à
// pas jusqu'à l'export et l'annulation, puis un échange entre deux
// comptes (offre, acceptation de démarrer, chaque côté, double acceptation).
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

// Étape « What do you give? » : ouvrir la collection et cocher une carte.
async function pickFromCollection(page: Page, cardName: string): Promise<void> {
  await page
    .locator('[data-trade-group="Collection"]')
    .getByRole('button', { name: /Collection/ })
    .first()
    .click()
  await page.getByRole('checkbox', { name: new RegExp(cardName) }).click()
  await expect(
    page.getByRole('checkbox', { name: new RegExp(cardName) }),
  ).toHaveAttribute('aria-checked', 'true')
}

test('an in-person trade goes through the wizard, applies, exports, then undoes', async ({
  page,
}) => {
  const run = Date.now().toString(36)
  const { email } = await signInWithFreshAccount(page, 'trade')
  const root = await rootContainerOf(email)
  const given = await seedCard(`Trade Given ${run}`, 4)
  const received = await seedCard(`Trade Received ${run}`, 3)
  await seedHolding(root, given, 2)

  // 1 · Who
  await page.goto('/tools/trade')
  await page.getByRole('button', { name: 'New trade' }).click()
  await expect(page).toHaveURL(/\/tools\/trade\/new$/)
  await page.getByLabel('Their name (optional)').fill('Sam')
  await page.getByRole('button', { name: 'Next: your cards' }).click()
  await expect(page).toHaveURL(/\/tools\/trade\/[0-9a-f-]{36}\?step=cards$/)
  const tradeUrl = page.url().replace(/\?step=cards$/, '')

  // 2 · Your cards
  await pickFromCollection(page, `Trade Given ${run}`)
  await expect(page.getByTestId('trade-step-footer')).toContainText('1 card')
  await page.getByTestId('trade-step-footer').getByRole('link', { name: 'Next' }).click()

  // 3 · Their cards
  await expect(page).toHaveURL(/step=theirs/)
  await page.getByPlaceholder('Search card name...').fill(`Trade Received ${run}`)
  await page
    .getByRole('button', { name: new RegExp(`Add Trade Received ${run}`) })
    .click()
  await expect(page.getByTestId('trade-compact-list')).toContainText(
    `Trade Received ${run}`,
  )
  await page.getByTestId('trade-step-footer').getByRole('link', { name: 'Next' }).click()

  // 4 · Cash & notes
  await expect(page).toHaveURL(/step=extras/)
  await page.getByRole('button', { name: 'Sam pays me' }).click()
  await page.getByLabel(/Amount/).fill('1')
  await page.getByLabel('Notes (optional)').fill('Sam brings the rest on Friday.')
  await page.getByRole('button', { name: 'Review the trade' }).click()

  // Résumé : 4 € donnés, 3 € + 1 € reçus.
  await expect(page).toHaveURL(tradeUrl)
  const balance = page.getByTestId('trade-balance')
  await expect(balance).toContainText('Even')
  await expect(balance).toContainText('€4.00')
  await expect(page.getByTestId('trade-zone-counterparty')).toContainText(
    'Cash, Sam pays you',
  )

  await page.getByRole('button', { name: 'Export the trade' }).click()
  await expect(page.getByTestId('trade-export-preview')).toContainText('+ €1.00 cash')
  await page.getByRole('button', { name: 'CSV' }).click()
  await expect(page.getByTestId('trade-export-preview')).toContainText('Giver,Count,Name')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Complete trade' }).click()
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Trade completed')
  await expect(page.getByRole('button', { name: 'Send the list to Sam' })).toBeVisible()
  expect(await qtyOf(root, given)).toBe(1)
  expect(await qtyOf(root, received)).toBe(1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('button', { name: 'Complete trade' })).toBeVisible()
  expect(await qtyOf(root, given)).toBe(2)
  expect(await qtyOf(root, received)).toBe(0)
})

test('a live trade: offer, acceptance to start, both sides, then both accept', async ({
  browser,
}) => {
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

  // Alice : avec qui, puis son offre.
  await alicePage.goto('/tools/trade/new')
  await alicePage.getByRole('button', { name: /A user of spellcache/ }).click()
  await alicePage.getByPlaceholder('Search a username...').fill(bob.username)
  await alicePage.getByRole('button', { name: bob.username }).click()
  await alicePage.getByRole('button', { name: 'Next: your cards' }).click()
  await pickFromCollection(alicePage, `Alice Card ${run}`)
  await alicePage
    .getByTestId('trade-step-footer')
    .getByRole('link', { name: 'Send offer' })
    .click()
  await expect(alicePage.getByTestId('trade-waiting')).toContainText(
    `Waiting for ${bob.username}`,
  )
  const tradeUrl = alicePage.url()

  // Bob voit l'offre, l'accepte et choisit ce qu'il donne.
  await bobPage.goto('/tools/trade')
  await bobPage.getByRole('link', { name: new RegExp(alice.username) }).click()
  await expect(
    bobPage.getByRole('heading', { name: `${alice.username} wants to trade` }),
  ).toBeVisible()
  await expect(bobPage.getByTestId('trade-compact-list')).toContainText(
    `Alice Card ${run}`,
  )
  await bobPage.getByRole('button', { name: 'Accept and pick' }).click()
  await expect(bobPage).toHaveURL(/step=cards/)
  await pickFromCollection(bobPage, `Bob Card ${run}`)
  await bobPage
    .getByTestId('trade-step-footer')
    .getByRole('link', { name: 'Next' })
    .click()
  await expect(bobPage).toHaveURL(/step=extras/)
  await bobPage.getByRole('button', { name: 'Review the trade' }).click()
  await expect(bobPage).toHaveURL(tradeUrl)

  // Alice voit le côté de Bob dans le résumé et accepte.
  await alicePage.reload()
  await expect(alicePage.getByTestId('trade-zone-counterparty')).toContainText(
    `Bob Card ${run}`,
  )
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
