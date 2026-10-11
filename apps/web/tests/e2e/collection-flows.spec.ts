// Parcours courants sur la collection au format téléphone : ranger une carte
// dans un binder depuis sa fiche, modifier une quantité, et lire la vue
// `All collection` qui mêle le vrac et le contenu des binders.
import { expect, test } from '@playwright/test'

import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import { seedCard, signInWithFreshAccount, uniqueToken } from './collection-helpers'

const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const

test('moving a loose card into a binder from its card sheet keeps it in All collection and counts it in the binder', async ({
  page,
}) => {
  const { userId, collectionId, rootContainerId } = await signInWithFreshAccount(
    page,
    'flowmove',
  )
  const run = uniqueToken()
  const card = await seedCard(`E2E Mover ${run}`, `${run}-1`, { priceEur: 3 })
  const binder = await createContainer(userId, collectionId, {
    kind: 'binder',
    name: 'Destination',
  })
  await addHolding(userId, { containerId: rootContainerId, cardId: card.id, ...nm }, 2)

  await page.goto(`/container/${rootContainerId}`)
  await page.getByText(card.name).click()
  const cardSheet = page.getByRole('dialog', { name: card.name })
  await expect(cardSheet.getByText('No binder')).toBeVisible()
  await cardSheet.getByRole('button', { name: 'Edit' }).click()
  await page
    .getByRole('dialog', { name: card.name })
    .getByRole('button', { name: 'Binder No binder' })
    .click()
  // Attendre l'écriture avant de naviguer : la navigation annulerait sinon
  // la Server Action du déplacement.
  const moved = page.waitForResponse(
    (response) =>
      response.request().headers()['next-action'] !== undefined &&
      (response.request().postData() ?? '').includes(binder.id),
  )
  await page
    .getByRole('dialog', { name: 'Binder' })
    .getByText('Destination', { exact: true })
    .click()
  await moved

  await page.goto(`/container/${binder.id}`)
  await expect(page.getByText(card.name)).toBeVisible()

  // La vue racine couvre aussi les binders : la carte y reste, rattachée
  // désormais à son binder.
  await page.goto(`/container/${rootContainerId}`)
  await page.getByText(card.name).click()
  await expect(
    page.getByRole('dialog', { name: card.name }).getByText('Destination'),
  ).toBeVisible()

  await page.goto('/collection')
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Destination/ }),
  ).toContainText('2 cards')
})

test('a quantity changed on a phone survives a reload', async ({ page }) => {
  const { userId, collectionId } = await signInWithFreshAccount(page, 'flowqty')
  const run = uniqueToken()
  const card = await seedCard(`E2E Stepper ${run}`, `${run}-1`)
  const binder = await createContainer(userId, collectionId, {
    kind: 'binder',
    name: 'Steps',
  })
  await addHolding(userId, { containerId: binder.id, cardId: card.id, ...nm }, 1)

  await page.goto(`/container/${binder.id}`)
  const row = page.locator('[data-virtual-item-key]').first()
  await expect(row).toBeVisible()
  // Attendre la réponse de CETTE Server Action (d'autres partent au
  // chargement de l'écran) : un rechargement immédiat pourrait sinon
  // précéder l'écriture et ne rien prouver.
  const saved = page.waitForResponse(
    (response) =>
      response.request().headers()['next-action'] !== undefined &&
      (response.request().postData() ?? '').includes('"qty":2'),
  )
  await row.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Increase quantity').click()
  await expect(row).toContainText('×2')
  await saved

  await page.reload()
  await expect(page.locator('[data-virtual-item-key]').first()).toContainText('×2')
  await page.goto('/collection')
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Steps/ }),
  ).toContainText('2 cards')
})

test('All collection lists loose and binder cards together, and the binder filter narrows it to one binder', async ({
  page,
}) => {
  const { userId, collectionId, rootContainerId } = await signInWithFreshAccount(
    page,
    'flowroot',
  )
  const run = uniqueToken()
  const loose = await seedCard(`E2E Loose ${run}`, `${run}-1`)
  const filed = await seedCard(`E2E Filed ${run}`, `${run}-2`)
  const wanted = await seedCard(`E2E Wanted ${run}`, `${run}-3`)
  const binder = await createContainer(userId, collectionId, {
    kind: 'binder',
    name: 'Filed away',
  })
  const wishlist = await createContainer(userId, collectionId, {
    kind: 'list',
    name: 'Someday',
  })
  await addHolding(userId, { containerId: rootContainerId, cardId: loose.id, ...nm }, 1)
  await addHolding(userId, { containerId: binder.id, cardId: filed.id, ...nm }, 1)
  await addHolding(userId, { containerId: wishlist.id, cardId: wanted.id, ...nm }, 1)

  await page.goto(`/container/${rootContainerId}`)
  await expect(page.getByText(loose.name)).toBeVisible()
  await expect(page.getByText(filed.name)).toBeVisible()
  await expect(page.getByText(wanted.name)).toHaveCount(0)
  await expect(page.locator('[data-virtual-item-key]')).toHaveCount(2)

  await page.getByText(filed.name).click()
  await expect(
    page.getByRole('dialog', { name: filed.name }).getByText('Filed away'),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto(`/container/${rootContainerId}?binder=${binder.id}`)
  await expect(page.getByText(filed.name)).toBeVisible()
  await expect(page.getByText(loose.name)).toHaveCount(0)
  await expect(page.locator('[data-virtual-item-key]')).toHaveCount(1)
})
