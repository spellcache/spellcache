// Choix de l'édition d'une carte : depuis la fiche d'un résultat de recherche
// (c'est l'édition choisie qui est ajoutée) et depuis la feuille d'édition
// d'une carte possédée.
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'
import { and, eq, sql } from 'drizzle-orm'

import { formatMoney } from '@/lib/format/money'
import { addHolding } from '@/lib/containers/holdings'
import { db } from '@spellcache/db'
import { holdings } from '@spellcache/db/schema'

import { signInWithFreshAccount, uniqueToken, type SeededCard } from './collection-helpers'

// Set `expansion` : la recherche masque par défaut les sets sans type, comme
// celui de `seedCard`.
const PRINTINGS_SET = 'e2ep'

async function seedPrintings(name: string, prices: number[]): Promise<SeededCard[]> {
  await db.execute(sql`
    insert into sets (code, name, card_count, set_type) values (${PRINTINGS_SET}, 'E2E printings set', 0, 'expansion')
    on conflict (code) do nothing
  `)
  const oracleId = randomUUID()
  const run = uniqueToken()
  const printings: SeededCard[] = []
  for (const [index, price] of prices.entries()) {
    const id = randomUUID()
    const collectorNumber = `${run}-${index + 1}`
    await db.execute(sql`
      insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
      values (${id}::uuid, ${oracleId}::uuid, ${name}, ${PRINTINGS_SET}, ${collectorNumber}, 'rare', 1, 'Artifact',
        '{}', '{}', '{nonfoil,foil}', '{}')
    `)
    await db.execute(sql`
      insert into card_prices (card_id, day, eur, eur_foil, usd, usd_foil)
      values (${id}::uuid, current_date, ${price}, ${price}, ${price}, ${price})
    `)
    printings.push({ id, name, setCode: PRINTINGS_SET, collectorNumber })
  }
  return printings
}

const nm = { finish: 'nonfoil', condition: 'nm', language: 'en' } as const

test('a search result adds the edition picked in its card sheet', async ({ page }) => {
  const { rootContainerId } = await signInWithFreshAccount(page, 'editsearch')
  const name = `E2E Reprint ${uniqueToken()}`
  const printings = await seedPrintings(name, [2, 9])

  await page.goto('/search')
  await page.getByRole('searchbox').fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).first().click()

  const sheet = page.getByRole('dialog', { name: 'Add card' })
  const editionButton = sheet.getByRole('button', { name: 'Change edition' })
  const shown = (await editionButton.textContent()) ?? ''
  const target = printings.find((printing) => !shown.includes(`#${printing.collectorNumber}`))!
  const targetPrice = target === printings[0] ? 200 : 900

  await editionButton.click()
  const editions = page.getByRole('dialog', { name: 'Editions' })
  await expect(editions.getByRole('button', { name: new RegExp(name) })).toHaveCount(printings.length)
  await expect(editions.getByText('Current')).toHaveCount(1)
  await editions.getByRole('button', { name: new RegExp(`#${target.collectorNumber}`) }).click()

  await expect(editions).toBeHidden()
  await expect(editionButton).toContainText(`#${target.collectorNumber}`)
  await expect(sheet.getByText(formatMoney(targetPrice, 'eur'), { exact: true })).toBeVisible()

  await sheet.getByRole('button', { name: 'Add to collection' }).click()
  await expect(sheet).toBeHidden()

  const rows = await db
    .select({ cardId: holdings.cardId })
    .from(holdings)
    .where(eq(holdings.containerId, rootContainerId))
  expect(rows).toEqual([{ cardId: target.id }])
})

test('an owned card switches to another edition from its edit sheet', async ({ page }) => {
  const { userId, rootContainerId } = await signInWithFreshAccount(page, 'editowned')
  const name = `E2E Owned Reprint ${uniqueToken()}`
  const [owned, other] = await seedPrintings(name, [2, 9])
  const { holdingId } = await addHolding(
    userId,
    { containerId: rootContainerId, cardId: owned!.id, ...nm },
    2,
  )

  await page.goto(`/container/${rootContainerId}`)
  await page.getByText(name).click()
  await page.getByRole('dialog', { name }).getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog', { name }).getByRole('button', { name: 'Change edition' }).click()

  const editions = page.getByRole('dialog', { name: 'Editions' })
  await expect(
    editions.getByRole('button', { name: new RegExp(`#${owned!.collectorNumber}`) }),
  ).toContainText('Current')
  const saved = page.waitForResponse(
    (response) =>
      response.request().headers()['next-action'] !== undefined &&
      (response.request().postData() ?? '').includes(other!.id),
  )
  await editions.getByRole('button', { name: new RegExp(`#${other!.collectorNumber}`) }).click()
  await saved

  await expect(
    page.getByRole('dialog', { name }).getByRole('button', { name: 'Change edition' }),
  ).toContainText(`#${other!.collectorNumber}`)

  const [row] = await db
    .select({ cardId: holdings.cardId, qty: holdings.qty })
    .from(holdings)
    .where(and(eq(holdings.id, holdingId), eq(holdings.containerId, rootContainerId)))
  expect(row).toEqual({ cardId: other!.id, qty: 2 })
})
