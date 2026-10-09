// Parcours lien magique de bout en bout :
// connexion, onboarding du username, arrivée sur Collection, puis Logout qui
// ramène à `/login` et rend `/collection` inaccessible. `webServer` lance
// `pnpm dev` (playwright.config.ts) contre le `DATABASE_URL` local, avec
// `MAGIC_LINK_DEBUG_FILE` positionnée — pas de boîte mail réelle, le transport
// de développement (lib/mail/resend.ts) écrit le lien dans un fichier par
// destinataire à côté de ce chemin plutôt que dans la console du process
// serveur, inaccessible depuis ce test. Ce fichier tourne dans le projet
// Playwright `unauthenticated` (playwright.config.ts), sans session
// préexistante : c'est ce test qui pose la sienne de bout en bout.
import { expect, test } from '@playwright/test'

import { readMagicLink } from './read-magic-link'

test('magic link sign-in, username onboarding, arrival on Collection, then logout', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  // Onboarding du username, bloquant tant qu'il n'est pas choisi.
  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = `e2e${Date.now()}`
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)

  await page.goto('/settings')
  // `Logout` passe par une confirmation explicite (`LogoutRow`).
  await page.getByRole('button', { name: 'Logout' }).click()
  const confirm = page.getByRole('dialog', { name: 'Log out?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Logout', exact: true }).click()

  await expect(page).toHaveURL(/\/login/)

  await page.goto('/collection')
  await expect(page).toHaveURL(/\/login/)
})
