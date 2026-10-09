// Machine à états du cycle de vie d'un deck : `plan → assemble → built →
// dismantled`, transitions
// unidirectionnelles sauf `built → assemble` (« remettre un deck en
// chantier ») et `dismantled → plan` (« repartir du même contenu »). Pure —
// aucun accès base, même contrainte que `lib/decks/legality.ts` :
// `canTransition` doit rester testable sans Postgres, et les gardes de
// mutation (`lib/decks/assemble.ts`, `app/(app)/decks/[id]/
// lifecycle-actions.ts`) s'appuient dessus avant toute écriture — jamais
// après (toute autre transition lève `InvalidTransitionError` et ne modifie
// pas la base).
import type { DeckState } from '@spellcache/db/schema'

export const ALLOWED_TRANSITIONS: Record<DeckState, DeckState[]> = {
  plan: ['assemble'],
  assemble: ['built', 'plan'],
  built: ['assemble', 'dismantled'],
  dismantled: ['plan'],
}

export class InvalidTransitionError extends Error {}

export function canTransition(from: DeckState, to: DeckState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

// Lève `InvalidTransitionError` plutôt que de renvoyer un booléen — le point
// d'appel (assemble.ts, lifecycle-actions.ts) l'utilise en garde avant toute
// écriture, à l'intérieur d'une transaction qu'une exception fait échouer
// entièrement (un deck monté à moitié en base est le pire état possible pour
// des données irremplaçables).
export function assertTransition(from: DeckState, to: DeckState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`Cannot transition a deck from '${from}' to '${to}'.`)
  }
}

// `assembleDeck` (lib/decks/assemble.ts) atteint `built` depuis `plan` OU
// `assemble` en une seule transaction, jamais deux commits séparés — la
// feuille `Assemble` est le point d'entrée unique du bouton
// `Assemble` de l'écran Planning, que le deck soit encore `plan` ou déjà
// `assemble` (les deux états partagent le même écran d'édition). Ce
// garde compose deux arêtes déjà autorisées par `ALLOWED_TRANSITIONS`
// (`plan → assemble` puis `assemble → built`) plutôt que d'en inventer une
// troisième `plan → built` absente du contrat — la valeur intermédiaire
// `assemble` n'est jamais lue par une autre transaction (tout se joue dans
// une seule transaction Postgres).
export function assertReachableBuilt(from: DeckState): void {
  if (from === 'assemble') {
    assertTransition('assemble', 'built')
    return
  }
  if (from === 'plan') {
    assertTransition('plan', 'assemble')
    assertTransition('assemble', 'built')
    return
  }
  throw new InvalidTransitionError(`Cannot assemble a deck in state '${from}'.`)
}
