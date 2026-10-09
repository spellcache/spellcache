// Parcours bout en bout du cycle de vie d'un deck : `plan → assemble → built
// → dismantle`, chaque transition confirmée par une feuille, et le bouton
// de copie de l'export place bien le texte formaté dans le presse-papier.
// Même patron que `tests/e2e/deck-builder.spec.ts`/`decks.spec.ts` : cycle
// de lien magique rejoué par test, écriture directe en base du deck et de
// ses cartes faute d'écran de recherche massive du catalogue livré ailleurs.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect, test } from '@playwright/test'

import { collectionMembers, holdings, users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { createContainer } from '@/lib/containers/containers'
import { addHolding } from '@/lib/containers/holdings'

import { readMagicLink } from './read-magic-link'
import { uniqueUsername } from './unique-username'

async function signInWithFreshAccount(page: import('@playwright/test').Page): Promise<string> {
  const email = `e2e-deck-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  const magicLink = await readMagicLink(email)
  await page.goto(magicLink)

  await expect(page).toHaveURL(/\/onboarding\/username/)
  const username = uniqueUsername('e2elifecycle')
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
  const { containers } = await import('@spellcache/db/schema')
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.collectionId, collectionId), eq(containers.kind, 'collection')))
    .limit(1)
  if (!root) throw new Error(`Collection ${collectionId} has no root container.`)
  return root.id
}

async function insertCard(id: string, name: string): Promise<void> {
  await db.execute(sql`
    insert into sets (code, name, card_count) values ('e2e', 'E2E test set', 0)
    on conflict (code) do nothing
  `)
  await db.execute(sql`
    insert into cards (
      id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line,
      colors, color_identity, finishes, legalities
    )
    values (
      ${id}::uuid, gen_random_uuid(), ${name}, 'e2e', '1', 'uncommon', 1, 'Artifact',
      '{}', '{}', '{nonfoil}', '{}'
    )
  `)
}

test('plan -> assemble -> built -> dismantle, each transition behind its own confirmation sheet', async ({
  page,
}) => {
  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const collectionId = await findCollectionId(userId)

  const cardId = randomUUID()
  await insertCard(cardId, 'Sol Ring')

  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'E2E lifecycle deck',
    format: 'modern',
    deckState: 'plan',
  })

  // Carte physiquement possédée (racine de collection) ET voulue par le
  // deck — satisfiable via « Loose collection » sans bascule (interrupteur
  // par défaut).
  const rootId = await findRootContainerId(collectionId)
  await addHolding(userId, { containerId: rootId, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)
  await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

  await page.goto(`/decks/${deck.id}`)
  await expect(page.getByText('E2E lifecycle deck')).toBeVisible()

  // plan -> (assemble ->) built, confirmé par la feuille d'assemblage
  // (titrée du nom du deck) — l'assemblage partiel est autorisé, le bouton
  // primaire reflète le nombre réellement possédé.
  await page.getByRole('button', { name: 'Assemble', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Assemble E2E lifecycle deck' })).toBeVisible()
  await page.getByRole('button', { name: 'Assemble with 1 card' }).click()

  // Un deck monté se lit depuis `Collection › Decks` (`router.replace`) :
  // attendre cette navigation, qui remonte l'écran sur son onglet `List`.
  await expect(page).toHaveURL(new RegExp(`/collection/decks/${deck.id}$`))
  await expect(page.getByText('Collection › Decks')).toBeVisible()

  // Le bandeau « In your collection » et son bouton `Dismantle` vivent sur
  // l'onglet `Infos` du deck monté.
  await page.getByRole('button', { name: 'Infos', exact: true }).click()
  await expect(page.getByText('In your collection')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismantle', exact: true })).toBeVisible()

  // built -> dismantled, confirmé par la feuille `Dismantle deck` —
  // toutes les cartes reviennent au container choisi. La destination
  // présélectionnée par défaut est « Loose collection »
  // (`listDismantleTargetsAction` renvoie la racine en premier,
  // `dismantle-sheet.tsx` la présélectionne) — c'est-à-dire `rootId` lui-même,
  // le container qui détenait DÉJÀ le stock adossant cette carte — le chemin
  // par défaut, qui doit donc être couvert.
  await page.getByRole('button', { name: 'Dismantle', exact: true }).click()
  const dismantleSheet = page.getByRole('dialog', { name: 'Dismantle deck' })
  await expect(dismantleSheet).toBeVisible()
  // Mode `keep` présélectionné : les cartes reviennent à la collection.
  await expect(
    dismantleSheet.getByRole('button', { name: /^Return the cards to the collection/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dismantleSheet.getByRole('button', { name: 'Dismantle', exact: true }).click()

  // Un deck démonté n'est plus « built » : la carte verte disparaît et le
  // menu `···` propose « Restart » plutôt que Dismantle/
  // Move back to Assemble (`dismantled → plan`).
  await expect(page.getByText('In your collection')).toHaveCount(0)
  await page.getByRole('button', { name: 'Deck actions' }).click()
  const deckMenu = page.getByRole('dialog', { name: 'E2E lifecycle deck' })
  await expect(deckMenu.getByRole('button', { name: /^Restart/ })).toBeVisible()
  await expect(deckMenu.getByRole('button', { name: /^Dismantle/ })).toHaveCount(0)

  // La carte a réellement été réglée vers la racine (destination par
  // défaut) : ni doublée, ni laissée bloquée sur le deck sans que rien ne
  // bouge (exclure la racine de son propre pool source le viderait quand la
  // racine est elle-même la destination).
  const rootHoldings = await db.select().from(holdings).where(eq(holdings.containerId, rootId))
  expect(rootHoldings).toHaveLength(1)
  expect(rootHoldings[0]?.cardId).toBe(cardId)
  expect(rootHoldings[0]?.qty).toBe(1)

  const deckHoldings = await db.select().from(holdings).where(eq(holdings.containerId, deck.id))
  expect(deckHoldings).toHaveLength(0)
})

test('exporting the missing cards copies the formatted list to the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const email = await signInWithFreshAccount(page)
  const userId = await findUserId(email)
  const collectionId = await findCollectionId(userId)

  const cardId = randomUUID()
  await insertCard(cardId, 'Missing Card')

  const deck = await createContainer(userId, collectionId, {
    kind: 'deck',
    name: 'E2E export deck',
    format: 'modern',
    deckState: 'plan',
  })
  // Jamais possédée nulle part : reste `missing` quel que soit l'état des
  // interrupteurs `Take cards from`.
  await addHolding(userId, { containerId: deck.id, cardId, finish: 'nonfoil', condition: 'nm', language: 'en' }, 1)

  await page.goto(`/decks/${deck.id}`)
  await page.getByRole('button', { name: 'Assemble', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Assemble E2E export deck' })).toBeVisible()

  await page.getByRole('button', { name: 'Export missing' }).click()
  const exportSheet = page.getByRole('dialog', { name: 'Export 1 missing card' })
  await expect(exportSheet).toBeVisible()

  // Le format par défaut est Card Kingdom ; le format `Plain text` est
  // celui de `formatDeckList` vérifié plus bas.
  await exportSheet.getByRole('button', { name: /^Plain text/ }).click()
  await exportSheet.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(exportSheet.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
  // `formatDeckList` : « <qty> <name> (<SET>) <collector_number> ».
  expect(clipboardText.trim()).toBe('1 Missing Card (E2E) 1')
})
