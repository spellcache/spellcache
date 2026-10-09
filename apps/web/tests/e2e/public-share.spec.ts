// Parcours bout en bout du partage public : rendre public, ouvrir sans
// session, repasser privé, plus le bouton `Import` de l'accueil. Même
// patron que
// `tests/e2e/deck-lifecycle.spec.ts` : cycle de lien magique rejoué par
// test, écriture directe en base du deck et de ses cartes faute d'écran
// d'ajout massif livré ailleurs.
//
// Le point crucial est le **contexte navigateur
// vierge** : la page publique est lue par un `browser.newContext()` neuf,
// sans le moindre cookie de session, exactement comme un visiteur anonyme ou
// un robot d'indexation.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-public-share-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2eshare')
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

async function findCollectionId(userId: string): Promise<string> {
  const [member] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(eq(collectionMembers.userId, userId))
    .limit(1)
  if (!member) throw new Error(`No bootstrapped collection found for user ${userId}.`)
  return member.collectionId
}

async function findRootContainerId(collectionId: string): Promise<string> {
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')))
    .limit(1)
  if (!root) throw new Error(`Collection ${collectionId} has no root container.`)
  return root.id
}

async function insertCard(id: string, name: string, collectorNumber: string): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2s', 'E2E share set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values (
      ${id}::uuid, gen_random_uuid(), ${name}, 'e2s', ${collectorNumber}, 'uncommon', 1, 'Artifact',
      '{}', '{}', '{nonfoil}', '{"modern":"legal"}'
    )
  `)
}

async function openBlankContext(browser: Browser) {
  // Aucun `storageState` : le contexte n'a ni cookie de session ni cache
  // hérité du contexte authentifié du test.
  const context = await browser.newContext()
  expect(await context.cookies()).toHaveLength(0)
  return context
}

test('make public, read it without a session, flip back to private', async ({
  page,
  browser,
}) => {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const collectionId = await findCollectionId(userId)

  const cardId = randomUUID()
  await insertCard(cardId, 'Public Sol Ring', '1')

  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'E2E shared deck',
    format: 'modern',
    deckState: 'plan',
  })
  await addHolding(
    userId,
    { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    2,
  )
  // Sept autres exemplaires rangés ailleurs dans la collection : la page
  // publique ne doit en faire état d'aucune façon.
  const rootId = await findRootContainerId(collectionId)
  await addHolding(
    userId,
    { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' },
    7,
  )

  // Tant que rien n'est publié, l'URL répond 404 même pour un container qui
  // existe bel et bien.
  const anonymous = await openBlankContext(browser)
  const anonymousPage = await anonymous.newPage()
  const beforeSharing = await anonymousPage.goto(`/s/${deck.id}`)
  expect(beforeSharing?.status()).toBe(404)

  await page.goto(`/decks/${deck.id}`)
  // La ligne `Share` du menu `···` porte son indice sous le libellé : son
  // nom accessible commence par `Share`, il ne s'y limite pas.
  await page.getByRole('button', { name: 'Deck actions' }).click()
  await page.getByRole('dialog', { name: 'E2E shared deck' }).getByRole('button', { name: /^Share/ }).click()
  await expect(page.getByText(/Anyone with the link/)).toBeVisible()
  await page.getByRole('button', { name: 'Make it public' }).click()
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible()

  const shared = await anonymousPage.goto(`/s/${deck.id}`)
  expect(shared?.status()).toBe(200)
  // Aucune donnée utilisateur ne doit être resservie depuis un cache
  // partagé : la réponse est explicitement non stockable.
  expect(shared?.headers()['cache-control']).toContain('no-store')

  await expect(anonymousPage.getByRole('heading', { name: 'E2E shared deck' })).toBeVisible()
  await expect(anonymousPage.getByText('Public Sol Ring')).toBeVisible()

  // Vérifié sur le HTML **rendu**, pas sur l'intention : la charge utile RSC
  // de Next voyage dans la page, une colonne lue mais non affichée y
  // apparaîtrait.
  const html = await anonymousPage.content()
  expect(html).not.toContain(email)
  expect(html).toContain('E2E shared deck')
  // Ni « possédé », ni « manquant » : la page n'affirme rien sur la
  // collection de son propriétaire.
  expect(html).not.toContain('Missing')
  expect(html).not.toContain('Owned')
  // Les 7 exemplaires rangés ailleurs : la seule quantité rendue est le 2 du
  // deck lui-même.
  expect(html).not.toContain('7 available')
  expect(html).not.toContain('ownedElsewhere')

  // Image Open Graph : présente, absolue, et servie.
  // Ce deck n'a ni couverture explicite ni commandant : c'est la branche de
  // repli qui répond, une image réelle et non un 404.
  const ogImage = await anonymousPage.locator('meta[property="og:image"]').getAttribute('content')
  expect(ogImage).toBeTruthy()
  expect(ogImage!.startsWith('http')).toBe(true)
  const fallbackImage = await anonymous.request.get(ogImage!)
  expect(fallbackImage.ok()).toBe(true)
  expect(fallbackImage.headers()['content-type']).toContain('image')

  // Avec une carte de couverture, la même route pointe sur l'`art_crop` de
  // cette carte, servi par le proxy de vignettes. Vérifié sans suivre
  // la redirection : le test ne doit dépendre d'aucun appel sortant.
  await db.update(containers).set({ coverCardId: cardId }).where(eq(containers.id, deck.id))
  const artImage = await anonymous.request.get(ogImage!, { maxRedirects: 0 })
  expect(artImage.status()).toBe(307)
  expect(artImage.headers()['location']).toBe(`/api/card-image/${cardId}/art_crop`)

  // La feuille de partage est restée ouverte depuis la publication, et c'est
  // voulu : elle porte le lien à copier, la refermer sur `Make it public`
  // priverait l'utilisateur du seul produit de son action. Comme
  // `components/ui/sheet.tsx` est un `Dialog` Radix modal, tout le reste du
  // document porte `aria-hidden` tant qu'elle est montée — le menu `···` de
  // la page en dessous sort alors de l'arbre d'accessibilité et devient
  // introuvable par `getByRole`. Elle est donc refermée explicitement ; la
  // rouvrir vérifie en prime que la feuille reflète l'état `public` qui
  // vient d'être écrit.
  await page.getByRole('button', { name: 'Close share sheet' }).click()
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeHidden()

  // Repassé privé : la même URL répond 404, dans le même contexte anonyme
  // qui vient pourtant de la charger avec succès.
  await page.getByRole('button', { name: 'Deck actions' }).click()
  await page.getByRole('dialog', { name: 'E2E shared deck' }).getByRole('button', { name: /^Share/ }).click()
  await expect(page.getByRole('button', { name: 'Remove share' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove share' }).click()
  await expect(page.getByRole('button', { name: 'Make it public' })).toBeVisible()

  const afterUnsharing = await anonymousPage.goto(`/s/${deck.id}`)
  expect(afterUnsharing?.status()).toBe(404)

  await anonymous.close()
})

test('the home Import button is enabled and opens the import sheet', async ({
  page,
}) => {
  await signInWithFreshAccount(page)

  await page.goto('/collection')
  const importButton = page.getByRole('button', { name: 'Import' })
  await expect(importButton).toBeEnabled()
  // La mention `Coming soon` d'avant l'import de liste a disparu.
  await expect(page.getByText('Coming soon')).toHaveCount(0)

  // Le bouton ouvre la feuille unifiée « Import & export », sur l'onglet
  // `Import`.
  await importButton.click()
  const sheet = page.getByRole('dialog', { name: 'Import & export' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Import', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet.getByLabel('List to import')).toBeVisible()
})

test('paste and import a list from the home screen, unknown lines reported apart', async ({
  page,
}) => {
  await signInWithFreshAccount(page)

  // Nom unique par exécution : la base de développement peut déjà porter un
  // catalogue complet et les exécutions précédentes de ce fichier — un nom
  // fixe deviendrait ambigu au second passage, et la ligne ne serait plus
  // `resolved`.
  const cardName = `E2E Import Card ${Date.now()}`
  await insertCard(randomUUID(), cardName, `2-${Date.now()}`)

  await page.goto('/collection')
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()
  // La feuille charge ses destinations à l'ouverture (Server Action) et
  // refuse l'import tant qu'elles ne sont pas arrivées (« Still loading
  // destinations ») : attendre cette réponse avant de valider.
  const destinationsLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  )
  await page.getByRole('button', { name: 'Import' }).click()
  await destinationsLoaded
  // La ligne collée reprend le nom **réellement inséré**, horodatage compris :
  // la résolution est une correspondance exacte sur le nom normalisé
  // (`resolveList`), un libellé tronqué ne résoudrait donc rien et le résultat
  // compterait deux inconnues au lieu d'une.
  const sheet = page.getByRole('dialog', { name: 'Import & export' })
  await sheet
    .getByLabel('List to import')
    .fill(`Deck\n3 ${cardName}\n1 Absolutely No Such Card Exists`)
  // Import en une étape (plus d'aperçu préalable) : le bouton plein du bas
  // de l'onglet, après le segmenté `Import` / `Export`.
  await sheet.getByRole('button', { name: 'Import', exact: true }).last().click()

  // L'écran de résultat compte les cartes importées et met les inconnues à
  // part, nommées.
  await expect(sheet.getByText('3 cards imported')).toBeVisible()
  await expect(sheet.getByText('Into Collection (no binder) · 1 skipped')).toBeVisible()
  await expect(sheet.getByText('Absolutely No Such Card Exists')).toBeVisible()

  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  // L'accueil relit ses compteurs : les trois exemplaires sont bien écrits.
  await expect(page.getByRole('link', { name: /^All collection 3 cards · 1 unique/ })).toBeVisible()
})
