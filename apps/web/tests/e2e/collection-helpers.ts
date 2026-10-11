// Montage partagé par les parcours de collection : compte neuf par lien
// magique, identité de sa collection, et catalogue minimal écrit en base.
//
// Noms et numéros de collection portent un jeton tiré par exécution : la
// base de développement peut porter un catalogue complet et les passages
// précédents, un nom fixe deviendrait ambigu au second passage et la ligne
// importée ne serait plus `resolved`.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, type Page } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

export interface CollectionIdentity {
  userId: string
  collectionId: string
  rootContainerId: string
}

export async function signInWithFreshAccount(
  page: Page,
  prefix: string,
): Promise<CollectionIdentity> {
  const email = `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  await page.goto(await readMagicLink(email))
  await expect(page).toHaveURL(/\/onboarding\/username/)
  await page.getByLabel('Username').fill(uniqueUsername(prefix))
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)
  const [member] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!member) throw new Error(`No collection for ${email}.`)
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.collectionId, member.collectionId),
        eq(containers.kind, 'collection'),
      ),
    )
    .limit(1)
  if (!root) throw new Error(`Collection ${member.collectionId} has no root container.`)

  return { userId: user.id, collectionId: member.collectionId, rootContainerId: root.id }
}

export interface SeededCard {
  id: string
  name: string
  setCode: string
  collectorNumber: string
}

// Un seul set pour tous les passages, comme le `e2e` des autres parcours :
// l'unicité vient du jeton porté par le nom et le numéro de collection, pas
// d'un set neuf par exécution qui encombrerait le catalogue de développement.
export const E2E_SET = 'e2ec'

export function uniqueToken(): string {
  return Math.random().toString(36).slice(2, 8)
}

export async function seedCard(
  name: string,
  collectorNumber: string,
  options: { oracleId?: string; priceEur?: number } = {},
): Promise<SeededCard> {
  const id = randomUUID()
  const setCode = E2E_SET
  await db.execute(sql`
    insert into sets (code, name, card_count) values (${setCode}, 'E2E collection set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${id}::uuid, ${options.oracleId ?? randomUUID()}::uuid, ${name}, ${setCode}, ${collectorNumber}, 'rare', 1, 'Artifact',
      '{}', '{}', '{nonfoil,foil}', '{"commander":"legal","modern":"legal"}')
  `)
  if (options.priceEur !== undefined) {
    await db.execute(sql`
      insert into card_prices (card_id, day, eur, eur_foil, usd, usd_foil)
      values (${id}::uuid, current_date, ${options.priceEur}, ${options.priceEur}, ${options.priceEur}, ${options.priceEur})
    `)
  }
  return { id, name, setCode, collectorNumber }
}

// La feuille charge ses destinations à l'ouverture (Server Action) et refuse
// l'import tant qu'elles ne sont pas arrivées : attendre CETTE réponse, la
// seule Server Action de l'écran appelée sans argument (corps `[]`), pas la
// première venue.
export async function openImportSheet(page: Page) {
  const destinationsLoaded = page.waitForResponse(
    (response) =>
      response.request().headers()['next-action'] !== undefined &&
      response.request().postData() === '[]',
  )
  await page.getByRole('button', { name: 'Import' }).click()
  await destinationsLoaded
  return page.getByRole('dialog', { name: 'Import & export' })
}

export function manaboxCsv(
  rows: Array<{
    card: SeededCard
    qty: number
    foil?: boolean
    condition?: string
    language?: string
  }>,
): string {
  const header =
    'Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Condition,Language'
  const lines = rows.map(
    ({ card, qty, foil, condition, language }) =>
      `Imported,binder,"${card.name}",${card.setCode.toUpperCase()},E2E,${card.collectorNumber},${foil ? 'foil' : 'normal'},rare,${qty},${condition ?? 'near_mint'},${language ?? 'en'}`,
  )
  return [header, ...lines].join('\r\n')
}
