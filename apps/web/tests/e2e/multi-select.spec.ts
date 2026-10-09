// Parcours bout en bout de la sélection groupée. Même patron que
// `tests/e2e/container-list.spec.ts` et `tests/e2e/command-bar.spec.ts` : cycle
// de lien magique rejoué par test, écriture directe en base des holdings faute
// d'écran d'ajout massif de cartes.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-multi-select-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2emultisel')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findRootContainerId(email: string): Promise<string> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [root] = await db
    .select({ rootContainerId: containers.id })
    .from(collectionMembers)
    .innerJoin(
      containers,
      and(eq(containers.collectionId, collectionMembers.collectionId), eq(containers.kind, 'collection')),
    )
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!root) throw new Error(`No bootstrapped collection found for ${email}.`)

  return root.rootContainerId
}

// Trois cartes (un appui long sélectionne une ligne, un appui simple sur une
// autre l'ajoute) — pas de prix,
// `container_stats` à zéro suffit pour l'écran.
async function seedThreeCards(containerId: string): Promise<{ ids: string[] }> {
  const ids = [randomUUID(), randomUUID(), randomUUID()]

  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values
      (${ids[0]}::uuid, gen_random_uuid(), 'Selection Card One', 'e2e', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'),
      (${ids[1]}::uuid, gen_random_uuid(), 'Selection Card Two', 'e2e', '2', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'),
      (${ids[2]}::uuid, gen_random_uuid(), 'Selection Card Three', 'e2e', '3', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into holdings (id, container_id, card_id, qty, finish, condition, language)
    values
      (gen_random_uuid(), ${containerId}::uuid, ${ids[0]}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${containerId}::uuid, ${ids[1]}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${containerId}::uuid, ${ids[2]}::uuid, 1, 'nonfoil', 'nm', 'en')
  `)
  await db.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    values (${containerId}::uuid, 3, 3, 0, 0, now())
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      computed_at = excluded.computed_at
  `)

  return { ids }
}

// Appui maintenu 500ms sans déplacement (seuil de temps, jamais un simple
// `dblclick`) — `mouse.down`/
// `wait`/`mouse.up` sur la boîte de la ligne, pas `locator.click()` qui ne
// laisse aucune prise sur la durée de l'appui.
async function longPress(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Row has no bounding box to long-press.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.up()
}

test('long-press enters selection, a tap adds a second row, Cancel exits and restores the tab bar', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seedThreeCards(rootContainerId)

  await page.goto(`/container/${rootContainerId}`)
  await expect(page.getByText('Selection Card One')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Collection' })).toBeVisible()

  const rows = page.locator('[data-virtual-item-key]')
  await longPress(page, rows.nth(0))

  await expect(page.getByText('1 selected')).toBeVisible()
  // La barre d'onglets est absente du DOM, pas seulement masquée.
  await expect(page.getByRole('link', { name: 'Collection' })).toHaveCount(0)

  await rows.nth(1).click()
  await expect(page.getByText('2 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('2 selected')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Collection' })).toBeVisible()
})

test('bulk edit applies a condition to the whole selection and Undo restores it', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seedThreeCards(rootContainerId)

  await page.goto(`/container/${rootContainerId}`)

  const rows = page.locator('[data-virtual-item-key]')
  await longPress(page, rows.nth(0))
  await rows.nth(1).click()
  await expect(page.getByText('2 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByText('Edit 2 cards')).toBeVisible()
  // Les puces d'état portent leur nom complet (`CONDITION_LABEL`).
  await page.getByRole('button', { name: 'Lightly played', exact: true }).click()
  await page.getByRole('button', { name: /^Apply to 2 cards$/ }).click()

  await expect(page.getByText(/2 cards updated/)).toBeVisible()
  await expect(page.getByText('Selection Card One')).toBeVisible()
  await expect(page.getByText('Selection Card Two')).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText(/2 cards updated/)).toHaveCount(0)
})
