// Sentinelle de l'étagère « Built decks » : elle
// agrège plusieurs containers `kind = 'deck'` (`deck_state = 'built'`), pas
// un seul, donc aucun `containerId` réel ne la désigne — `shelves-view.tsx`
// route son tap de nom vers `/decks` plutôt que `/container/<id>`.
//
// Extraite dans ce module dédié, sans dépendance à `@spellcache/db` (donc à `pg`),
// pour être importée telle quelle — la même liaison, pas une copie — par
// `collection-data.ts` (serveur) et `shelves-view.tsx` ('use client', qui ne
// peut pas embarquer `pg` dans le bundle navigateur). Une valeur recopiée
// dans les deux modules et reliée par commentaire seulement pourrait dériver
// sans que `tsc` ni `eslint` ne le voient.
export const BUILT_DECKS_SHELF_ID = 'built-decks'
