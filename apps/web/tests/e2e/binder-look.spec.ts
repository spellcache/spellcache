// Parcours bout en bout de la feuille `Binder look`. Même patron que
// `tests/e2e/multi-select.spec.ts` : cycle de lien magique rejoué par
// test, écriture directe en base du binder et de sa carte faute d'écran de
// création de binder livré ailleurs.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-binder-look-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2ebinderlook')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

// Un binder d'une carte — assez pour exercer les états `None`/`Colour` de la
// feuille sans un écran d'ajout massif. Le mode `Card art` cherche dans tout
// le catalogue, pas seulement les cartes du binder —
// couvert par `tests/integration/` plutôt que ce parcours bout en bout.
async function seedBinderWithOneCard(email: string): Promise<{ binderId: string }> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [member] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!member) throw new Error(`No bootstrapped collection found for ${email}.`)

  const binder = await createContainer(user.id, member.collectionId, {
    kind: 'binder',
    name: 'E2E look binder',
  })

  const cardId = randomUUID()
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
      ${cardId}::uuid, gen_random_uuid(), 'Look Sheet Card', 'e2e', '1', 'common', 0, 'Creature',
      '{}', '{}', '{nonfoil,foil}', '{}'
    )
  `)
  await addHolding(user.id, { containerId: binder.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

  return { binderId: binder.id }
}

test('three mutually exclusive states, intensity, and Save look persists the chosen appearance', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { binderId } = await seedBinderWithOneCard(email)

  await page.goto(`/container/${binderId}`)
  await expect(page.getByRole('main').getByText('E2E look binder')).toBeVisible()

  // `Binder look` n'a plus de bouton propre dans l'en-tête : la palette a
  // été retirée, l'entrée du menu `···` était déjà le même chemin vers la
  // même feuille.
  await page.getByRole('button', { name: 'Binder actions' }).click()
  await page.getByRole('button', { name: 'Binder look' }).click()
  await expect(page.getByText('Binder look')).toBeVisible()

  // None : aucun contrôle en plus.
  await expect(page.getByRole('button', { name: 'None' })).toBeVisible()
  await expect(page.getByLabel('blue')).toHaveCount(0)

  // Le slider `Intensity` a été retiré (décision actée) — la
  // valeur en base reste (le défaut de colonne), l'UI ne l'expose plus.
  await expect(page.getByLabel('Intensity')).toHaveCount(0)

  // Colour : six pastilles, aucun sélecteur libre ni champ hexadécimal.
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  for (const key of ['blue', 'green', 'red', 'grey', 'gold', 'purple']) {
    await expect(page.getByLabel(key, { exact: true })).toBeVisible()
  }
  await expect(page.locator('input[type="text"][placeholder*="#"]')).toHaveCount(0)
  await page.getByLabel('green', { exact: true }).click()

  await page.getByRole('button', { name: 'Save look' }).click()
  await expect(page.getByText('Binder look')).toHaveCount(0)

  // La ligne d'accueil Compact reflète la nouvelle apparence sans
  // rechargement complet — navigation client normale, pas de `page.reload()`.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/collection/)
  await expect(page.getByRole('main').getByText('E2E look binder')).toBeVisible()
})

test('deleting a binder requires confirmation and moves its holdings to All collection', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { binderId } = await seedBinderWithOneCard(email)

  await page.goto(`/container/${binderId}`)
  await page.getByRole('button', { name: 'Binder actions' }).click()
  await page.getByRole('button', { name: 'Delete binder' }).click()

  // Le titre de la confirmation reprend le nom du binder (`ConfirmDialog`,
  // container-action-sheets.tsx).
  await expect(page.getByRole('heading', { name: 'Delete E2E look binder?' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(page).toHaveURL(/\/collection/)

  const [remaining] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, binderId))
    .limit(1)
  expect(remaining).toBeUndefined()
})
