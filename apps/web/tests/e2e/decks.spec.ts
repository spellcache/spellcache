// Écran `Decks`. Chaque test rejoue son propre cycle de lien magique (même
// patron que `collection-home.spec.ts`, projet Playwright `unauthenticated`) :
// un compte fraîchement connecté
// reçoit toujours une collection vide, ce qui isole ce test d'une mutation
// laissée par un run précédent sur un compte partagé.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { users } from '@spellcache/db/schema'
import { createContainer } from '@/lib/containers/containers'
import { addHolding, updateHolding } from '@/lib/containers/holdings'
import { db } from '@spellcache/db'
import { bootstrapCollection } from '@/lib/collections/bootstrap'
import { textArray } from '@spellcache/db/array-param'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-decks-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2edecks')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findUserId(email: string): Promise<string> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)
  return user.id
}

async function insertCard(
  id: string,
  name: string,
  options: { colorIdentity?: string[]; typeLine?: string; legalities?: Record<string, string> } = {},
): Promise<void> {
  const colorIdentity = options.colorIdentity ?? []
  const typeLine = options.typeLine ?? 'Creature — Human'
  const legalities = options.legalities ?? {}
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${id}, ${randomUUID()}, ${name}, 'e2e', ${id}, 'common', 0, ${typeLine}, '{}', ${textArray(colorIdentity)}, '{nonfoil}', ${JSON.stringify(legalities)}::jsonb)
  `)
}

test('creating a deck from the New deck sheet shows it without a page reload', async ({
  page,
}) => {
  await signInWithFreshAccount(page)

  // Collection neuve : l'onglet rend la vue étagères avec la seule
  // étagère `Unsorted`, vide, terminée par la tuile `New deck`.
  await page.goto('/decks')
  await expect(page.getByRole('group', { name: 'Unsorted decks' })).toBeVisible()

  await page.getByRole('button', { name: 'Add' }).click()
  const name = `Test deck ${Date.now()}`
  await page.getByLabel('Deck name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // Navigation immédiate vers le deck créé, qui
  // naît en `commander` (demande produit, 2026-09-06) : l'écran affiche
  // ce format, jamais `No format set`.
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('No format set')).toHaveCount(0)
  await expect(page.getByText('Commander', { exact: true }).first()).toBeVisible()
})

test('filtering on Needs work shows only decks in that bucket, with the active chip styling', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const { collectionId } = await bootstrapCollection(userId, { username: 'ignored', displayName: null })

  // Un deck Modern de 60 cartes, un deck sans format et un deck Commander
  // vide. Seul Commander a des règles vérifiées : le deck Commander vide
  // est le seul du panier « à corriger » (puce `Needs attention`), Modern
  // (`noRules`) n'appartient à aucun panier et le deck sans format a le
  // sien (`No format`).
  const legalDeck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'Legal Modern deck',
    format: 'modern',
    deckState: 'assemble',
  })
  const boltId = randomUUID()
  await insertCard(boltId, 'Lightning Bolt')
  await addHolding(
    userId,
    { containerId: legalDeck.id, cardId: boltId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    4,
  )
  const mountainId = randomUUID()
  await insertCard(mountainId, 'Mountain', { typeLine: 'Basic Land — Mountain' })
  await addHolding(
    userId,
    { containerId: legalDeck.id, cardId: mountainId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    56,
  )

  await createContainer(userId, collectionId, { kind: 'deck', name: 'No format deck', deckState: 'plan' })
  await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'Unfinished Commander deck',
    format: 'commander',
    deckState: 'plan',
  })

  await page.goto('/decks')
  await expect(page.getByText('Legal Modern deck')).toBeVisible()
  await expect(page.getByText('No format deck')).toBeVisible()
  await expect(page.getByText('Unfinished Commander deck')).toBeVisible()

  const needsWorkChip = page.getByRole('button', { name: 'Needs attention · 1' })
  const allChip = page.getByRole('button', { name: 'All', exact: true })

  // Au repos (`All` active), `Needs attention` porte le fond et la bordure
  // de repos de toutes les puces (`surface-1` + `border`).
  await expect(allChip).toHaveAttribute('aria-pressed', 'true')
  await expect(needsWorkChip).toHaveAttribute('aria-pressed', 'false')
  await expect(needsWorkChip).toHaveCSS('background-color', 'rgb(20, 18, 26)')
  await expect(needsWorkChip).toHaveCSS('border-color', 'rgba(255, 255, 255, 0.05)')

  await needsWorkChip.click()

  await expect(page.getByText('Unfinished Commander deck')).toBeVisible()
  await expect(page.getByText('No format deck')).toHaveCount(0)
  await expect(page.getByText('Legal Modern deck')).toHaveCount(0)
  await expect(needsWorkChip).toHaveAttribute('aria-pressed', 'true')

  // La puce active porte le fond et la bordure d'état actif
  // (`accent-bg` + `border-accent-subtle`) — pas seulement `aria-pressed`.
  // `All`, désormais inactive, repasse à son propre fond/bordure de repos.
  await expect(needsWorkChip).toHaveCSS('background-color', 'rgb(34, 28, 18)')
  await expect(needsWorkChip).toHaveCSS('border-color', 'rgba(232, 180, 74, 0.45)')
  await expect(allChip).toHaveAttribute('aria-pressed', 'false')
  await expect(allChip).toHaveCSS('background-color', 'rgb(20, 18, 26)')
  await expect(allChip).toHaveCSS('border-color', 'rgba(255, 255, 255, 0.05)')
})

test('a deck with a commander shows its color identity pips and navigates to its planning screen', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const { collectionId } = await bootstrapCollection(userId, { username: 'ignored', displayName: null })

  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'Krenko Goblins',
    format: 'commander',
    deckState: 'plan',
  })
  const commanderId = randomUUID()
  await insertCard(commanderId, 'Krenko, Mob Boss', { colorIdentity: ['R'] })
  const { holdingId } = await addHolding(
    userId,
    { containerId: deck.id, cardId: commanderId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    1,
  )
  await updateHolding(userId, holdingId, { isCommander: true })

  await page.goto('/decks')
  await expect(page.getByText('Krenko Goblins')).toBeVisible()

  await page.getByText('Krenko Goblins').click()
  // Le deck ouvre son écran de préparation propre (`/decks/[id]`), pas
  // l'écran de container générique.
  await expect(page).toHaveURL(new RegExp(`/decks/${deck.id}`))
})
