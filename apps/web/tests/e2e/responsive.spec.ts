// Les trois dispositions : 375px, 1024px, 1440px, sans débordement horizontal
// du `body`.
//
// Ce que ce fichier vérifie tient en une phrase : à 375px il n'y a **aucun**
// élément de barre latérale dans le DOM (pas seulement masqué), à 1024px une
// barre latérale de 236px et pas de panneau, à 1440px les trois zones. Le
// même compte est rechargé à chaque largeur — pas de simple
// `setViewportSize` sur une page déjà hydratée : c'est le rendu serveur puis
// l'hydratation qui doivent être justes à chaque fois.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-responsive-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  await page.getByLabel('Username').fill(uniqueUsername('e2eresp'))
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
      and(
        eq(containers.collectionId, collectionMembers.collectionId),
        eq(containers.kind, 'collection'),
      ),
    )
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!root) throw new Error(`No bootstrapped collection found for ${email}.`)

  return root.rootContainerId
}

async function seed(containerId: string): Promise<void> {
  const ids = [randomUUID(), randomUUID()]

  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2er', 'E2E responsive set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values
      (${ids[0]}::uuid, gen_random_uuid(), 'Responsive Card One With A Deliberately Very Long Name', 'e2er', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'),
      (${ids[1]}::uuid, gen_random_uuid(), 'Responsive Card Two', 'e2er', '2', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into holdings (id, container_id, card_id, qty, finish, condition, language)
    values
      (gen_random_uuid(), ${containerId}::uuid, ${ids[0]}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${containerId}::uuid, ${ids[1]}::uuid, 1, 'nonfoil', 'nm', 'en')
  `)
  await db.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    values (${containerId}::uuid, 2, 2, 0, 0, now())
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      computed_at = excluded.computed_at
  `)
}

// Débordement horizontal : `document.body.scrollWidth` ne doit jamais
// dépasser la largeur visible du document.
async function expectNoHorizontalOverflow(page: Page) {
  const measured = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(measured.bodyScrollWidth).toBeLessThanOrEqual(measured.clientWidth)
  expect(measured.docScrollWidth).toBeLessThanOrEqual(measured.clientWidth)
}

test('375, 1024 and 1440 each render their own shell without horizontal overflow', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const rootContainerId = await findRootContainerId(email)
  await seed(rootContainerId)

  const sidebar = page.getByTestId('desktop-sidebar')
  const pane = page.getByTestId('preview-pane')

  // ── 375px — accueil mobile et barre d'onglets basse ────────────────────
  await page.setViewportSize({ width: 375, height: 812 })
  for (const url of ['/collection', `/container/${rootContainerId}`]) {
    await page.goto(url)
    await expect(page.locator('nav')).toBeVisible()
    // Aucun élément de barre latérale dans le DOM — pas seulement masqué.
    await expect(sidebar).toHaveCount(0)
    await expect(pane).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  }

  // ── 1024px — barre latérale, barre de commande sur une ligne, pas de
  //    panneau d'aperçu ────────────────────────────────────────────────
  await page.setViewportSize({ width: 1024, height: 900 })
  for (const url of ['/collection', `/container/${rootContainerId}`]) {
    await page.goto(url)
    await expect(sidebar).toHaveCount(1)
    expect((await sidebar.boundingBox())?.width).toBe(236)
    await expect(pane).toHaveCount(0)
    // La barre d'onglets basse a cédé la place.
    await expect(page.locator('nav a[href="/collection"]')).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
  }

  // À cette largeur la bascule `panel-right` n'a pas lieu d'être : le
  // panneau n'existe qu'au-delà de 1280px.
  await expect(page.getByRole('button', { name: 'Card preview pane' })).toHaveCount(0)

  // ── 1440px — les trois zones ──────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/container/${rootContainerId}`)
  await expect(sidebar).toHaveCount(1)
  await expect(pane).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Card preview pane' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/collection')
  await expect(sidebar).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
})
