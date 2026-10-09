// Parcours desktop bout en bout. Même patron que
// `tests/e2e/multi-select.spec.ts` : cycle de lien magique rejoué par test et
// écriture directe en base des holdings, faute d'écran d'ajout massif.
//
// La fenêtre est surchargée à 1440×900 — `playwright.config.ts` épingle
// 390×844 pour toutes les autres specs, qui décrivent la coquille mobile.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

test.use({ viewport: { width: 1440, height: 900 } })

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-desktop-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  await page.getByLabel('Username').fill(uniqueUsername('e2edesk'))
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

interface Fixture {
  collectionId: string
  rootContainerId: string
}

async function findCollection(email: string): Promise<Fixture> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [root] = await db
    .select({ collectionId: collectionMembers.collectionId, rootContainerId: containers.id })
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

  return root
}

// Trois cartes du même set, deux impressions supplémentaires partageant
// l'`oracle_id` de la première (pour le bloc `Other printings` du panneau),
// un binder et un dossier de decks (pour le sous-arbre de la barre
// latérale).
async function seed(fixture: Fixture): Promise<void> {
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  const reprints = [randomUUID(), randomUUID()]
  const sharedOracle = randomUUID()

  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2ed', 'E2E desktop set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities, oracle_text
    )
    values
      (${ids[0]}::uuid, ${sharedOracle}::uuid, 'Desktop Card Alpha', 'e2ed', '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}', 'Alpha rules text.'),
      (${ids[1]}::uuid, gen_random_uuid(), 'Desktop Card Bravo', 'e2ed', '3', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}', 'Bravo rules text.'),
      (${ids[2]}::uuid, gen_random_uuid(), 'Desktop Card Charlie', 'e2ed', '4', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}', 'Charlie rules text.'),
      (${reprints[0]}::uuid, ${sharedOracle}::uuid, 'Desktop Card Alpha', 'e2ed', '5', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}', 'Alpha rules text.'),
      (${reprints[1]}::uuid, ${sharedOracle}::uuid, 'Desktop Card Alpha', 'e2ed', '6', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}', 'Alpha rules text.')
  `)
  await db.execute(sql`
    insert into holdings (id, container_id, card_id, qty, finish, condition, language)
    values
      (gen_random_uuid(), ${fixture.rootContainerId}::uuid, ${ids[0]}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${fixture.rootContainerId}::uuid, ${ids[1]}::uuid, 1, 'nonfoil', 'nm', 'en'),
      (gen_random_uuid(), ${fixture.rootContainerId}::uuid, ${ids[2]}::uuid, 1, 'nonfoil', 'nm', 'en')
  `)
  await db.execute(sql`
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    values (${fixture.rootContainerId}::uuid, 3, 3, 0, 0, now())
    on conflict (container_id) do update set
      card_count = excluded.card_count,
      unique_count = excluded.unique_count,
      computed_at = excluded.computed_at
  `)
  // Avec sa ligne `container_stats`, comme tout container créé par
  // `createContainer` : l'accueil et l'écran du binder la joignent.
  await db.execute(sql`
    with binder as (
      insert into containers (id, collection_id, kind, name, sort_order)
      values (gen_random_uuid(), ${fixture.collectionId}::uuid, 'binder', 'Desktop Trade Binder', 1)
      returning id
    )
    insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
    select id, 0, 0, 0, 0, now() from binder
  `)
  await db.execute(sql`
    insert into deck_folders (id, collection_id, name, position)
    values (gen_random_uuid(), ${fixture.collectionId}::uuid, 'Desktop Folder', 0)
  `)
}

async function openContainer(page: Page, fixture: Fixture): Promise<Locator> {
  await page.goto(`/container/${fixture.rootContainerId}`)
  await expect(page.getByText('Desktop Card Alpha').first()).toBeVisible()
  return page.locator('[data-virtual-item-key]')
}

// Les lignes réellement cochées (coche blanche dans la case ronde de 18px).
// Enfant direct de la ligne, pour ne pas confondre avec les pastilles de coût
// de mana rendues plus bas dans la même ligne. Le compteur `N selected` et ce
// décompte doivent toujours coïncider : regarder le seul texte du compteur ne
// suffit pas.
function tickedRows(page: Page): Locator {
  return page.locator('[data-virtual-item-key] > div > span[aria-hidden="true"] > svg')
}

test('at 1440 the three zones are present, the tab bar is gone, and no dialog opens on select', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)

  // Zone 1 — la barre latérale, 236px.
  const sidebar = page.getByTestId('desktop-sidebar')
  await expect(sidebar).toHaveCount(1)
  expect((await sidebar.boundingBox())?.width).toBe(236)

  // La barre d'onglets basse a disparu du DOM : une seule navigation
  // principale à cette largeur, jamais deux jeux de liens concurrents.
  await expect(page.locator('nav a[href="/collection"]')).toHaveCount(1)

  // Zone 2 — la barre de commande sur une ligne, avec sa bascule de
  // panneau (absente sous 1280px).
  await expect(page.getByRole('button', { name: 'Card preview pane' })).toBeVisible()

  // Zone 3 — le panneau d'aperçu.
  await expect(page.getByTestId('preview-pane')).toBeVisible()

  // Sélectionner une ligne remplit le panneau **sans** modale.
  await rows.nth(0).click()
  await expect(page.getByTestId('preview-pane').getByText('Alpha rules text.')).toBeVisible()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('arrow keys walk the list and the pane follows', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)
  const pane = page.getByTestId('preview-pane')

  await rows.nth(0).click()
  await expect(pane.getByText('Alpha rules text.')).toBeVisible()

  await page.keyboard.press('ArrowDown')
  await expect(pane.getByText('Bravo rules text.')).toBeVisible()

  await page.keyboard.press('ArrowDown')
  await expect(pane.getByText('Charlie rules text.')).toBeVisible()

  await page.keyboard.press('ArrowUp')
  await expect(pane.getByText('Bravo rules text.')).toBeVisible()

  // Les flèches n'ont pas fait défiler la page elle-même : le shell desktop
  // tient dans la fenêtre, le défilement vertical du document reste à zéro.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('editing the quantity in the pane updates the row and survives a reload', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)
  await rows.nth(0).click()

  const pane = page.getByTestId('preview-pane')
  await expect(pane.getByText('Alpha rules text.')).toBeVisible()

  const rowStepper = rows.nth(0).locator('[data-holding-id]')
  await expect(rowStepper).toContainText('1')

  await pane.getByRole('button', { name: 'Increase quantity' }).click()
  await expect(rowStepper).toContainText('2')

  await page.reload()
  await expect(page.getByText('Desktop Card Alpha').first()).toBeVisible()
  await expect(page.locator('[data-virtual-item-key]').nth(0).locator('[data-holding-id]')).toContainText('2')
})

test('turning the pane off gives the list the full width and brings back the card sheet', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)
  await expect(page.getByTestId('preview-pane')).toHaveCount(1)

  await page.getByRole('button', { name: 'Card preview pane' }).click()
  await expect(page.getByTestId('preview-pane')).toHaveCount(0)

  // Panneau éteint : la ligne rouvre la feuille de carte mobile — une
  // modale Radix, donc un `role="dialog"`.
  await rows.nth(0).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(1)
  await expect(page.locator('[role="dialog"]').getByText('Alpha rules text.')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  // La bascule et la préférence de Settings pilotent la même valeur :
  // rechargement puis lecture de la ligne `Card preview pane`.
  await page.reload()
  await expect(page.getByTestId('preview-pane')).toHaveCount(0)

  await page.goto('/settings')
  await expect(page.getByRole('switch', { name: 'Card preview pane' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

// `Add to deck` et `Binder` du panneau rendent binder et deck éditables sur
// place. Ils entrent dans la **même** `BulkEditSheet` que les boutons de la
// barre de sélection, sur la seule ligne courante — pas un second flux.
test('the pane moves the current card to a binder through the bulk edit sheet', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)
  const pane = page.getByTestId('preview-pane')

  await rows.nth(0).click()
  await expect(pane.getByText('Alpha rules text.')).toBeVisible()

  await pane.getByRole('button', { name: 'Move to binder' }).click()

  // La feuille d'édition groupée, visant la seule ligne du panneau — d'où « 1 card »,
  // et non le compteur d'une sélection.
  const sheet = page.getByRole('dialog', { name: 'Edit 1 card' })
  await expect(sheet).toBeVisible()
  // `destinationKind = 'binder'` : la ligne de destination s'appelle
  // `Binder`, pas `Destination`. Elle ouvre la `PickerSheet` partagée.
  await sheet.getByRole('button', { name: 'Binder No binder' }).click()
  const picker = page.getByRole('dialog', { name: 'Move 1 card' })
  await picker.getByRole('button', { name: /^Desktop Trade Binder/ }).click()
  await expect(sheet.getByRole('button', { name: 'Binder Desktop Trade Binder' })).toBeVisible()

  await sheet.getByRole('button', { name: 'Apply to 1 card' }).click()

  await expect(page.getByText('1 card updated')).toBeVisible()

  // « All collection » montre aussi les cartes rangées dans un binder
  // (`resolveContainerScope`) : la ligne y reste. C'est le binder qui la
  // détient désormais, et lui seul.
  await page.getByTestId('desktop-sidebar').getByRole('link', { name: 'Desktop Trade Binder' }).click()
  await expect(page.getByRole('heading', { name: 'Desktop Trade Binder' })).toBeVisible()
  const binderRows = page.locator('[data-virtual-item-key]')
  await expect(binderRows).toHaveCount(1)
  await expect(binderRows.first()).toContainText('Desktop Card Alpha')
})

test('shift-click takes a range and ctrl-click toggles one row, both raising the selection action bar', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  const rows = await openContainer(page, fixture)

  // Un clic simple remplit le panneau : la ligne devient « courante », ce
  // qui n'est pas la même chose que « sélectionnée » — aucune coche.
  await rows.nth(0).click()
  await expect(tickedRows(page)).toHaveCount(0)

  await rows.nth(2).click({ modifiers: ['Shift'] })
  await expect(page.getByText('3 selected')).toBeVisible()
  await expect(tickedRows(page)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('3 selected')).toHaveCount(0)
  await expect(tickedRows(page)).toHaveCount(0)

  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.getByText('1 selected')).toBeVisible()
  // La ligne 0 remplit toujours le panneau : elle ne doit pas se compter
  // dans la sélection que l'utilisateur s'apprête à supprimer.
  await expect(tickedRows(page)).toHaveCount(1)

  await rows.nth(2).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.getByText('2 selected')).toBeVisible()
  await expect(tickedRows(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
})

// L'en-tête du binder (illustré ou non) est LE MÊME à toutes les largeurs,
// sans `MainHeader` distinct. Son `···` doit atteindre
// les mêmes feuilles — `Binder look`, `Rename` / `Delete binder`, `Share` et
// `Export list`.
test('the desktop ... menu reaches the same binder sheets as the mobile header', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  await page.goto('/collection')
  await page.getByTestId('desktop-sidebar').getByRole('link', { name: 'Desktop Trade Binder' }).click()
  await expect(page.getByRole('heading', { name: 'Desktop Trade Binder' })).toBeVisible()

  // Un seul en-tête à toutes les largeurs : le `···` du binder lui-même.
  await page.getByRole('button', { name: 'Binder actions' }).click()

  const menu = page.locator('[role="dialog"]')
  for (const label of ['Binder look', 'Rename', 'Share', 'Export list', 'Delete binder']) {
    await expect(menu.getByRole('button', { name: label })).toBeVisible()
  }

  // `Binder look` — la `LookSheet` mobile, pas une copie desktop.
  await menu.getByRole('button', { name: 'Binder look' }).click()
  await expect(page.getByRole('button', { name: 'Save look' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Colour', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // `Share` — la `ShareSheet`.
  await page.getByRole('button', { name: 'Binder actions' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Share' }).click()
  await expect(page.getByText('Share this binder')).toBeVisible()
  await page.keyboard.press('Escape')

  // `Export list` — la `ListExportSheet`.
  await page.getByRole('button', { name: 'Binder actions' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Export list' }).click()
  await expect(page.getByRole('button', { name: 'Copy list' })).toBeVisible()
  await page.keyboard.press('Escape')

  // `Rename` — la même feuille que le menu mobile, jusqu'au libellé du
  // champ.
  await page.getByRole('button', { name: 'Binder actions' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Binder name').fill('Renamed on desktop')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Renamed on desktop' })).toBeVisible()
})

// Le repli manuel persisté de la barre latérale (`users.sidebar_collapsed`)
// a été retiré : un sous-arbre n'est visible que quand sa section est active
// (`components/desktop/sidebar.tsx`).
test('the sidebar tree lists containers under Collection and deck folders under Decks, each subtree following the active section', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const fixture = await findCollection(email)
  await seed(fixture)

  await page.goto('/collection')

  const sidebar = page.getByTestId('desktop-sidebar')
  await expect(sidebar.getByRole('link', { name: 'Desktop Trade Binder' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Desktop Folder' })).toHaveCount(0)

  // Section `Decks` : ses dossiers apparaissent, le sous-arbre de
  // `Collection` se referme.
  await sidebar.getByRole('link', { name: 'Decks' }).last().click()
  await expect(page).toHaveURL(/\/decks$/)
  await expect(sidebar.getByRole('link', { name: 'Desktop Folder' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Desktop Trade Binder' })).toHaveCount(0)

  // Même arbre après un rechargement complet : il ne dépend que de la route.
  await page.reload()
  await expect(sidebar.getByRole('link', { name: 'Desktop Folder' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Desktop Trade Binder' })).toHaveCount(0)
})
