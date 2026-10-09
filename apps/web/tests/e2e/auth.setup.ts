// Fixture de session authentifiée : `middleware.ts` redirige désormais toute
// requête sans cookie de session vers `/login` sur `/collection/:path*` et
// `/search/:path*` — `smoke.spec.ts` et `search.spec.ts` visitent ces routes
// sans jamais se connecter. Ce test s'exécute une fois avant eux (projet `authenticated`,
// `dependencies: ['setup']` dans playwright.config.ts) : il rejoue le même
// cycle de lien magique que `login.spec.ts` puis sauvegarde le
// `storageState` (cookie de session) que ces deux specs réutilisent — la
// garde de session elle-même n'est pas affaiblie, seuls ces deux parcours
// pré-existants reçoivent une session valide avant de démarrer.
import { expect, test as setup } from '@playwright/test'

import { AUTH_STORAGE_STATE_FILE } from '../../playwright.config'
import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

setup('authenticate once for the smoke and search specs', async ({ page }) => {
  const email = `e2e-fixture-${Date.now()}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2efixture')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)

  await page.context().storageState({ path: AUTH_STORAGE_STATE_FILE })
})
