// Parcours d'import CSV depuis l'accueil Collection, par le sélecteur de
// fichier comme sur un téléphone : destination existante, destination à
// créer, liste, et ce que l'accueil et un deck en chantier en retiennent.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { containers } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import {
  E2E_SET,
  manaboxCsv,
  openImportSheet,
  seedCard,
  signInWithFreshAccount,
  uniqueToken,
} from './collection-helpers'

// L'import résout chaque ligne contre le catalogue (complet sur une base de
// développement, ~120 000 cartes) puis écrit en une transaction : sous un
// serveur de dev chargé par les autres workers, l'écran de résultat dépasse
// le délai par défaut de 5 secondes, et un parcours à deux imports dépasse
// celui du test.
const IMPORT_TIMEOUT = 20_000
test.describe.configure({ timeout: 90_000 })

function csvFile(text: string) {
  return {
    name: 'manabox-export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  }
}

test('a CSV file imported into an existing binder lands there with its finish, condition and language', async ({
  page,
}) => {
  const { userId, collectionId } = await signInWithFreshAccount(page, 'csvbinder')
  const run = uniqueToken()
  const signet = await seedCard(`E2E Signet ${run}`, `${run}-1`, { priceEur: 2 })
  const tithe = await seedCard(`E2E Tithe ${run}`, `${run}-2`, { priceEur: 10 })
  const binder = await createContainer(userId, collectionId, {
    kind: 'binder',
    name: 'ManaBox',
  })

  await page.goto('/collection')
  const sheet = await openImportSheet(page)
  await sheet.locator('input[type="file"]').setInputFiles(
    csvFile(
      manaboxCsv([
        { card: signet, qty: 2 },
        { card: tithe, qty: 1, foil: true, condition: 'lightly_played', language: 'fr' },
      ]),
    ),
  )
  await sheet.getByLabel('Import into').selectOption({ label: 'Binder · ManaBox' })
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()

  await expect(sheet.getByText('3 cards imported')).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  })
  await expect(sheet.getByText('Into ManaBox', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Done' }).click()

  const binderRow = page.getByRole('main').getByRole('link', { name: /^ManaBox/ })
  await expect(binderRow).toContainText('3 cards')
  await expect(binderRow).not.toContainText('not in collection')

  await page.goto(`/container/${binder.id}`)
  await page.getByText(tithe.name).click()
  const cardSheet = page.getByRole('dialog', { name: tithe.name })
  await expect(cardSheet.getByText('×1')).toBeVisible()
  await expect(cardSheet.getByText('Foil', { exact: true })).toBeVisible()
  await expect(cardSheet.getByText('Lightly played')).toBeVisible()
  await expect(cardSheet.getByText('FR', { exact: true })).toBeVisible()
})

// Une carte importée dans un binder reste dans la collection : la ligne
// `All collection` de l'accueil la compte, une liste ne la compterait pas.
test('the All collection row of the home counts the cards just imported into a binder', async ({
  page,
}) => {
  const { userId, collectionId } = await signInWithFreshAccount(page, 'csvhome')
  const run = uniqueToken()
  const card = await seedCard(`E2E Home Card ${run}`, `${run}-1`, { priceEur: 1 })
  await createContainer(userId, collectionId, { kind: 'binder', name: 'Imports' })

  await page.goto('/collection')
  const sheet = await openImportSheet(page)
  await sheet
    .locator('input[type="file"]')
    .setInputFiles(csvFile(manaboxCsv([{ card, qty: 4 }])))
  await sheet.getByLabel('Import into').selectOption({ label: 'Binder · Imports' })
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()
  await expect(sheet.getByText('4 cards imported')).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  })
  await sheet.getByRole('button', { name: 'Done' }).click()

  await expect(
    page.getByRole('link', { name: /^All collection 4 cards · 1 unique/ }),
  ).toBeVisible()
})

test('New binder... and New list... destinations land under their own tab, and a list never adds to the collection', async ({
  page,
}) => {
  const { rootContainerId } = await signInWithFreshAccount(page, 'csvnewdest')
  const run = uniqueToken()
  const owned = await seedCard(`E2E Owned ${run}`, `${run}-1`)
  const wanted = await seedCard(`E2E Wanted ${run}`, `${run}-2`)

  await page.goto('/collection')
  let sheet = await openImportSheet(page)
  await sheet
    .locator('input[type="file"]')
    .setInputFiles(csvFile(manaboxCsv([{ card: owned, qty: 2 }])))
  await sheet.getByLabel('Import into').selectOption({ label: '+ New binder...' })
  await sheet.getByPlaceholder('Imported binder').fill('Fresh binder')
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()
  await expect(sheet.getByText('2 cards imported')).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  })
  await sheet.getByRole('button', { name: 'Done' }).click()

  const binderRow = page.getByRole('main').getByRole('link', { name: /^Fresh binder/ })
  await expect(binderRow).toContainText('2 cards')
  await expect(binderRow).not.toContainText('not in collection')

  sheet = await openImportSheet(page)
  await sheet
    .locator('input[type="file"]')
    .setInputFiles(csvFile(manaboxCsv([{ card: wanted, qty: 3 }])))
  await sheet.getByLabel('Import into').selectOption({ label: '+ New list...' })
  await sheet.getByPlaceholder('Imported list').fill('Fresh list')
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()
  await expect(sheet.getByText('3 cards imported')).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  })
  await sheet.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByRole('main').getByText('Fresh list')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lists', exact: true }).click()
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Fresh list/ }),
  ).toContainText('3 cards · not in collection')
  await expect(page.getByRole('main').getByText('Fresh binder')).toHaveCount(0)

  // La vue `All collection` couvre la racine et les binders, jamais une
  // liste : seule la carte du binder y figure.
  await page.goto(`/container/${rootContainerId}`)
  await expect(page.getByText(owned.name)).toBeVisible()
  await expect(page.getByText(wanted.name)).toHaveCount(0)
  await expect(page.locator('[data-virtual-item-key]')).toHaveCount(1)
})

// Des noms qu'aucune correspondance trigramme du catalogue complet ne peut
// rapprocher d'une vraie carte : les lignes restent `unknown`.
function unmatchableList(): string {
  return `2 ${randomUUID()}
1 ${randomUUID()}`
}

test('an import that matches nothing says so', async ({ page }) => {
  await signInWithFreshAccount(page, 'csvnothing')

  await page.goto('/collection')
  const sheet = await openImportSheet(page)
  await sheet.getByLabel('List to import').fill(unmatchableList())
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()

  await expect(
    sheet.getByText('Nothing in that list could be matched to the catalogue.'),
  ).toBeVisible({ timeout: IMPORT_TIMEOUT })
})

// La feuille ne crée la destination qu'une fois sûre que l'import écrira
// quelque chose : un échec ne laisse aucun binder vide derrière lui.
test('an import that matches nothing leaves no empty New binder behind', async ({
  page,
}) => {
  const { collectionId } = await signInWithFreshAccount(page, 'csvnobinder')

  await page.goto('/collection')
  const sheet = await openImportSheet(page)
  await sheet.getByLabel('List to import').fill(unmatchableList())
  await sheet.getByLabel('Import into').selectOption({ label: '+ New binder...' })
  await sheet.getByPlaceholder('Imported binder').fill('Should not exist')
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()
  await expect(
    sheet.getByText('Nothing in that list could be matched to the catalogue.'),
  ).toBeVisible({ timeout: IMPORT_TIMEOUT })

  const created = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.collectionId, collectionId),
        eq(containers.name, 'Should not exist'),
      ),
    )
  expect(created).toHaveLength(0)
})

test('importing the cards a planned deck needs into a binder turns its slots owned', async ({
  page,
}) => {
  const { userId, collectionId } = await signInWithFreshAccount(page, 'csvdeck')
  const run = uniqueToken()
  const ring = await seedCard(`E2E Ring ${run}`, `${run}-10`)
  const signet = await seedCard(`E2E Signet ${run}`, `${run}-11`)
  await createContainer(userId, collectionId, { kind: 'binder', name: 'Rocks' })
  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'Rock deck',
    format: 'commander',
    deckState: 'plan',
  })
  const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const
  await addHolding(userId, { containerId: deck.id, cardId: ring.id, ...nm }, 1)
  await addHolding(userId, { containerId: deck.id, cardId: signet.id, ...nm }, 1)

  await page.goto(`/decks/${deck.id}`)
  await expect(
    page.getByText(`${E2E_SET.toUpperCase()} #${run}-10 · not owned`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Infos', exact: true }).click()
  await expect(page.getByText('0 of 2 already in your collection')).toBeVisible()

  await page.goto('/collection')
  const sheet = await openImportSheet(page)
  await sheet.locator('input[type="file"]').setInputFiles(
    csvFile(
      manaboxCsv([
        { card: ring, qty: 1 },
        { card: signet, qty: 1 },
      ]),
    ),
  )
  await sheet.getByLabel('Import into').selectOption({ label: 'Binder · Rocks' })
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()
  await expect(sheet.getByText('2 cards imported')).toBeVisible({
    timeout: IMPORT_TIMEOUT,
  })

  await page.goto(`/decks/${deck.id}`)
  await expect(
    page.getByText(`${E2E_SET.toUpperCase()} #${run}-10 · owned ×1`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Infos', exact: true }).click()
  await expect(page.getByText('2 of 2 already in your collection')).toBeVisible()
  await expect(page.getByText('You own everything this deck needs.')).toBeVisible()
})
