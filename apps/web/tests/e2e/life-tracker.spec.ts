// Outils de table. Même patron que `tests/e2e/settings.spec.ts` : cycle de
// lien magique rejoué par test (projet Playwright `unauthenticated`,
// playwright.config.ts), écriture directe en base contre
// `process.env.DATABASE_URL` pour amorcer ce que l'écran ne peut pas
// construire lui-même (l'outil déjà activé).
import { eq } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'

import { users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: Page): Promise<string> {
  const email = `e2e-tools-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2etools')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function enableLifeTracker(email: string): Promise<void> {
  await db.update(users).set({ toolLifeTracker: true }).where(eq(users.email, email))
}

// `data-life` plutôt que le texte rendu : pendant la surbrillance, la puce
// `You start` vit dans le même sous-arbre que le total.
async function lifeOf(page: Page, seat: number): Promise<number> {
  const raw = await page.locator(`[data-seat="${seat}"] [data-life]`).getAttribute('data-life')
  return Number(raw)
}

// Le bouton visuellement le plus haut d'un pavé — sur un pavé retourné c'est
// `Lose a life`, sur un pavé du bas c'est `Gain a life`. Le test ne suppose
// jamais lequel : il lit la géométrie.
async function tapHalf(page: Page, seat: number, half: 'upper' | 'lower'): Promise<void> {
  const buttons = page.locator(`[data-seat="${seat}"] button`)
  const boxes = await Promise.all(
    (await buttons.all()).map(async (button) => ({ button, box: await button.boundingBox() })),
  )
  const sorted = boxes.sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
  const target = half === 'upper' ? sorted[0] : sorted[sorted.length - 1]
  await target!.button.click()
}

// Quatre onglets et `/tools` en 404 tant que l'outil est éteint ; cinq onglets
// et la liste d'apps une fois allumé depuis Settings. Un onglet caché ne suffit
// pas — la route elle-même doit être injoignable.
test('the Tools tab and route appear only once a tool is on', async ({
  page,
}) => {
  await signInWithFreshAccount(page)

  await page.goto('/collection')
  await expect(page.locator('nav a')).toHaveCount(4)
  await expect(page.locator('nav a', { hasText: 'Tools' })).toHaveCount(0)

  const blocked = await page.goto('/tools')
  expect(blocked?.status()).toBe(404)
  const blockedLife = await page.goto('/tools/life')
  expect(blockedLife?.status()).toBe(404)

  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Life tracker' }).click()
  await expect(page.getByRole('switch', { name: 'Life tracker' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.waitForLoadState('networkidle')

  await page.goto('/collection')
  await expect(page.locator('nav a')).toHaveCount(5)
  await page.locator('nav a', { hasText: 'Tools' }).click()

  await expect(page).toHaveURL(/\/tools$/)
  await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible()
  // Cinq tuiles : une navigable, quatre inertes.
  await expect(page.getByRole('link', { name: /Life tracker/ })).toBeVisible()
  for (const name of ['Playtest', 'Trading mode', 'Card scanner', 'AI assistant']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeDisabled()
  }

  // Les trois lignes inertes du groupe Tools de Settings n'ont aucun
  // interrupteur : un seul `role="switch"` dans ce groupe.
  await page.goto('/settings')
  await expect(page.getByRole('switch', { name: 'Trading mode' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Card scanner' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'AI assistant' })).toHaveCount(0)
})

// Quitter le setup puis y revenir restaure la dernière configuration, et
// `Start game` seul relance une partie identique.
test('the setup screen remembers the last configuration', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  await enableLifeTracker(email)

  await page.goto('/tools/life')
  await page.getByRole('button', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: '20', exact: true }).click()
  // `Roll for first player` éteint : ni `Start game` ni la réinitialisation
  // ne tirent.
  await page.getByRole('switch', { name: 'Roll for first player' }).click()

  await page.goto('/tools')
  await page.getByRole('link', { name: /Life tracker/ }).click()
  await expect(page).toHaveURL(/\/tools\/life$/)

  await expect(page.getByRole('button', { name: '3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '20', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('switch', { name: 'Roll for first player' })).toHaveAttribute(
    'aria-checked',
    'false',
  )

  await page.getByRole('button', { name: 'Start game' }).click()

  await expect(page.locator('[data-seat]')).toHaveCount(3)
  expect(await lifeOf(page, 0)).toBe(20)
  // Aucun tirage : aucun siège en surbrillance, aucune couronne.
  await expect(page.locator('[data-first-seat="true"]')).toHaveCount(0)
  await expect(page.locator('[data-seat] svg.lucide-crown')).toHaveCount(0)
})

// La grille 2×2, et `−`/`+` qui ajustent le bon siège y compris sur un pavé
// retourné. C'est le piège : sur un pavé du haut, le bouton visuellement en haut de
// l'écran est `−`, parce que le joueur d'en face lit le pavé à l'endroit.
test('the flipped pads adjust the right seat', async ({ page }) => {
  const email = await signInWithFreshAccount(page)
  await enableLifeTracker(email)

  await page.goto('/tools/life')
  await page.getByRole('button', { name: '4', exact: true }).click()
  await page.getByRole('button', { name: '40', exact: true }).click()
  await page.getByRole('switch', { name: 'Roll for first player' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()

  await expect(page.locator('[data-seat]')).toHaveCount(4)

  // Siège 0 — pavé du haut, retourné : la moitié haute de l'écran perd.
  await tapHalf(page, 0, 'upper')
  expect(await lifeOf(page, 0)).toBe(39)
  await tapHalf(page, 0, 'lower')
  await tapHalf(page, 0, 'lower')
  expect(await lifeOf(page, 0)).toBe(41)

  // Siège 2 — pavé du bas, à l'endroit : la moitié haute gagne.
  await tapHalf(page, 2, 'upper')
  expect(await lifeOf(page, 2)).toBe(41)
  await tapHalf(page, 2, 'lower')
  await tapHalf(page, 2, 'lower')
  expect(await lifeOf(page, 2)).toBe(39)

  // Les autres sièges n'ont pas bougé.
  expect(await lifeOf(page, 1)).toBe(40)
  expect(await lifeOf(page, 3)).toBe(40)
})

// Le tirage du premier joueur ouvre un voile bloquant « {siège} starts » :
// `Roll again` retire, `Play` le ferme et le siège tiré garde une petite
// couronne. `Reset` restaure les totaux sans jamais retirer (et efface le
// siège du tirage précédent, `lib/tools/life-state.ts`) ; seul `Roll`,
// dans la barre de partie, rouvre le voile. (La surbrillance qui retombait
// seule après cinq secondes, écourtée par un tap n'importe où, a été remplacée
// par ce voile.)
test('the roll announces a seat behind a blocking veil, Play closes it, the crown stays', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  await enableLifeTracker(email)

  await page.goto('/tools/life')
  await page.getByRole('button', { name: '4', exact: true }).click()
  // `Roll for first player` reste actif : le voile s'ouvre avec la partie.
  await page.getByRole('button', { name: 'Start game' }).click()

  const announce = page.getByText(/ starts$/)
  const crown = page.locator('[data-seat] svg.lucide-crown')
  await expect(announce).toBeVisible()

  // `Roll again` retire sans fermer le voile ; `Play` le ferme.
  await page.getByRole('button', { name: 'Roll again' }).click()
  await expect(announce).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(announce).toHaveCount(0)
  await expect(crown).toHaveCount(1)

  // La réinitialisation restaure les totaux et ne retire jamais : pas de
  // voile, et plus de couronne.
  await tapHalf(page, 2, 'upper')
  expect(await lifeOf(page, 2)).toBe(41)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  expect(await lifeOf(page, 2)).toBe(40)
  await expect(announce).toHaveCount(0)
  await expect(crown).toHaveCount(0)

  // `Roll` rouvre le voile en cours de partie.
  await page.getByRole('button', { name: 'Roll', exact: true }).click()
  await expect(announce).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(announce).toHaveCount(0)
  await expect(crown).toHaveCount(1)
})

// L'état de partie survit à un rechargement (stockage local), et la sortie
// ramène au setup.
test('a running game survives a reload and the X returns to setup', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  await enableLifeTracker(email)

  await page.goto('/tools/life')
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  // Le voile du premier joueur bloque la partie jusqu'à `Play`.
  await page.getByRole('button', { name: 'Play', exact: true }).click()

  await tapHalf(page, 1, 'upper')
  const before = await lifeOf(page, 1)

  await page.reload()
  await expect(page.locator('[data-seat]')).toHaveCount(2)
  expect(await lifeOf(page, 1)).toBe(before)

  await page.getByRole('button', { name: 'Quit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible()
  await expect(page.locator('[data-seat]')).toHaveCount(0)
})

// Sur un navigateur sans l'API Wake Lock, la partie démarre quand même. Le
// contexte est amorcé sans `navigator.wakeLock` avant tout script de page ;
// aucune erreur console n'est tolérée.
test('the game starts on a browser without the Wake Lock API', async ({
  browser,
}) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'wakeLock')
    Reflect.deleteProperty(navigator, 'wakeLock')
  })
  const page = await context.newPage()

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const email = await signInWithFreshAccount(page)
  await enableLifeTracker(email)

  await page.goto('/tools/life')
  await page.evaluate(() => {
    if ('wakeLock' in navigator) throw new Error('the Wake Lock API should be absent here')
  })
  await page.getByRole('button', { name: '4', exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()

  await expect(page.locator('[data-seat]')).toHaveCount(4)
  expect(errors).toEqual([])

  await context.close()
})
