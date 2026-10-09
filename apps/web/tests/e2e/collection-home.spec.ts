// Écran `Collection home · Compact`. Chaque test rejoue son propre cycle de
// lien magique (même patron que login.spec.ts, projet Playwright
// `unauthenticated`) plutôt que de réutiliser la session partagée de
// `smoke`/`search` : un compte fraîchement connecté reçoit toujours une
// collection vide, ce qui isole ce test d'une éventuelle mutation laissée par
// un run précédent sur le compte partagé.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, containers, users } from '@spellcache/db/schema'
import { addHolding } from '@/lib/containers/holdings'
import { createContainer } from '@/lib/containers/containers'
import { db } from '@spellcache/db'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-collection-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2ecoll')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/collection/)
  // L'URL change avant la fin du rendu serveur, qui amorce la collection
  // (`requireSession`) : attendre l'écran avant de lire la base.
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible()

  return email
}

// Résout l'identité de collection d'un compte fraîchement connecté (cas
// « collection peuplée ») directement contre la même base que `pnpm dev`
// (`process.env.DATABASE_URL`, voir `packages/db/src/client.ts`) — le seul moyen de peupler
// des holdings réels sans passer par l'écran `All collection` ni la feuille
// d'apparence de binder, hors du périmètre de ce test.
async function findCollectionIdentity(
  email: string,
): Promise<{ userId: string; collectionId: string; rootContainerId: string }> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new Error(`No user row found for ${email}.`)

  const [root] = await db
    .select({ collectionId: collectionMembers.collectionId, rootContainerId: containers.id })
    .from(collectionMembers)
    .innerJoin(
      containers,
      and(eq(containers.collectionId, collectionMembers.collectionId), eq(containers.kind, 'collection')),
    )
    .where(eq(collectionMembers.userId, user.id))
    .limit(1)
  if (!root) throw new Error(`No bootstrapped collection found for ${email}.`)

  return { userId: user.id, collectionId: root.collectionId, rootContainerId: root.rootContainerId }
}

// Même fixture que `tests/integration/collection-home.test.ts` (carte +
// set + prix du jour), en écriture directe : le catalogue de cartes n'est
// pas un chemin couvert par l'UI de cet écran (la recherche et l'ajout
// depuis la recherche vivent ailleurs).
async function insertCard(cardId: string, setCode: string): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count) values (${setCode}, ${setCode}, 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
    values (${cardId}, ${randomUUID()}, ${cardId}::text, ${setCode}, '1', 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}')
  `)
  await db.execute(sql`
    insert into card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
    values (${cardId}, current_date, 1.00, 2.00, 0.90, 1.80)
  `)
}

test('an empty collection shows €0.00 and the empty binders state', async ({ page }) => {
  await signInWithFreshAccount(page)

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
  // Le montant `€0.00` est produit à deux endroits de l'écran par design (la
  // ValueCard *et* la sous-ligne `formatMoney` de la NavRow Decks) — un
  // `getByText` non scopé résout deux éléments et casse
  // `expect(...).toBeVisible()` en mode strict. On remonte donc au conteneur de
  // la ValueCard (le parent du libellé `TOTAL COLLECTION VALUE`) avant d'y
  // chercher le montant, pour ne cibler que cette carte.
  const valueCardLabel = page.getByText('TOTAL COLLECTION VALUE')
  await expect(valueCardLabel).toBeVisible()
  const valueCard = valueCardLabel.locator('xpath=..')
  // `users.price_source` vaut `cardmarket_eur` par défaut — un compte
  // fraîchement créé affiche donc `€0.00`, pas `$0.00`. `\s` absorbe l'espace
  // insécable fine que produit l'ICU de Node (même tolérance que
  // `lib/format/money.ts`).
  await expect(valueCard.getByText('€0.00')).toBeVisible()
  await expect(page.getByText('No binders yet.')).toBeVisible()
})

test('creating a binder from the New binder sheet shows it without a page reload', async ({ page }) => {
  await signInWithFreshAccount(page)

  await page.getByRole('button', { name: 'New binder' }).click()
  const name = `Test binder ${Date.now()}`
  await page.getByLabel('Binder name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // La création navigue vers le container créé (`collection-view.tsx`,
  // `router.push`) : on y arrive sans rechargement, puis l'accueil le liste
  // au retour.
  await expect(page).toHaveURL(/\/container\//)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('No binders yet.')).toHaveCount(0)
  await expect(page.getByRole('main').getByText(name)).toBeVisible()
})

test('creating a list from the New list sheet shows it without a page reload', async ({ page }) => {
  await signInWithFreshAccount(page)

  // Meme parcours que le `New binder` ci-dessus, depuis l'onglet `Lists` du
  // segmente : le lien de section suit le segment actif et cree un container
  // `kind = 'list'`.
  await page.getByRole('button', { name: 'Lists', exact: true }).click()
  await expect(page.getByText('No list yet.')).toBeVisible()

  await page.getByRole('button', { name: 'New list' }).click()
  const name = `Test list ${Date.now()}`
  await page.getByLabel('List name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // Même navigation vers le container créé que pour un binder ; au retour,
  // l'accueil reprend sur le segment `Collection` par défaut.
  await expect(page).toHaveURL(/\/container\//)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.goBack()
  await page.getByRole('button', { name: 'Lists', exact: true }).click()
  await expect(page.getByText('No list yet.')).toHaveCount(0)
  await expect(page.getByRole('main').getByText(name)).toBeVisible()
})

test('a simulated server error renders a message instead of a blank screen', async ({ page }) => {
  await signInWithFreshAccount(page)

  await page.goto('/collection?__forceError=1')
  await expect(page.getByText('Something went wrong. Try again.')).toBeVisible()
})

test('a populated collection renders a real value, counts, and a themed binder row', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const { userId, collectionId, rootContainerId } = await findCollectionIdentity(email)

  const cardA = randomUUID()
  const cardB = randomUUID()
  await insertCard(cardA, 'lea')
  await insertCard(cardB, 'lea')

  await addHolding(
    userId,
    { containerId: rootContainerId, cardId: cardA, finish: 'nonfoil', condition: 'nm', language: 'en' },
    3,
  )
  await addHolding(
    userId,
    { containerId: rootContainerId, cardId: cardB, finish: 'nonfoil', condition: 'nm', language: 'en' },
    4,
  )

  const binderName = `Playwright binder ${Date.now()}`
  const binder = await createContainer(userId, collectionId, {
    kind: 'binder',
    name: binderName,
    coverGradient: 'green',
  })
  await addHolding(
    userId,
    { containerId: binder.id, cardId: cardA, finish: 'nonfoil', condition: 'nm', language: 'en' },
    10,
  )

  // `getCollectionHome` est lu une fois, au
  // rendu du composant serveur — les écritures ci-dessus ont lieu après ce
  // premier rendu, donc un rechargement de page est nécessaire pour les
  // voir. C'est le même aller-retour serveur que suivrait un vrai visiteur
  // qui revient sur l'écran, pas un second chemin de lecture côté client.
  await page.reload()

  // Devise réelle d'un compte fraîchement créé : `users.price_source` vaut
  // `cardmarket_eur` par défaut (`packages/db/src/schema.ts`) — le montant s'affiche
  // donc en euros. `\s` absorbe l'espace insécable fine que produit l'ICU de
  // Node entre le nombre et le symbole (même tolérance que
  // `lib/format/money.ts`).
  await expect(page.getByText('TOTAL COLLECTION VALUE')).toBeVisible()
  await expect(page.getByText('€6.30')).toBeVisible()
  await expect(page.getByText('7 cards · 2 unique')).toBeVisible()

  await expect(page.getByRole('main').getByText(binderName)).toBeVisible()
  await expect(page.getByText('10 cards')).toBeVisible()
  await expect(page.getByText('€9.00')).toBeVisible()
})
