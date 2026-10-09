// Écran Settings. Même patron que
// `tests/e2e/shelves.spec.ts`/`tests/e2e/binder-look.spec.ts` : cycle de
// lien magique rejoué par test (projet Playwright `unauthenticated`),
// écriture directe en base contre `process.env.DATABASE_URL` pour amorcer
// les scénarios que l'écran ne peut pas construire lui-même (un binder à
// habiller).
import { eq } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { createContainer } from '@/lib/containers/containers'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-settings-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2esettings')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findIdentity(email: string): Promise<{ userId: string; collectionId: string }> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [member] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!member) throw new Error(`No bootstrapped collection found for ${email}.`)

  return { userId: user.id, collectionId: member.collectionId }
}

// Basculer `Collection home` sur `Shelves`
// écrit `users.collection_style` et `/collection` rend la vue étagères au
// retour — vérifié par une navigation réelle (pas une assertion sur l'état
// client), puis par un rechargement complet de `/settings` pour prouver que
// la valeur tient sur le compte, pas seulement en mémoire de l'onglet.
test('switching Collection home to Shelves changes /collection and survives a reload', async ({
  page,
}) => {
  await signInWithFreshAccount(page)

  await page.goto('/settings')
  const collectionHomeGroup = page.getByRole('radiogroup', { name: 'Collection home' })
  await collectionHomeGroup.getByRole('radio', { name: 'Shelves' }).click()
  await expect(collectionHomeGroup.getByRole('radio', { name: 'Shelves' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // `aria-checked` ne reflète que la mise à jour optimiste, synchrone —
  // `updatePreferenceAction` (fire-and-forget côté `onClick`) peut encore
  // être en vol. Sans cette attente, `/collection` peut naviguer avant que
  // l'écriture n'ait atteint la base et lire l'ancienne valeur.
  await page.waitForLoadState('networkidle')

  await page.goto('/collection')
  // Style Shelves : le segmenté
  // `Collection | Lists`, propre au style Compact, a disparu du DOM.
  await expect(page.getByRole('button', { name: 'Lists' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New binder or list' })).toBeVisible()

  // Reconnexion simulée par un rechargement complet plutôt qu'une navigation
  // client : la valeur revient bien de `users.collection_style`, jamais
  // d'un état conservé côté navigateur (docs/development.md).
  await page.goto('/settings')
  await expect(
    page.getByRole('radiogroup', { name: 'Collection home' }).getByRole('radio', { name: 'Shelves' }),
  ).toHaveAttribute('aria-checked', 'true')
})

// `Currency` et `Price source` : les deux contrôles ne peuvent jamais
// afficher une combinaison incohérente — dérivés tous deux de
// `priceSource`.
test('Currency and Price source stay coupled to the same priceSource', async ({ page }) => {
  await signInWithFreshAccount(page)
  await page.goto('/settings')

  await page.getByLabel('Currency').selectOption('cardmarket_eur')
  await expect(page.getByLabel('Price source')).toHaveValue('cardmarket_eur')

  await page.getByLabel('Price source').selectOption('tcgplayer_usd')
  await expect(page.getByLabel('Currency')).toHaveValue('tcgplayer_usd')
})

// `Binder backdrops` (ligne `Artwork and tints` de Settings) à `off` neutralise le
// rendu, `on` restaure l'apparence enregistrée à l'identique.
test('Binder backdrops off hides a stored gradient row, on restores it', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const { userId, collectionId } = await findIdentity(email)

  const binder = await createContainer(userId, collectionId, { kind: 'binder', name: 'E2E gradient binder' })
  await db
    .update(containers)
    .set({ coverGradient: 'blue', coverIntensity: '0.6' })
    .where(eq(containers.id, binder.id))

  await page.goto('/collection')
  const binderRow = page.getByText('E2E gradient binder').locator('xpath=ancestor::a[1]')
  const styledBackground = await binderRow.evaluate((node) => getComputedStyle(node).backgroundImage)
  expect(styledBackground).not.toBe('none')

  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Artwork and tints' }).click()
  // Même piège que le test précédent : la bascule est optimiste, l'écriture
  // (`updatePreferenceAction`) n'est pas awaited par le clic lui-même.
  await page.waitForLoadState('networkidle')

  await page.goto('/collection')
  const nudeRow = page.getByText('E2E gradient binder').locator('xpath=ancestor::a[1]')
  await expect(nudeRow).toHaveCSS('background-image', 'none')

  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Artwork and tints' }).click()
  await page.waitForLoadState('networkidle')

  await page.goto('/collection')
  const restoredRow = page.getByText('E2E gradient binder').locator('xpath=ancestor::a[1]')
  const restoredBackground = await restoredRow.evaluate((node) => getComputedStyle(node).backgroundImage)
  expect(restoredBackground).not.toBe('none')
})
