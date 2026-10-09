'use server'

// Mutations et lectures côté client de l'écran de deck en préparation. Toute
// entrée externe est validée par Zod à la frontière (docs/development.md)
// avant d'atteindre `lib/containers/holdings.ts` — la seule voie d'écriture
// sur `holdings`.
//
// `addToDeckAction` est délibérément optimiste et locale : le tiroir ne doit
// pas se fermer après un ajout, donc aucune navigation ni `revalidatePath`
// global qui remonterait l'écran. Elle ne relit que ce qui a changé
// (couverture, quantité de la carte ajoutée), jamais `revalidatePath`, jamais
// de redirection.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { holdings } from '@spellcache/db/schema'
import { requireSession } from '@/lib/auth-guards'
import { requireContainerAccess } from '@/lib/collections/authorize'
import { addHolding, updateHolding } from '@/lib/containers/holdings'
import { db } from '@spellcache/db'

import {
  getDeck,
  searchDeckCards,
  type AddDrawerCard,
  type DeckDetail,
} from './deck-data'

const zoneSchema = z.enum(['main', 'side', 'commander'])

// La zone `commander` n'accepte qu'une seule carte à la fois (le segmenté ne
// doit pas pouvoir ajouter un commandant de trop) — `getDeck`/
// `DeckDetail.commander` et `decks-data.ts` (`limit 1`) ne représentent tous
// deux qu'un seul commandant, jamais une paire en partenariat : ce plafond est
// donc fixé à 1, pas 2, pour rester représentable par le contrat livré plutôt
// que d'inventer un mode partenaire qu'aucun type ni écran ne porte.
// Lit `is_commander`, pas `zone` : `getDeck`
// (`deck-data.ts`, `slotsNormalized`) traite déjà `is_commander` comme
// l'unique source de vérité pour distinguer un commandant, `zone` n'étant
// qu'une projection tenue en phase à chaque point d'écriture
// (`addToDeckAction`, `setZoneAction`) et rattrapée pour l'historique par la
// migration 0009 — jamais l'inverse. Sur une ligne que cette migration n'a
// pas encore atteinte (fenêtre de déploiement, écriture directe en base),
// `zone` peut valoir autre chose que `'commander'` alors que
// `is_commander = true` : lire `zone` ici laisserait passer un second
// commandant que `getDeck` ne rendrait ensuite qu'une seule fois, rendant
// l'autre invisible mais toujours compté dans `coverage`/`evaluateDeck`.
async function hasCommanderHolding(deckId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: holdings.id })
    .from(holdings)
    .where(and(eq(holdings.containerId, deckId), eq(holdings.isCommander, true)))
    .limit(1)
  return row !== undefined
}

const finishSchema = z.enum(['nonfoil', 'foil', 'etched'])

const addToDeckSchema = z.object({
  deckId: z.uuid(),
  cardId: z.uuid(),
  zone: zoneSchema,
  // Sélecteur d'impression à la demande — optionnel : le tiroir ajoute
  // toujours en `nonfoil` par défaut (un seul tap), ce champ ne porte que le
  // choix explicite fait dans le sélecteur ouvert depuis `AddRow`
  // (`components/decks/add-drawer.tsx`).
  finish: finishSchema.optional(),
})

export async function addToDeckAction(
  input: unknown,
): Promise<
  | { ok: true; qtyInDeck: number; coverage: DeckDetail['coverage'] }
  | { ok: false; error: string }
> {
  const parsed = addToDeckSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()
  const { deckId, cardId, zone, finish } = parsed.data

  try {
    // Autorisation d'abord, toute autre lecture ensuite (docs/development.md, « une
    // seule voie d'autorisation ») : appelé sur un `deckId` brut avant tout
    // contrôle d'accès, `hasCommanderHolding` deviendrait un oracle de
    // présence de commandant sur n'importe quel deck pour n'importe quel
    // compte connecté, autorisé ou non. `addHolding`
    // ci-dessous vérifie de nouveau cet accès (même patron que
    // `saveBinderLookAction`) — la vérification explicite ici couvre le
    // chemin de lecture qui la précède.
    await requireContainerAccess(user.id, deckId, 'write')

    if (zone === 'commander' && (await hasCommanderHolding(deckId))) {
      return { ok: false, error: 'commander_full' }
    }

    // Un tap ajoute un exemplaire (dix taps pour dix cartes) — jamais un
    // choix de quantité, contrairement à `AddCardSheet`. `finish` par défaut
    // `nonfoil` (le tap rapide du bouton `+`) sauf sélection explicite depuis
    // le sélecteur d'impression à la demande (`components/decks/add-drawer.tsx`).
    // Condition/langue restent fixes (NM/en) : le design ne prévoit aucun
    // sélecteur pour elles ici, contrairement à `finish`.
    // `zone === 'commander'` et `is_commander = true` s'écrivent dans la même
    // transaction (même règle que `createDeckAction`,
    // `app/(app)/decks/actions.ts`) : un second appel à `updateHolding` après
    // coup laisserait une fenêtre où un échec entre les deux écritures
    // produirait `zone = 'commander'` avec `is_commander = false`, un état que
    // ni `getDeck` (`slots.find(s => s.isCommander)`) ni `hasCommanderHolding`
    // ne savent démêler — le deck deviendrait irrécupérable depuis l'interface.
    await addHolding(
      user.id,
      {
        containerId: deckId,
        cardId,
        finish: finish ?? 'nonfoil',
        condition: 'nm',
        language: 'en',
        zone,
      },
      1,
      { isCommander: zone === 'commander' },
    )

    // Relit uniquement ce que l'écran doit mettre à jour après cet ajout
    // (compteur d'en-tête, badge `in deck ×N`) — pas un `revalidatePath`
    // (voir plus haut).
    const deck = await getDeck(user.id, deckId)
    // Quantité de CETTE zone uniquement (`addToDeckAction` renvoie
    // `{ qtyInDeck }`) — la même carte peut porter un exemplaire au side et un
    // autre au main (`holdings.zone` fait partie de la clé d'unicité) ; sommer
    // les deux zones gonflerait le compteur de la zone qui vient de recevoir
    // l'ajout, exactement ce que `handleCardAdded` (`deck-view.tsx`) réécrit
    // dans le slot de `addedZone`.
    const qtyInDeck = deck.slots
      .filter((slot) => slot.cardId === cardId && slot.zone === zone)
      .reduce((sum, slot) => sum + slot.need, 0)

    return { ok: true, qtyInDeck, coverage: deck.coverage }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const setZoneSchema = z.object({
  holdingId: z.uuid(),
  zone: zoneSchema,
})

// Change la zone d'un holding déjà ajouté. Le design ne prévoit aucun
// déclencheur pour cette action depuis l'écran de deck lui-même (le segmenté
// du tiroir choisit la zone d'un *ajout*, une seule fois par session, jamais
// celle d'un holding existant) : même précédent que
// `removeMemberAction`/`changeMemberRoleAction` — l'action existe et est prête,
// sans surface d'interface tant que le design n'en prévoit pas.
export async function setZoneAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setZoneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const user = await requireSession()

  try {
    const [row] = await db
      .select({ containerId: holdings.containerId, isCommander: holdings.isCommander })
      .from(holdings)
      .where(eq(holdings.id, parsed.data.holdingId))
      .limit(1)
    if (!row) return { ok: false, error: 'not_found' }

    // Autorisation avant toute décision fondée sur ce holding (même règle
    // que ci-dessus) : `row` révèle déjà le
    // `containerId`, mais rien ne doit s'appuyer dessus (le plafond
    // commandant compris) avant que l'accès au container qu'il désigne ne
    // soit vérifié.
    await requireContainerAccess(user.id, row.containerId, 'write')

    // `row.isCommander`, pas `row.zone` (même lecture que
    // `hasCommanderHolding` ci-dessus) : ce garde ne fait que dispenser
    // du plafond la ligne qui EST déjà le commandant (mise à jour sans
    // changement réel) ; le lire sur `zone` le rendrait divergent de
    // `hasCommanderHolding` sur exactement la même ligne non migrée.
    if (
      parsed.data.zone === 'commander' &&
      !row.isCommander &&
      (await hasCommanderHolding(row.containerId))
    ) {
      return { ok: false, error: 'commander_full' }
    }

    // zone === 'commander' et is_commander s'écrivent toujours ensemble
    // (même règle qu'addToDeckAction et createDeckAction ci-dessus) : sans
    // ce couplage, un futur déclencheur de cette action pourrait reproduire
    // exactement la même divergence, y compris démonter un commandant existant
    // (zone changée hors de 'commander') sans jamais effacer isCommander.
    await updateHolding(user.id, parsed.data.holdingId, {
      zone: parsed.data.zone,
      isCommander: parsed.data.zone === 'commander',
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const searchDeckCardsSchema = z.object({
  deckId: z.uuid(),
  query: z.string(),
  colorIdentity: z.array(z.enum(['W', 'U', 'B', 'R', 'G'])),
  legalInColours: z.boolean(),
  ownedOnly: z.boolean(),
  limit: z.number().int().positive().max(100).optional(),
})

export async function searchDeckCardsAction(
  input: unknown,
): Promise<AddDrawerCard[] | { error: string }> {
  const parsed = searchDeckCardsSchema.safeParse(input)
  if (!parsed.success) return { error: 'invalid' }

  const user = await requireSession()

  try {
    return await searchDeckCards(user.id, parsed.data.deckId, parsed.data.colorIdentity, {
      query: parsed.data.query,
      legalInColours: parsed.data.legalInColours,
      ownedOnly: parsed.data.ownedOnly,
      limit: parsed.data.limit,
    })
  } catch {
    return { error: 'failed' }
  }
}
