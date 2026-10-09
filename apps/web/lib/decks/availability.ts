// Disponibilité d'une carte dans une collection : « available(cardId) =
// Σ qty hors decks built », exposée par une fonction — un seul fragment SQL,
// `availableQtyExpr` — utilisée ici et par tout autre point de lecture qui a
// besoin du même nombre (`app/(app)/container/[id]/holdings-data.ts`,
// `lib/decks/assemble.ts`) plutôt que de recalculer la même somme à trois
// endroits qui finiraient par diverger (précédent déjà rencontré avec
// `HOLDINGS_JOIN_CHAIN`).
//
// Un holding de deck n'est jamais du stock physique tant que son container
// n'est pas `built` (« possédé » et « disponible » sont deux nombres
// différents, et la réservation ne duplique rien) : la ligne d'un
// deck en `plan`/`assemble` est une déclaration de besoin, pas un exemplaire
// détenu. Une fois `built`, cette même ligne devient une réclamation sur le
// pool physique partagé — jamais un second stock qui s'additionnerait au
// premier. D'où la formule ci-dessous : le stock des containers non-deck
// (racine, binder, liste) compte plein pot, celui d'un deck `built` compte
// en négatif, celui d'un deck `plan`/`assemble` ne compte pas du tout.
import { sql, type SQL } from 'drizzle-orm'

import type { Finish } from '@spellcache/db/schema'
import { db } from '@spellcache/db'
import { uuidArray } from '@spellcache/db/array-param'

// Fragment de disponibilité nette pour une carte donnée d'une collection —
// paramétrable par une condition de finition optionnelle (`null` agrège
// toutes les finitions, comme le tiroir d'ajout du builder qui n'en
// distingue aucune ; une condition précise scope à une seule finition, comme
// une ligne de holding déjà scoped par sa propre finition). `cardIdExpr`/
// `collectionIdExpr` sont des fragments SQL, pas des valeurs JS, pour rester
// composable à l'intérieur d'une requête plus large (voir
// `holdings-data.ts`) sans devenir une sous-requête corrélée séparée par
// ligne (la calculer carte par carte fabriquerait un N+1).
// Un deck `built` monté partiellement (ex. 41/64) porte des lignes `missing`
// jamais couvertes par du stock réel — les soustraire telles quelles ferait
// passer `available` sous zéro pour une carte que personne ne possède
// (`· -1 available` rendu littéralement, `mf-compact-row.tsx`).
// `greatest(0, …)` est la seule correction nécessaire : un deck ne peut
// jamais réclamer plus que ce que la collection possède réellement hors
// deck, donc le résultat ne descend jamais sous zéro — sans ce filet, la
// soustraction reste correcte pour toute carte réellement couverte
// (3 exemplaires, 1 réservé : retourne 2).
// `excludeContainerIdExpr` (défaut `null`) retire un container précis de la
// somme, quel que soit son état — nécessaire pour qu'un deck `built` puisse
// lire la disponibilité « en dehors de lui-même » sans se soustraire sa
// propre réclamation : sans cette exclusion, une carte que le deck possède
// réellement (`root = 1`, ce deck la réclame en entier une fois `built`)
// afficherait `ownedElsewhere = 0` sur SA PROPRE ligne — la formule
// compterait le deck comme son propre concurrent et la carte qu'il sleeve
// apparaîtrait `missing` sur son propre écran. `deck-data.ts` (`getDeck`)
// passe systématiquement l'id du deck consulté ; tout autre appelant
// (`holdings-data.ts`, `lib/decks/assemble.ts`) n'a rien à exclure de
// lui-même et passe `null`.
export function availableQtyExpr(
  cardIdExpr: SQL,
  collectionIdExpr: SQL,
  finishCondition: SQL | null,
  excludeContainerIdExpr: SQL | null = null,
): SQL {
  return sql`greatest(0, (
    select coalesce(sum(case when c2.kind = 'deck' then -h2.qty else h2.qty end), 0)
    from holdings h2
    join containers c2 on c2.id = h2.container_id
    where h2.card_id = ${cardIdExpr}
      and c2.collection_id = ${collectionIdExpr}
      -- Stock physique : racine et binders. Jamais une liste — une
      -- wishlist recense des cartes voulues, pas possédées.
      and (c2.kind in ('collection', 'binder') or (c2.kind = 'deck' and c2.deck_state = 'built'))
      ${finishCondition ? sql`and (${finishCondition})` : sql``}
      ${excludeContainerIdExpr ? sql`and c2.id <> ${excludeContainerIdExpr}` : sql``}
  ))`
}

// Disponibilité d'une carte pour une finition précise : 3 exemplaires
// possédés dont 1 dans un deck `built` renvoie `2`.
export async function availableQty(
  collectionId: string,
  cardId: string,
  finish: Finish,
): Promise<number> {
  const { rows } = await db.execute<{ qty: number | string }>(sql`
    select ${availableQtyExpr(sql`${cardId}::uuid`, sql`${collectionId}::uuid`, sql`h2.finish = ${finish}`)} as qty
  `)
  return Number(rows[0]?.qty ?? 0)
}

// Disponibilité par carte pour une liste, toutes finitions confondues — une
// seule requête pour toute la liste (la calculer carte par carte fabriquerait
// un N+1 sur 1000 lignes), utilisée par le tiroir d'ajout du builder et par
// `lib/decks/assemble.ts`, qui ne distinguent pas la finition d'une carte
// désirée (même périmètre que `DeckSlot`/`AddDrawerCard`, aucun des deux ne
// porte de champ `finish`). Cette fonction ne réimplémente pas la formule :
// il n'existe qu'une seule formule de disponibilité.
// `unnest(...)` sur le tableau de `cardIds` compose `availableQtyExpr` en
// sous-requête corrélée par id, dans UNE SEULE instruction SQL (un
// aller-retour réseau, pas N — c'est le N+1 réseau qui est à éviter, pas
// l'exécution interne de Postgres) : tout ajustement de la formule de
// disponibilité n'a qu'un seul endroit où exister.
export async function availabilityMap(
  collectionId: string,
  cardIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const cardId of cardIds) map.set(cardId, 0)
  if (cardIds.length === 0) return map

  const { rows } = await db.execute<{ card_id: string; qty: number | string }>(sql`
    select cid as card_id, ${availableQtyExpr(sql`cid`, sql`${collectionId}::uuid`, null)} as qty
    from unnest(${uuidArray(cardIds)}) as cid
  `)

  for (const row of rows) map.set(row.card_id, Number(row.qty))
  return map
}
