// Tests unitaires de `lib/containers/bulk.ts` — exécutés sans Postgres,
// contrairement à `tests/integration/bulk-actions.test.ts` qui se saute
// lui-même en l'absence de `TEST_DATABASE_URL` (Docker indisponible ici,
// voir son commentaire d'en-tête). Couvrent deux pièges :
//
// 1. `resolveTargetHoldingIds` sur une sélection explicite doit annuler
//    toute la transaction dès qu'un id demandé n'existe plus — pas seulement
//    sur une course de quelques microsecondes entre deux lectures identiques.
// 2. `planBulkEdit` — la fonction pure extraite de `bulkEdit` — doit
//    préserver la quantité totale et rester réversible quand une édition
//    groupée fait coïncider deux lignes sélectionnées sur la clé.
import { describe, expect, it } from 'vitest'

import type { Condition, DeckZone, Finish, Holding } from '@spellcache/db/schema'
import {
  bulkEditGroupKey,
  planBulkEdit,
  resolveTargetHoldingIds,
  type BulkTarget,
} from '@/lib/containers/bulk'

function makeHolding(overrides: Partial<Holding> & { id: string }): Holding {
  return {
    containerId: 'container-1',
    cardId: 'card-1',
    qty: 1,
    finish: 'nonfoil' as Finish,
    condition: 'nm' as Condition,
    language: 'en',
    notes: null,
    isCommander: false,
    // Colonne des zones de deck (`packages/db/src/schema.ts`, `holdings.zone`) :
    // ce fixture ne teste aucun comportement de deck (bulk sur la
    // collection/binders), `main` reproduit le défaut de colonne pour ne rien
    // changer au comportement testé ici.
    zone: 'main' as DeckZone,
    addedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

// Fausse transaction Drizzle : chaque méthode de la chaîne (`select`, `from`,
// `where`, `for`) renvoie l'objet lui-même, `then` résout la liste de lignes
// fournie — suffisant pour la seule requête que `resolveTargetHoldingIds`
// exécute sur une sélection explicite (`select({id}).from(holdings).where(
// ...).for('update')`), sans dépendre du vrai driver `pg`.
function fakeTx(existingIds: string[]) {
  const rows = existingIds.map((id) => ({ id }))
  const builder: {
    select: (...args: unknown[]) => typeof builder
    from: (...args: unknown[]) => typeof builder
    where: (...args: unknown[]) => typeof builder
    for: (...args: unknown[]) => typeof builder
    then: Promise<typeof rows>['then']
  } = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    for: () => builder,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  }
  return builder
}

describe('resolveTargetHoldingIds — transaction annulée sur holding disparu', () => {
  it('throws when a targeted holding no longer resolves, instead of silently applying to the survivors', async () => {
    // 12 ids demandés, dont un a été supprimé entre la construction de la
    // sélection côté écran et l'exécution de l'action groupée — seuls 11
    // existent encore en base.
    const requested = Array.from({ length: 12 }, (_, i) => `holding-${i}`)
    const existing = requested.filter((id) => id !== 'holding-7')
    const tx = fakeTx(existing)
    const target: BulkTarget = { containerId: 'container-1', holdingIds: requested }

    await expect(resolveTargetHoldingIds(tx as never, 'user-1', target)).rejects.toThrow()
  })

  it('resolves normally when every requested id still exists', async () => {
    const requested = ['holding-a', 'holding-b', 'holding-c']
    const tx = fakeTx(requested)
    const target: BulkTarget = { containerId: 'container-1', holdingIds: requested }

    await expect(resolveTargetHoldingIds(tx as never, 'user-1', target)).resolves.toEqual(
      requested,
    )
  })

  it('returns an empty array without querying when holdingIds is empty', async () => {
    const tx = fakeTx(['should-not-be-read'])
    const target: BulkTarget = { containerId: 'container-1', holdingIds: [] }

    await expect(resolveTargetHoldingIds(tx as never, 'user-1', target)).resolves.toEqual(
      [],
    )
  })
})

describe('planBulkEdit — quantité totale conservée, réversible', () => {
  it('preserves the total quantity when a bulk edit makes two selected rows collide on their key', () => {
    // A(nm, qty 2) et B(lp, qty 3) de la même carte ; edit = { condition:
    // 'lp' } fait coïncider les deux sur la même clé cible.
    const a = makeHolding({ id: 'holding-a', qty: 2, condition: 'nm' })
    const b = makeHolding({ id: 'holding-b', qty: 3, condition: 'lp' })

    const plan = planBulkEdit([a, b], { condition: 'lp' }, new Map())

    expect(plan.items).toHaveLength(1)
    const [item] = plan.items
    expect(item!.qty).toBe(5)
    expect(item!.survivorId).toBe('holding-a')
    expect(item!.removedIds).toEqual(['holding-b'])

    // Réversibilité : la somme des `qty` restaurables (la ligne survivante
    // moins tout ce qui lui a été fusionné, plus chaque ligne fusionnée
    // réinsérée à l'identique) doit reconstituer exactement le total.
    const mergedOps = plan.operations.filter((op) => op.mergedInto !== null)
    const survivorOp = plan.operations.find((op) => op.mergedInto === null)
    expect(survivorOp).toBeDefined()
    expect(mergedOps).toHaveLength(1)
    const totalAfterFullUndo =
      item!.qty -
      mergedOps.reduce((sum, op) => sum + op.mergedInto!.addedQty, 0) +
      mergedOps[0]!.before.qty
    expect(totalAfterFullUndo).toBe(a.qty + b.qty)
  })

  it('produces the same total and survivor regardless of the row scan order (no ORDER BY guarantee)', () => {
    const a = makeHolding({ id: 'holding-a', qty: 2, condition: 'nm' })
    const b = makeHolding({ id: 'holding-b', qty: 3, condition: 'lp' })

    const forward = planBulkEdit([a, b], { condition: 'lp' }, new Map())
    const reversed = planBulkEdit([b, a], { condition: 'lp' }, new Map())

    expect(reversed.items).toEqual(forward.items)
  })

  it('leaves untouched rows alone and does not merge rows that keep distinct keys', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      makeHolding({ id: `holding-${i}`, cardId: `card-${i}`, qty: 3, finish: 'foil' }),
    )

    const plan = planBulkEdit(rows, { condition: 'lp' }, new Map())

    expect(plan.items).toHaveLength(12)
    for (const item of plan.items) {
      expect(item.qty).toBe(3)
      expect(item.finish).toBe('foil')
      expect(item.condition).toBe('lp')
      expect(item.removedIds).toEqual([])
    }
    expect(plan.operations.every((op) => op.mergedInto === null)).toBe(true)
  })

  it('merges into a pre-existing row outside the selection (external collision) and sums quantities', () => {
    const selected = makeHolding({
      id: 'holding-selected',
      qty: 2,
      condition: 'nm',
      isCommander: false,
    })
    const external = makeHolding({
      id: 'holding-external',
      qty: 4,
      condition: 'lp',
      isCommander: true,
    })

    const key = bulkEditGroupKey(
      external.containerId,
      external.cardId,
      external.finish,
      external.condition,
      external.language,
      external.zone,
    )
    const externalCollisions = new Map([[key, external]])

    const plan = planBulkEdit([selected], { condition: 'lp' }, externalCollisions)

    expect(plan.items).toHaveLength(1)
    const [item] = plan.items
    expect(item!.survivorId).toBe('holding-external')
    expect(item!.qty).toBe(6)
    expect(item!.isCommander).toBe(true)
    expect(item!.removedIds).toEqual(['holding-selected'])

    const [op] = plan.operations
    expect(op!.mergedInto).toEqual({
      id: 'holding-external',
      addedQty: 2,
      isCommanderBefore: true,
    })
  })

  it('captures the survivor is_commander state from before the merge, for bulkUndo to restore exactly', () => {
    // Le survivant (id le plus petit) n'est PAS commandant ; la ligne
    // fusionnée l'est. Le total après fusion doit être commandant (OR), mais
    // `isCommanderBefore` doit rester `false` — l'état du survivant avant la
    // fusion — pour que `bulkUndo` puisse revenir en arrière sans laisser
    // `is_commander` à true.
    const survivor = makeHolding({
      id: 'holding-a',
      qty: 1,
      condition: 'nm',
      isCommander: false,
    })
    const mergedAway = makeHolding({
      id: 'holding-b',
      qty: 1,
      condition: 'lp',
      isCommander: true,
    })

    const plan = planBulkEdit([survivor, mergedAway], { condition: 'lp' }, new Map())

    const [item] = plan.items
    expect(item!.isCommander).toBe(true)

    const mergedOp = plan.operations.find((op) => op.mergedInto !== null)
    expect(mergedOp?.mergedInto?.isCommanderBefore).toBe(false)
  })

  // La meme carte au main et au side d'un
  // deck ne doit jamais fusionner dans une edition groupee — leur zone les
  // distingue, au meme titre que finish/condition/language. Ceci ne tient
  // que quand la destination EST un deck (`targetZoneMatters` par defaut a
  // `true`, sa valeur pour toute edition qui ne deplace pas de container ou
  // qui deplace vers un autre deck) — voir le test symetrique ci-dessous
  // pour la destination non-deck.
  it('never merges the same card across zones (main vs side) when the destination is a deck', () => {
    const mainRow = makeHolding({ id: 'holding-main', qty: 2, zone: 'main' as DeckZone })
    const sideRow = makeHolding({ id: 'holding-side', qty: 3, zone: 'side' as DeckZone })

    // Une edition qui ne touche ni condition ni finish (un simple
    // bulkEdit de quantite/deplacement) ne doit pas faire coincider les
    // deux zones sur la meme cle. `targetZoneMatters` omis == `true` (le
    // defaut), le cas couvert par ce test.
    const plan = planBulkEdit([mainRow, sideRow], {}, new Map())

    expect(plan.items).toHaveLength(2)
    const mainItem = plan.items.find((item) => item.survivorId === 'holding-main')
    const sideItem = plan.items.find((item) => item.survivorId === 'holding-side')
    expect(mainItem?.qty).toBe(2)
    expect(sideItem?.qty).toBe(3)
    expect(mainItem?.removedIds).toEqual([])
    expect(sideItem?.removedIds).toEqual([])
  })

  // Branche `targetZoneMatters = false` de `planBulkEdit` — les quatre
  // appels ci-dessus passent tous trois arguments, donc n'exercent que
  // `targetZoneMatters = true` (le defaut). `bulkEdit` fixe ce
  // parametre a `false` quand la destination n'est pas un deck (binder ou
  // racine de collection) : la zone n'y a aucun sens, et les lignes main/
  // side de la meme carte doivent alors fusionner en une seule, comme avant
  // l'introduction des zones — meme regle que `moveHoldings` (`lib/containers/holdings.ts`).
  it('merges the same card across zones into DEFAULT_ZONE when the destination is not a deck', () => {
    const mainRow = makeHolding({ id: 'holding-main', qty: 2, zone: 'main' as DeckZone })
    const sideRow = makeHolding({ id: 'holding-side', qty: 3, zone: 'side' as DeckZone })

    const plan = planBulkEdit([mainRow, sideRow], {}, new Map(), false)

    expect(plan.items).toHaveLength(1)
    const [item] = plan.items
    expect(item!.zone).toBe('main')
    expect(item!.qty).toBe(5)
    // Survivant deterministe : id le plus petit du lot ('holding-main' <
    // 'holding-side').
    expect(item!.survivorId).toBe('holding-main')
    expect(item!.removedIds).toEqual(['holding-side'])
  })
})
