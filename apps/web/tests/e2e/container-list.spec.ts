// Écran de container. Même patron que `tests/e2e/collection-home.spec.ts` :
// cycle de lien magique rejoué par test (projet Playwright `unauthenticated`,
// un compte neuf reçoit toujours une collection vide), écriture directe en
// base contre `process.env.DATABASE_URL` faute d'écran d'ajout massif de
// cartes.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { addHolding } from '@/lib/containers/holdings'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-container-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2econt')
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
): Promise<{ userId: string; rootContainerId: string }> {
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

  return { userId: user.id, rootContainerId: root.rootContainerId }
}

// 1 000 cartes distinctes + 1 000 holdings (une carte par holding) via
// `generate_series` plutôt que 2 000 aller-retours
// individuels — même style que les fixtures de `apps/worker/src/import-bulk.ts`, pas
// un chemin d'écriture propre à ce test.
async function seedManyHoldings(containerId: string, count: number): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count)
    values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  // Les holdings ne portent que sur les cartes insérées ici (`returning`) :
  // les autres specs ajoutent elles aussi des cartes au set `e2e`, et un
  // `where set_code = 'e2e'` les rangerait dans ce container selon l'ordre
  // d'exécution des workers.
  await db.execute(sql`
    with inserted as (
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    select
      gen_random_uuid(),
      gen_random_uuid(),
      'E2E Card ' || lpad(n::text, 4, '0'),
      'e2e',
      n::text,
      'common',
      0,
      'Creature',
      '{}',
      '{}',
      '{nonfoil,foil}',
      '{}'
    from generate_series(1, ${count}) as n
    returning id
    )
    insert into holdings (id, container_id, card_id, qty, finish, condition, language)
    select gen_random_uuid(), ${containerId}::uuid, inserted.id, 1, 'nonfoil', 'nm', 'en'
    from inserted
  `)
  await db.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    select ${containerId}::uuid, count(*), count(*), 0, 0, now()
    from holdings
    where holdings.container_id = ${containerId}::uuid
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      computed_at = excluded.computed_at
  `)
}

test('a container of 1 000 holdings renders at most 40 rows and paginates without duplicates while scrolling', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { rootContainerId } = await findCollectionIdentity(email)
  await seedManyHoldings(rootContainerId, 1000)

  await page.goto(`/container/${rootContainerId}`)
  // « All collection » n'a plus de méta sous son titre : le total des
  // holdings se lit dans le compteur de la barre de commande.
  await expect(page.getByText('1,000 shown', { exact: true })).toBeVisible()

  const rows = page.locator('[data-virtual-item-key]')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThanOrEqual(40)

  const seenKeys = new Set<string>(await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-virtual-item-key') ?? ''),
  ))

  const scrollContainer = page.getByTestId('virtual-list-scroll')
  for (let i = 0; i < 8; i += 1) {
    await scrollContainer.evaluate((el) => el.scrollBy(0, el.clientHeight))
    await page.waitForTimeout(150)

    const keys = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-virtual-item-key') ?? ''),
    )
    // Aucun doublon d'`holdingId` visible à un instant donné.
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeLessThanOrEqual(40)
    for (const key of keys) seenKeys.add(key)
  }

  // La pagination a bien avancé : après plusieurs écrans de scroll, on a vu
  // plus de lignes distinctes que ce qu'une seule page (50) contient.
  expect(seenKeys.size).toBeGreaterThan(50)
})

test('incrementing a compact row updates the displayed quantity immediately', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)

  const cardId = randomUUID()
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${cardId}, ${randomUUID()}, 'Ponder', 'e2e', '1', 'common', 1, 'Sorcery', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await addHolding(
    userId,
    { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    1,
  )

  await page.goto(`/container/${rootContainerId}`)

  const row = page.locator('[data-virtual-item-key]').first()
  await expect(row).toBeVisible()
  await row.getByLabel('Increase quantity').click()

  await expect(row.getByText('2', { exact: true })).toBeVisible()
})

test('decrementing to zero removes the row and Undo restores it', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const { userId, rootContainerId } = await findCollectionIdentity(email)

  const cardId = randomUUID()
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${cardId}, ${randomUUID()}, 'Ponder', 'e2e', '1', 'common', 1, 'Sorcery', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await addHolding(
    userId,
    { containerId: rootContainerId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    1,
  )

  await page.goto(`/container/${rootContainerId}`)

  const row = page.locator('[data-virtual-item-key]').first()
  await expect(row).toBeVisible()
  await row.getByLabel('Decrease quantity').click()

  await expect(page.locator('[data-virtual-item-key]')).toHaveCount(0)
  await expect(page.getByText(/removed/)).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()

  await expect(page.locator('[data-virtual-item-key]')).toHaveCount(1)
  await expect(page.getByText('Ponder')).toBeVisible()
})
