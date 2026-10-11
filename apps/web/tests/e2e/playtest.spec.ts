// Playtest : bascule dans Settings, garde 404, puis une partie complète —
// mulligan de Londres, jeu d'une carte, tour suivant, reprise après
// rechargement. Même patron que `tests/e2e/deck-lifecycle.spec.ts` : cycle de
// lien magique rejoué par test, deck et cartes écrits directement en base.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { collectionMembers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-playtest-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  await page.getByLabel('Username').fill(uniqueUsername('e2eplaytest'))
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findAccount(email: string): Promise<{ userId: string; collectionId: string }> {
  const [row] = await db
    .select({ userId: users.id, collectionId: collectionMembers.collectionId })
    .from(users)
    .innerJoin(collectionMembers, eq(collectionMembers.userId, users.id))
    .where(eq(users.email, email))
    .limit(1)
  if (!row) throw new Error(`No bootstrapped account found for ${email}.`)
  return row
}

async function insertCard(id: string, name: string, typeLine: string): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values (
      ${id}::uuid, gen_random_uuid(), ${name}, 'e2e', '1', 'common', 1, ${typeLine},
      '{}', '{}', '{nonfoil}', '{}'
    )
  `)
}

// Deck de 20 cartes : 10 terrains, 10 créatures.
async function createTestDeck(email: string): Promise<string> {
  const { userId, collectionId } = await findAccount(email)
  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'E2E playtest deck',
    format: 'modern',
    deckState: 'plan',
  })
  for (const [name, typeLine] of [
    ['E2E Forest', 'Basic Land — Forest'],
    ['E2E Bear', 'Creature — Bear'],
  ] as const) {
    const cardId = randomUUID()
    await insertCard(cardId, name, typeLine)
    await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 10)
  }
  return deck.id
}

function handCount(page: Page) {
  return page.getByText(/^Hand · \d+$/)
}

test('the Settings switch turns Playtest on, and its routes answer 404 until then', async ({ page }) => {
  await signInWithFreshAccount(page)

  for (const path of ['/tools/playtest', `/tools/playtest/${randomUUID()}`]) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
  }

  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Playtest' }).click()
  await expect(page.getByRole('switch', { name: 'Playtest' })).toHaveAttribute('aria-checked', 'true')
  await page.waitForLoadState('networkidle')

  await page.goto('/tools')
  await page.getByRole('link', { name: /Playtest/ }).click()
  await expect(page).toHaveURL(/\/tools\/playtest$/)
  await expect(page.getByRole('heading', { name: 'Playtest', level: 1 })).toBeVisible()
})

test('a full game: mulligan, play a land, next turn, and resume after a reload', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  await db.update(users).set({ toolPlaytest: true }).where(eq(users.email, email))
  const deckId = await createTestDeck(email)

  await page.goto('/tools/playtest')
  await page.getByRole('link', { name: /E2E playtest deck/ }).click()
  await expect(page).toHaveURL(new RegExp(`/tools/playtest/${deckId}$`))

  await page.getByRole('button', { name: 'On the play' }).click()
  await expect(handCount(page)).toHaveText('Hand · 7')
  await expect(page.getByText('Library · 13')).toBeVisible()

  // Un mulligan, puis une carte sous la bibliothèque.
  await page.getByRole('button', { name: 'Mulligan' }).click()
  await expect(page.getByText('Mulligan 1')).toBeVisible()
  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByText('Put 1 on the bottom')).toBeVisible()
  await page.getByRole('button', { name: /^E2E (Forest|Bear)$/ }).first().click()

  // Tour 1 sans le jeu : pas de pioche.
  await expect(page.getByText('Turn 1 · on the play')).toBeVisible()
  await expect(handCount(page)).toHaveText('Hand · 6')
  await expect(page.getByText('Library · 14')).toBeVisible()

  await page.getByRole('button', { name: /^E2E (Forest|Bear)$/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Play', exact: true }).click()
  await expect(handCount(page)).toHaveText('Hand · 5')
  await expect(page.getByText(/^(Lands|Permanents) · 1$/)).toBeVisible()

  await page.getByRole('button', { name: 'Next turn' }).click()
  await expect(page.getByText('Turn 2 · on the play')).toBeVisible()
  await expect(handCount(page)).toHaveText('Hand · 6')

  // `sessionStorage` : la partie survit au rechargement.
  await page.reload()
  await expect(page.getByText('Turn 2 · on the play')).toBeVisible()
  await expect(handCount(page)).toHaveText('Hand · 6')
  await expect(page.getByText(/^(Lands|Permanents) · 1$/)).toBeVisible()

  await page.getByRole('button', { name: 'Game actions' }).click()
  await page.getByRole('button', { name: 'End game' }).click()
  await expect(page.getByRole('button', { name: 'On the play' })).toBeVisible()
})

test('the deck menu opens Playtest once the tool is on', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const deckId = await createTestDeck(email)

  await page.goto(`/decks/${deckId}`)
  await page.getByRole('button', { name: 'Deck actions' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Playtest/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await db.update(users).set({ toolPlaytest: true }).where(eq(users.email, email))
  await page.reload()
  await page.getByRole('button', { name: 'Deck actions' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Playtest/ }).click()
  await expect(page).toHaveURL(new RegExp(`/tools/playtest/${deckId}$`))
  await expect(page.getByRole('button', { name: 'On the play' })).toBeVisible()
})
