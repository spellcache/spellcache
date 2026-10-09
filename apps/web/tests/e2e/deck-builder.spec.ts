// Parcours bout en bout du tiroir d'ajout persistant : ajouter dix cartes
// d'affilée depuis le tiroir demande dix taps et le tiroir reste ouvert du
// premier au dixième. Même patron que
// `tests/e2e/decks.spec.ts`/`tests/e2e/binder-look.spec.ts` : cycle de lien
// magique rejoué par test, écriture directe en base du deck et de sa carte
// faute d'écran de recherche massive du catalogue livré ailleurs.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(
  page: import('@playwright/test').Page,
): Promise<string> {
  const email = `e2e-deck-builder-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2edeckbuilder')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

async function findUserId(email: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)
  return user.id
}

// Une seule carte incolore (la puce `Legal in deck
// colours` active par défaut exclut tout hors de l'identité colorée : un
// deck sans commandant et sans carte a une identité vide, seule une carte
// incolore y passe sans avoir à désactiver la puce dans ce test). Le nom
// porte un suffixe propre au test : un tiroir sans recherche liste le
// catalogue entier, où les autres specs ajoutent leurs propres cartes — le
// test cherche donc sa carte par son nom, qui ne doit désigner qu'elle.
async function seedDeckWithOneColourlessCard(
  email: string,
): Promise<{ deckId: string; cardName: string }> {
  const userId = await findUserId(email)

  const [member] = await db
    .select({ collectionId: collectionMembers.collectionId })
    .from(collectionMembers)
    .where(eq(collectionMembers.userId, userId))
    .limit(1)
  if (!member) throw new Error(`No bootstrapped collection found for ${email}.`)

  const deck = await createContainer(userId, member.collectionId, {
    kind: 'deck',
    name: 'E2E builder deck',
    format: 'modern',
    deckState: 'plan',
  })

  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  const cardId = randomUUID()
  const cardName = `Sol Ring ${Math.random().toString(36).slice(2, 8)}`
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values (
      ${cardId}::uuid, gen_random_uuid(), ${cardName}, 'e2e', '1', 'uncommon', 1, 'Artifact',
      '{}', '{}', '{nonfoil}', '{}'
    )
  `)

  return { deckId: deck.id, cardName }
}

test('adding ten cards in a row from the drawer takes ten taps and the drawer stays open throughout', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { deckId, cardName } = await seedDeckWithOneColourlessCard(email)

  await page.goto(`/decks/${deckId}`)
  await expect(page.getByText('E2E builder deck')).toBeVisible()

  await page.getByRole('button', { name: 'Add cards' }).click()
  // Le tiroir monté porte une fermeture ronde `aria-label="Close"`, unique à
  // lui — contrairement au texte « Add cards », qui résout à la fois le
  // bouton du pied fixe (`deck-view.tsx`) et l'en-tête du tiroir
  // (`add-drawer.tsx`) et violerait le mode strict de Playwright.
  const closeButton = page.getByRole('button', { name: 'Close' })
  await expect(closeButton).toBeVisible()

  await page.getByLabel('Search card name').fill(cardName)
  const addButton = page.getByRole('button', { name: `Add ${cardName}` })
  await expect(addButton).toBeVisible()

  for (let tap = 1; tap <= 10; tap += 1) {
    await addButton.click()
    // La ligne reflète `in deck ×N` mis à jour après chaque ajout, sans
    // rechargement.
    await expect(page.getByText(`in deck ×${tap}`)).toBeVisible()
    // Le tiroir reste monté et ouvert entre chaque tap.
    await expect(closeButton).toBeVisible()
  }

  // Le nombre annoncé par `Done · N added` égale le nombre réel d'ajouts de
  // la session, et le fermer retire le tiroir.
  await page.getByRole('button', { name: 'Done · 10 added' }).click()
  await expect(closeButton).toHaveCount(0)
})

test('changing zone keeps the search results and the session add counter intact', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { deckId, cardName } = await seedDeckWithOneColourlessCard(email)

  await page.goto(`/decks/${deckId}`)
  await page.getByRole('button', { name: 'Add cards' }).click()

  await page.getByLabel('Search card name').fill(cardName)
  const addButton = page.getByRole('button', { name: `Add ${cardName}` })
  await expect(addButton).toBeVisible()
  await addButton.click()
  await expect(page.getByText('in deck ×1')).toBeVisible()

  // Le segmenté de zone du tiroir (« Side · N ») — pas la puce de zone
  // « Side » de la ligne de deck apparue derrière lui.
  await page.getByRole('button', { name: /^Side · \d+$/ }).click()

  // La recherche, ses résultats et le compteur d'ajouts de la session ne
  // s'effacent pas au changement de zone.
  await expect(addButton).toBeVisible()
  await expect(page.getByText('in deck ×1')).toBeVisible()
  await expect(page.getByRole('button', { name: /Done · 1 added/ })).toBeVisible()
})
