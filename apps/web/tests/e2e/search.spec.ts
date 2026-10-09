// Onglet Search. `webServer` lance `pnpm dev` (playwright.config.ts) contre le
// `DATABASE_URL` local — ces scénarios exigent donc un Postgres réellement
// accessible, à la différence des tests unitaires/intégration de lib/search/**.
import { expect, test } from '@playwright/test'

test('typing character by character only fires one search request 200ms after the last keystroke', async ({
  page,
}) => {
  const searchRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) {
      searchRequests.push(request.url())
    }
  })

  await page.goto('/search')
  // Laisse passer toute requête du montage (liste des sets) avant de
  // compter les frappes qui suivent.
  await page.waitForTimeout(400)
  searchRequests.length = 0

  const input = page.getByRole('searchbox')
  await input.pressSequentially('bolt', { delay: 50 })
  await page.waitForTimeout(500)

  expect(searchRequests).toHaveLength(1)
})

// Sans texte ni filtre, l'écran ne cherche rien et le dit ; une recherche
// affiche son état `Loading` le temps de la réponse, puis l'état vide.
test('shows loading skeletons immediately, then an empty state for a query with no matches', async ({
  page,
}) => {
  // La réponse de la Server Action est retardée : sur le build de
  // production elle revient trop vite pour que l'état intermédiaire soit
  // observable de façon fiable.
  await page.route('**/search', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    await route.fallback()
  })

  await page.goto('/search')
  await expect(
    page.getByText('Search by name, or use the filters to browse by color, type, text, set or rarity.'),
  ).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)

  const input = page.getByRole('searchbox')
  await input.fill('zzzzz-no-such-card-zzzzz')
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect(page.getByText('No cards match this search.')).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
})
