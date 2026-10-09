import { expect, test } from '@playwright/test'

test('the collection page renders the tab bar', async ({ page }) => {
  await page.goto('/collection')

  const tabBar = page.getByRole('navigation')
  await expect(tabBar).toBeVisible()

  await expect(tabBar.getByRole('link', { name: 'Collection' })).toBeVisible()
  await expect(tabBar.getByRole('link', { name: 'Search' })).toBeVisible()
  await expect(tabBar.getByRole('link', { name: 'Decks' })).toBeVisible()
  await expect(tabBar.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(tabBar.getByRole('link', { name: 'Tools' })).toHaveCount(0)
})
