// Parcours bout en bout de la barre de commande : appliquer un filtre depuis
// la feuille `Filters`, `Reset`, et copier l'URL d'une vue filtrée pour la
// reproduire dans un onglet neuf. Même patron que
// `tests/e2e/container-list.spec.ts` : cycle de lien magique rejoué par
// test, écriture directe en base faute d'écran d'ajout massif de cartes.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-command-bar-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2ecmdbar')
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

// Deux cartes de rareté différente (la feuille `Filters` doit pouvoir isoler
// l'une des deux) — pas de prix
// (`container_stats` à zéro suffit, seule la liste elle-même est exercée).
async function seedTwoCards(containerId: string): Promise<{ rareId: string; commonId: string }> {
  const rareId = randomUUID()
  const commonId = randomUUID()

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
      (${rareId}::uuid, gen_random_uuid(), 'Rare Command Bar Card', 'e2e', '1', 'rare', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'),
      (${commonId}::uuid, gen_random_uuid(), 'Common Command Bar Card', 'e2e', '2', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into holdings (id, container_id, card_id, qty, finish, condition, language)
    values
      (gen_random_uuid(), ${containerId}::uuid, ${rareId}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${containerId}::uuid, ${commonId}::uuid, 1, 'nonfoil', 'nm', 'en')
  `)
  await db.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    values (${containerId}::uuid, 2, 2, 0, 0, now())
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      computed_at = excluded.computed_at
  `)

  return { rareId, commonId }
}

test('applying the Rare chip in Filters narrows the list, and Reset restores it', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seedTwoCards(rootContainerId)

  await page.goto(`/container/${rootContainerId}`)
  await expect(page.getByText('Rare Command Bar Card')).toBeVisible()
  await expect(page.getByText('Common Command Bar Card')).toBeVisible()

  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('button', { name: 'Rare', exact: true }).click()
  await page.getByRole('button', { name: /^Show \d+ cards?$/ }).click()

  await expect(page).toHaveURL(/rarities=rare/)
  await expect(page.getByText('Rare Command Bar Card')).toBeVisible()
  await expect(page.getByText('Common Command Bar Card')).not.toBeVisible()

  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: /^Show \d+ cards?$/ }).click()

  await expect(page).not.toHaveURL(/rarities=rare/)
  await expect(page.getByText('Common Command Bar Card')).toBeVisible()
})

test('a filtered URL reproduces the same list and active chip when opened fresh', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seedTwoCards(rootContainerId)

  await page.goto(`/container/${rootContainerId}`)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('button', { name: 'Rare', exact: true }).click()
  await page.getByRole('button', { name: /^Show \d+ cards?$/ }).click()
  await expect(page).toHaveURL(/rarities=rare/)

  const filteredUrl = page.url()

  await page.goto(filteredUrl)
  await expect(page.getByText('Rare Command Bar Card')).toBeVisible()
  await expect(page.getByText('Common Command Bar Card')).not.toBeVisible()

  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByRole('button', { name: 'Rare', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

// Vérifié en base après manipulation, pas seulement à l'écran. `users.density`
// vaut `compact` par défaut (`packages/db/src/schema.ts`) et aucune Server Action de ce fichier n'écrit jamais cette colonne
// (`DensityPicker` ne fait que réécrire l'URL, `lib/view-state/parse.ts`) :
// changer la vue courante en `grid` doit laisser la préférence de compte
// intacte en base, pas seulement à l'écran.
test('the density picker changes the URL, never the account preference', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seedTwoCards(rootContainerId)

  const [before] = await db.select({ density: users.density }).from(users).where(eq(users.email, email)).limit(1)
  expect(before?.density).toBe('compact')

  await page.goto(`/container/${rootContainerId}`)
  await page.getByRole('button', { name: 'Grid' }).click()

  await expect(page).toHaveURL(/density=grid/)

  const [after] = await db.select({ density: users.density }).from(users).where(eq(users.email, email)).limit(1)
  expect(after?.density).toBe('compact')
})
