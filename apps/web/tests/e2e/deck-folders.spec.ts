// Vue étagères de l'onglet `Decks` : étagères, `See all`, glisser-déposer.
// Chaque test rejoue son propre cycle de lien magique (projet Playwright
// `unauthenticated`, même patron que `decks.spec.ts`) : un
// compte fraîchement connecté reçoit toujours une collection vide, ce qui
// isole ce test d'une mutation laissée par un run précédent.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { users } from '@spellcache/db/schema'
import { createContainer } from '@/lib/containers/containers'
import { db } from '@spellcache/db'
import { bootstrapCollection } from '@/lib/collections/bootstrap'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-folders-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2efolders')
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

async function setupAccount(page: Page): Promise<{ userId: string; collectionId: string }> {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const { collectionId } = await bootstrapCollection(userId, { username: 'ignored', displayName: null })
  return { userId, collectionId }
}

async function createDeck(
  userId: string,
  collectionId: string,
  name: string,
  sortOrder: number,
): Promise<string> {
  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name,
    format: 'modern',
    deckState: 'plan',
    sortOrder,
  })
  return deck.id
}

async function createFolder(collectionId: string, name: string, position: number): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into deck_folders (id, collection_id, name, position)
    values (${randomUUID()}, ${collectionId}, ${name}, ${position})
    returning id
  `)
  return rows[0]!.id
}

// `New folder` vit dans le menu `···` de l'onglet (l'en-tête ne garde qu'un
// bouton primaire, `+`) — sa ligne porte un indice sous son libellé.
async function openNewFolderSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: /^New folder/ }).click()
  await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible()
}

// `See all` d'une étagère précise : chaque étagère non vide porte le sien,
// `Unsorted` compris.
function seeAllOf(page: Page, shelfName: string) {
  return page
    .locator('[data-folder-header]')
    .filter({ has: page.getByText(shelfName, { exact: true }) })
    .getByRole('link', { name: 'See all' })
}

// Réponse de la prochaine Server Action : l'écran déplace un deck ou un
// dossier de façon optimiste avant son retour, et un rechargement lancé trop
// tôt annulerait la requête encore en vol — à attendre avant tout
// `page.reload()` qui vérifie la persistance.
function nextServerActionResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  )
}

async function fileDeck(deckId: string, folderId: string): Promise<void> {
  await db.execute(sql`update containers set folder_id = ${folderId} where id = ${deckId}`)
}

test('the Decks tab always renders the folder shelves, with no layout setting to pick', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const { collectionId } = await bootstrapCollection(userId, { username: 'ignored', displayName: null })
  await createDeck(userId, collectionId, 'Flat list deck', 0)

  // Un seul rendu, sans réglage : l'étagère `Unsorted` est là d'emblée, et
  // les puces de filtre de l'ancienne liste plate n'existent plus.
  await page.goto('/decks')
  await expect(page.getByText('Unsorted')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Flat list deck' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^All · / })).toHaveCount(0)
  // `New folder` reste offert, depuis le menu `···` de l'onglet.
  await openNewFolderSheet(page)
})

test('Unsorted carries every folder-less deck, its See all lists them, and short shelves end with the New deck tile', async ({
  page,
}) => {
  const { userId, collectionId } = await setupAccount(page)
  const folderId = await createFolder(collectionId, 'Commander', 0)
  const filed = await createDeck(userId, collectionId, 'Atraxa Superfriends', 0)
  await fileDeck(filed, folderId)
  await createDeck(userId, collectionId, 'Draft leftovers', 1)

  await page.goto('/decks')

  // Les deux étagères portent un `See all` : `Commander` vers son dossier,
  // `Unsorted` vers le dossier virtuel `/decks/folders/unsorted`.
  await expect(page.getByRole('link', { name: 'See all' })).toHaveCount(2)

  // Le deck sans dossier est bien dans la dernière étagère.
  const unsortedTrack = page.getByRole('group', { name: 'Unsorted decks' })
  await expect(unsortedTrack.getByRole('link', { name: 'Draft leftovers' })).toBeVisible()
  await expect(unsortedTrack.getByRole('link', { name: 'Atraxa Superfriends' })).toHaveCount(0)

  // Son `See all` ne liste que les decks sans dossier, et n'offre ni
  // renommage ni suppression (pas de `⋯`) — seulement `+`.
  await page.getByRole('link', { name: 'See all' }).last().click()
  await expect(page).toHaveURL(/\/decks\/folders\/unsorted$/)
  await expect(page.getByRole('heading', { name: 'Unsorted' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Draft leftovers' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Atraxa Superfriends' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
  await page.goBack()

  // Deux étagères courtes (une carte chacune) : chacune se termine par la
  // tuile `New deck` de 152px, jamais par le stub.
  await expect(page.getByRole('button', { name: 'New deck' })).toHaveCount(2)
  await expect(page.getByTestId('shelf-stub')).toHaveCount(0)
  const tileWidth = await page
    .getByRole('button', { name: 'New deck' })
    .first()
    .evaluate((node) => node.getBoundingClientRect().width)
  expect(tileWidth).toBe(152)
})

test('a scrollable track ends with the 60px dashed stub instead of the New deck tile', async ({
  page,
}) => {
  const { userId, collectionId } = await setupAccount(page)

  // Six cartes de 152px sur un écran de 390px débordent largement : la piste
  // devient défilable.
  for (let i = 0; i < 6; i += 1) {
    await createDeck(userId, collectionId, `Overflow deck ${i}`, i)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/decks')

  const stub = page.getByTestId('shelf-stub')
  await expect(stub).toHaveCount(1)
  const stubWidth = await stub.evaluate((node) => node.getBoundingClientRect().width)
  expect(stubWidth).toBe(60)
  await expect(page.getByRole('button', { name: 'New deck' })).toHaveCount(0)

  // La piste défile bien horizontalement, sans barre visible — la mécanique
  // partagée avec l'onglet Collection (`components/collection/shelf-track.tsx`).
  const track = page.getByRole('group', { name: 'Unsorted decks' })
  const before = await track.evaluate((node) => node.scrollLeft)
  await track.evaluate((node) => node.scrollBy({ left: 200 }))
  await expect.poll(() => track.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before)
  const scrollbarWidth = await track.evaluate((node) => getComputedStyle(node).scrollbarWidth)
  expect(scrollbarWidth).toBe('none')
})

test('the New deck tile is never cut by the right edge, and a scrollable track opens flush with its 16px padding', async ({
  page,
}) => {
  const { userId, collectionId } = await setupAccount(page)
  // Deux cartes tiennent dans 390px (16 + 152 + 10 + 152 + 16 = 346), la
  // tuile de 152px qui suivrait, non : c'est le stub qui termine la piste,
  // jamais une tuile coupée par le bord droit.
  await createDeck(userId, collectionId, 'Fits one', 0)
  await createDeck(userId, collectionId, 'Fits two', 1)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/decks')

  await expect(page.getByTestId('shelf-stub')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'New deck' })).toHaveCount(0)

  // Le snap respecte le padding latéral : la piste s'ouvre à `scrollLeft`
  // 0, première carte à 16px du bord — pas décalée de 16px comme une piste
  // que le snap aurait alignée sur le bord du scrollport.
  const track = page.getByRole('group', { name: 'Unsorted decks' })
  expect(await track.evaluate((node) => node.scrollLeft)).toBe(0)
  const inset = await track.evaluate((node) => {
    const first = node.querySelector('a[data-deck-id]')!
    return first.getBoundingClientRect().left - node.getBoundingClientRect().left
  })
  expect(inset).toBe(16)
})

test('creating a folder produces an empty shelf holding only the New deck tile', async ({
  page,
}) => {
  await setupAccount(page)

  await page.goto('/decks')
  await expect(page.getByText('Unsorted')).toBeVisible()

  await openNewFolderSheet(page)
  await page.getByLabel('Folder name').fill('Commander')
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // Apparue sans rechargement.
  const track = page.getByRole('group', { name: 'Commander decks' })
  await expect(track).toBeVisible()
  await expect(track.getByRole('link')).toHaveCount(0)
  await expect(track.getByRole('button', { name: 'New deck' })).toHaveCount(1)

  // Et elle survit au rechargement : `position` est bien persistée.
  await page.reload()
  await expect(page.getByRole('group', { name: 'Commander decks' })).toBeVisible()
})

test('Move to folder… from the long-press context menu refiles the deck without a reload', async ({
  page,
}) => {
  const { userId, collectionId } = await setupAccount(page)
  await createFolder(collectionId, 'Commander', 0)
  await createDeck(userId, collectionId, 'Atraxa Superfriends', 0)

  await page.goto('/decks')
  const card = page.getByRole('link', { name: 'Atraxa Superfriends' })
  await expect(page.getByRole('group', { name: 'Unsorted decks' }).getByRole('link')).toHaveCount(1)

  // Appui long (500ms, le même seuil que la sélection groupée) : maintenu
  // sans bouger, pour ne pas déclencher le glissement.
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()

  // L'entrée du menu contextuel s'appelle `Move to` ; elle ouvre la feuille
  // `Move to folder`.
  await page.getByRole('button', { name: 'Move to', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Move to folder' })).toBeVisible()
  const moveSaved = nextServerActionResponse(page)
  await page.getByRole('button', { name: 'Commander', exact: true }).click()

  // Sans rechargement : la carte a changé d'étagère.
  await expect(
    page.getByRole('group', { name: 'Commander decks' }).getByRole('link', { name: 'Atraxa Superfriends' }),
  ).toBeVisible()
  await expect(page.getByRole('group', { name: 'Unsorted decks' }).getByRole('link')).toHaveCount(0)

  // Et c'est bien `folder_id` qui a été écrit : le rechargement le confirme.
  await moveSaved
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Commander decks' }).getByRole('link', { name: 'Atraxa Superfriends' }),
  ).toBeVisible()
})

test('See all opens the folder vertical list with the regular deck rows, and back returns to Decks', async ({
  page,
}) => {
  const { userId, collectionId } = await setupAccount(page)
  const folderId = await createFolder(collectionId, 'Commander', 0)
  const filed = await createDeck(userId, collectionId, 'Atraxa Superfriends', 0)
  await fileDeck(filed, folderId)
  await createDeck(userId, collectionId, 'Draft leftovers', 1)

  await page.goto('/decks')
  await seeAllOf(page, 'Commander').click()

  await expect(page).toHaveURL(new RegExp(`/decks/folders/${folderId}$`))
  // Titre = nom du dossier, et seulement les decks du dossier.
  await expect(page.getByRole('heading', { name: 'Commander' })).toBeVisible()
  await expect(page.getByText('Atraxa Superfriends')).toBeVisible()
  await expect(page.getByText('Draft leftovers')).toHaveCount(0)
  // Ligne de deck de l'écran `Decks` (`DeckRow`) : sa méta « format · N
  // cards », absente de la carte d'étagère. Modern n'a plus de règles
  // vérifiées (`noRules`), la ligne n'y porte donc pas de puce de statut.
  await expect(page.getByText('Modern · 0 cards', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/decks$/)
})

test('no shelf header shows a monetary amount', async ({ page }) => {
  const { userId, collectionId } = await setupAccount(page)
  const folderId = await createFolder(collectionId, 'Commander', 0)
  const filed = await createDeck(userId, collectionId, 'Atraxa Superfriends', 0)
  await fileDeck(filed, folderId)

  await page.goto('/decks')

  // L'en-tête d'étagère ne porte que le nom, le compte de decks et `See all`
  // — jamais un montant agrégé (délibérément abandonné).
  const headers = page.locator('[data-folder-header]')
  await expect(headers).toHaveCount(2)
  for (const text of await headers.allInnerTexts()) {
    expect(text).not.toMatch(/[$€]/)
  }

  // Le compteur d'en-tête est un nombre de **decks**, ici 1.
  await expect(headers.first()).toContainText('1')
})

test('a long press on the header opens the folder menu without following See all', async ({ page }) => {
  const { userId, collectionId } = await setupAccount(page)
  const folderId = await createFolder(collectionId, 'Commander', 0)
  // Une étagère vide n'a pas de `See all` : le dossier reçoit un deck.
  await fileDeck(await createDeck(userId, collectionId, 'Atraxa Superfriends', 0), folderId)

  await page.goto('/decks')

  // Appui long démarré **sur** `See all`, qui est rendu dans l'en-tête : le
  // menu du dossier s'ouvre, et le relâchement ne doit pas naviguer vers la
  // liste du dossier par-dessus.
  const seeAll = seeAllOf(page, 'Commander')
  const box = (await seeAll.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()

  await expect(page.getByRole('button', { name: 'Delete folder' })).toBeVisible()
  // Assertion **non réessayée** : `toHaveURL` réessaie et passerait sur une
  // navigation client encore en vol.
  await page.waitForTimeout(300)
  expect(page.url()).toMatch(/\/decks$/)
})

// Glissement vertical au **doigt** : un écran mobile d'abord
// (docs/development.md) doit défiler quel que soit l'endroit où le geste part,
// tuile de deck ou en-tête de dossier compris. Les évènements tactiles sont
// injectés par CDP (`Input.dispatchTouchEvent`) et non fabriqués en
// JavaScript dans la page : ils traversent le pipeline d'entrée du
// navigateur, donc son arbitrage `touch-action`.
test.describe('touch pointer', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  async function touchDrag(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }]

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) })
    const steps = 10
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(
          from.x + ((to.x - from.x) * step) / steps,
          from.y + ((to.y - from.y) * step) / steps,
        ),
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  }

  test('a vertical swipe on a folder header or a deck tile scrolls the screen and moves nothing', async ({
    page,
  }) => {
    const { userId, collectionId } = await setupAccount(page)
    await createFolder(collectionId, 'Commander', 0)
    await createFolder(collectionId, 'Brawl', 1)
    await createFolder(collectionId, 'Pauper', 2)
    await createDeck(userId, collectionId, 'Ur-Dragon Tribal', 0)

    await page.goto('/decks')

    const names = page.locator('[data-folder-header] > div > span:first-child')
    await expect(names).toHaveText(['Commander', 'Brawl', 'Pauper', 'Unsorted'])
    const headers = page.locator('[data-folder-header]')
    // `toHaveText` passe déjà sur le HTML streamé encore masqué (boîte de
    // hauteur nulle) : attendre que les étagères soient réellement rendues
    // avant de mesurer.
    await expect(headers.last()).toBeVisible()

    // Zone défilante de l'écran (`ScrollArea` de `Screen`, pas le document).
    const scroller = await headers.first().evaluateHandle((node) => {
      for (let el = node.parentElement; el; el = el.parentElement) {
        const { overflowY } = getComputedStyle(el)
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          return el
        }
      }
      return null
    })
    const scrollTop = () => scroller.evaluate((el) => (el as HTMLElement | null)?.scrollTop ?? -1)
    expect(await scrollTop()).toBe(0)

    const brawl = (await headers.nth(1).boundingBox())!
    await touchDrag(
      page,
      { x: brawl.x + brawl.width / 2, y: brawl.y + brawl.height / 2 },
      { x: brawl.x + brawl.width / 2, y: brawl.y + brawl.height / 2 - 150 },
    )
    await expect.poll(scrollTop).toBeGreaterThan(0)
    await expect(names).toHaveText(['Commander', 'Brawl', 'Pauper', 'Unsorted'])

    await scroller.evaluate((el) => (el as HTMLElement).scrollTo({ top: 0 }))
    const tile = (await page.getByRole('link', { name: 'Ur-Dragon Tribal' }).boundingBox())!
    await touchDrag(
      page,
      { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 },
      { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 - 150 },
    )
    await expect.poll(scrollTop).toBeGreaterThan(0)
    await expect(page).toHaveURL(/\/decks$/)
    await expect(
      page.getByRole('group', { name: 'Unsorted decks' }).getByRole('link', { name: 'Ur-Dragon Tribal' }),
    ).toBeVisible()
  })
})
