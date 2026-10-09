// Test unitaire : `consumeStockRows` (`lib/decks/assemble.ts`) est le cœur pur
// du règlement physique du démontage — pure, aucun accès base, même contrainte
// que `computeManaCurve`/`isLand` (`deck-data.ts`). Prouve ici ce que la base
// ne peut pas prouver à elle seule sans dupliquer la logique dans le test :
// l'identité (finish/condition/language) transportée est celle de L'EXEMPLAIRE
// RÉELLEMENT CONSOMMÉ, jamais une valeur imposée par l'appelant — l'exclusion
// du container cible, elle, est un filtre SQL (`decrementLooseStock`) et reste
// couverte par `tests/integration/assemble.test.ts`, qui l'exprime
// explicitement (lignes multiples pour une même carte, adossement
// multi-finition).
import { describe, expect, it } from 'vitest'

import { consumeStockRows, type StockCandidate } from '@/lib/decks/assemble'

function candidate(overrides: Partial<StockCandidate> & { id: string; qty: number }): StockCandidate {
  return {
    containerId: 'container-1',
    finish: 'nonfoil',
    condition: 'nm',
    language: 'en',
    ...overrides,
  }
}

describe('consumeStockRows — l’identité réelle de l’exemplaire prélevé', () => {
  it('carries the consumed row’s own finish/condition/language, never a caller-imposed identity', () => {
    // Un seul exemplaire réel : foil, LP, français — adosse une déclaration
    // de deck qui, elle, est presque toujours nonfoil/NM/en par défaut.
    const rows = [candidate({ id: 'h1', qty: 1, finish: 'foil', condition: 'lp', language: 'fr' })]

    const result = consumeStockRows(rows, 1)

    expect(result.takenQty).toBe(1)
    expect(result.consumed).toEqual([{ finish: 'foil', condition: 'lp', language: 'fr', qty: 1 }])
    // La ligne source, entièrement consommée, est supprimée — jamais
    // laissée à côté d'une copie recréée ailleurs sous une autre identité
    // (ce qui doublerait l'exemplaire au lieu de le transférer).
    expect(result.deletions).toEqual(['h1'])
    expect(result.updates).toEqual([])
  })

  it('groups consumption by identity when several finishes back the same card', () => {
    // Une carte nonfoil-NM-en (1) et une copie foil-NM-en (2) couvrent
    // ensemble un besoin de 3 — deux groupes distincts en sortie, chacun
    // avec SA propre identité, jamais fondus en une seule ligne moyenne.
    const rows = [
      candidate({ id: 'nonfoil-1', qty: 1, finish: 'nonfoil' }),
      candidate({ id: 'foil-1', qty: 2, finish: 'foil' }),
    ]

    const result = consumeStockRows(rows, 3)

    expect(result.takenQty).toBe(3)
    expect(result.consumed).toEqual(
      expect.arrayContaining([
        { finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
        { finish: 'foil', condition: 'nm', language: 'en', qty: 2 },
      ]),
    )
    expect(result.consumed).toHaveLength(2)
    expect(result.deletions.sort()).toEqual(['foil-1', 'nonfoil-1'])
  })

  it('merges two source rows sharing the same identity into a single consumed group', () => {
    const rows = [
      candidate({ id: 'a', qty: 1 }),
      candidate({ id: 'b', qty: 1 }),
    ]

    const result = consumeStockRows(rows, 2)

    expect(result.consumed).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 }])
    expect(result.deletions.sort()).toEqual(['a', 'b'])
  })

  it('never materializes stock beyond what the candidate rows actually hold', () => {
    const rows = [candidate({ id: 'h1', qty: 1 })]

    const result = consumeStockRows(rows, 5)

    expect(result.takenQty).toBe(1)
    expect(result.consumed).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }])
    expect(result.deletions).toEqual(['h1'])
  })

  it('partially consumes a row and reports an update rather than a deletion', () => {
    const rows = [candidate({ id: 'h1', qty: 5 })]

    const result = consumeStockRows(rows, 2)

    expect(result.takenQty).toBe(2)
    expect(result.deletions).toEqual([])
    expect(result.updates).toEqual([{ id: 'h1', qty: 3 }])
  })

  it('respects the order given by the caller (root-first, then holding id) without reordering', () => {
    const rows = [
      candidate({ id: 'root-row', containerId: 'root', qty: 1 }),
      candidate({ id: 'binder-row', containerId: 'binder', qty: 1 }),
    ]

    const result = consumeStockRows(rows, 1)

    expect(result.deletions).toEqual(['root-row'])
    expect(result.touchedContainerIds).toEqual(['root'])
  })

  it('returns nothing for a zero or already-satisfied need', () => {
    const result = consumeStockRows([candidate({ id: 'h1', qty: 3 })], 0)
    expect(result).toEqual({
      takenQty: 0,
      touchedContainerIds: [],
      consumed: [],
      settledInPlace: [],
      deletions: [],
      updates: [],
    })
  })
})

// Une ligne `inTarget` (déjà présente dans le container cible du
// démontage) ne doit produire NI suppression NI mise à jour — la consommer
// ne déplace rien, la ligne garde son id et son added_at (patron
// `moveHoldings`, `lib/containers/holdings.ts:359-362`). Une ligne cible
// entièrement consommée qui finirait dans `deletions` serait recréée sous un
// id neuf par la boucle de dépôt de `dismantleDeck`, faute de la retrouver.
describe('consumeStockRows — une ligne déjà dans la cible ne bouge jamais', () => {
  it('fully consumes an in-target row into settledInPlace, never deletions/updates/consumed', () => {
    const rows = [candidate({ id: 'target-row', containerId: 'target', qty: 1, inTarget: true })]

    const result = consumeStockRows(rows, 1)

    expect(result.takenQty).toBe(1)
    expect(result.settledInPlace).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }])
    expect(result.consumed).toEqual([])
    expect(result.deletions).toEqual([])
    expect(result.updates).toEqual([])
  })

  it('partially consumes an in-target row (consumableQty override) without ever touching updates', () => {
    // La ligne cible détient réellement 5, mais 3 ont déjà été comptés plus
    // tôt dans le même run (`depositedThisRun`) — seul le reste (2) est
    // consommable ici. La ligne réelle (`qty: 5`) ne doit jamais apparaître
    // dans `updates` : rien ne bouge physiquement pour une ligne `inTarget`.
    const rows = [candidate({ id: 'target-row', containerId: 'target', qty: 5, consumableQty: 2, inTarget: true })]

    const result = consumeStockRows(rows, 2)

    expect(result.takenQty).toBe(2)
    expect(result.settledInPlace).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 }])
    expect(result.updates).toEqual([])
    expect(result.deletions).toEqual([])
  })

  it('skips an in-target row whose consumableQty has been fully spoken for (taken <= 0 branch)', () => {
    // Toute la ligne cible a déjà été comptée ce run (`consumableQty: 0`) —
    // une seconde ligne du deck pour la même carte doit retomber sur une
    // autre source, jamais re-consommer ce qui est déjà spoken for.
    const rows = [
      candidate({ id: 'target-row', containerId: 'target', qty: 5, consumableQty: 0, inTarget: true }),
      candidate({ id: 'other-row', containerId: 'other', qty: 1 }),
    ]

    const result = consumeStockRows(rows, 1)

    expect(result.takenQty).toBe(1)
    expect(result.settledInPlace).toEqual([])
    expect(result.consumed).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }])
    expect(result.deletions).toEqual(['other-row'])
  })

  it('mixes an in-target row and an elsewhere row for the same need: only the elsewhere row is moved', () => {
    // La cible détient déjà 1, un autre container en détient 1 : besoin de
    // 2. Le premier ne produit aucune écriture (settledInPlace), le second
    // doit effectivement être déplacé (consumed → fusion/insertion côté
    // appelant).
    const rows = [
      candidate({ id: 'target-row', containerId: 'target', qty: 1, inTarget: true }),
      candidate({ id: 'elsewhere-row', containerId: 'elsewhere', qty: 1 }),
    ]

    const result = consumeStockRows(rows, 2)

    expect(result.takenQty).toBe(2)
    expect(result.settledInPlace).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }])
    expect(result.consumed).toEqual([{ finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 }])
    expect(result.deletions).toEqual(['elsewhere-row'])
    expect(result.updates).toEqual([])
  })
})

// Identité prélevée et lignes `inTarget` combinées : mirroir de
// l'orchestration réelle de `dismantleDeck`/`decrementLooseStock`
// (`lib/decks/assemble.ts`) contre un store en mémoire, appelant le VRAI
// `consumeStockRows` exporté à chaque ligne de deck — même patron que
// `depositedThisRun` (clé `cardId|finish|condition|language`), même
// distinction `consumed`/`settledInPlace`. Seul niveau exécutable ici pour
// prouver le comportement MULTI-CARTES : `tests/integration/assemble.test.ts`
// couvre le même contrat contre une vraie base, mais exige Docker. Toute
// divergence entre ce mirroir
// et l'implémentation réelle échapperait à ce test — seule l'intégration
// contre Postgres ferme ce dernier trou — mais une régression sur la clé de
// `depositedThisRun` (l'oubli de `cardId`) ou sur le traitement des lignes
// `inTarget` romprait ce test si elle était
// reportée ici, exactement le trou que les sept tests précédents (une seule
// carte à la fois) ne pouvaient pas voir.
describe('consumeStockRows — simulation multi-cartes du règlement complet de dismantleDeck', () => {
  interface StoreRow {
    id: string
    containerId: string
    cardId: string
    finish: string
    condition: string
    language: string
    qty: number
  }

  function simulateDismantle(
    store: StoreRow[],
    rootContainerId: string,
    deckLines: Array<{ cardId: string; finish: string; condition: string; language: string; qty: number }>,
    targetContainerId: string,
  ): { returned: number; store: StoreRow[] } {
    const depositedThisRun = new Map<string, number>()
    let returned = 0

    for (const line of deckLines) {
      const candidateRows = store
        .filter((row) => row.cardId === line.cardId)
        .sort((a, b) => {
          const ka = a.containerId === rootContainerId ? 0 : 1
          const kb = b.containerId === rootContainerId ? 0 : 1
          if (ka !== kb) return ka - kb
          return a.id.localeCompare(b.id)
        })

      const candidates: StockCandidate[] = candidateRows.map((row) => {
        const inTarget = row.containerId === targetContainerId
        let consumableQty = row.qty
        if (inTarget) {
          const key = `${line.cardId}|${row.finish}|${row.condition}|${row.language}`
          consumableQty = Math.max(0, row.qty - (depositedThisRun.get(key) ?? 0))
        }
        return {
          id: row.id,
          containerId: row.containerId,
          qty: row.qty,
          consumableQty,
          finish: row.finish as StockCandidate['finish'],
          condition: row.condition as StockCandidate['condition'],
          language: row.language,
          inTarget,
        }
      })

      const result = consumeStockRows(candidates, line.qty)

      for (const id of result.deletions) {
        const idx = store.findIndex((r) => r.id === id)
        if (idx >= 0) store.splice(idx, 1)
      }
      for (const update of result.updates) {
        const row = store.find((r) => r.id === update.id)
        if (row) row.qty = update.qty
      }
      for (const group of result.settledInPlace) {
        const key = `${line.cardId}|${group.finish}|${group.condition}|${group.language}`
        depositedThisRun.set(key, (depositedThisRun.get(key) ?? 0) + group.qty)
      }
      for (const group of result.consumed) {
        const existing = store.find(
          (r) =>
            r.containerId === targetContainerId &&
            r.cardId === line.cardId &&
            r.finish === group.finish &&
            r.condition === group.condition &&
            r.language === group.language,
        )
        if (existing) {
          existing.qty += group.qty
        } else {
          store.push({
            id: `new-${store.length}-${returned}`,
            containerId: targetContainerId,
            cardId: line.cardId,
            finish: group.finish,
            condition: group.condition,
            language: group.language,
            qty: group.qty,
          })
        }
        const key = `${line.cardId}|${group.finish}|${group.condition}|${group.language}`
        depositedThisRun.set(key, (depositedThisRun.get(key) ?? 0) + group.qty)
      }

      returned += result.takenQty
    }

    return { returned, store }
  }

  it('3-card deck backed by the root, target = root: settles every card, not just the first', () => {
    // Régression de la clé sans `cardId` : régler la carte A retranchait
    // alors son montant du `consumableQty` des cartes B et C dans le MÊME
    // container cible — `returned` plafonnait à 4/6 (B et C survivaient
    // partiellement).
    const store: StoreRow[] = [
      { id: 'ra', containerId: 'root', cardId: 'A', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
      { id: 'rb', containerId: 'root', cardId: 'B', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
      { id: 'rc', containerId: 'root', cardId: 'C', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 4 },
    ]

    const { returned, store: after } = simulateDismantle(
      store,
      'root',
      [
        { cardId: 'A', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
        { cardId: 'B', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
        { cardId: 'C', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 4 },
      ],
      'root',
    )

    expect(returned).toBe(6)
    // Aucun id n'a changé : rien n'a bougé, tout était déjà à la cible.
    expect(after.map((r) => r.id).sort()).toEqual(['ra', 'rb', 'rc'])
  })

  it('2-card deck fully backed by the target binder: settles both, ids preserved', () => {
    const store: StoreRow[] = [
      { id: 'ba', containerId: 'binder', cardId: 'A', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 },
      { id: 'bb', containerId: 'binder', cardId: 'B', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 },
    ]

    const { returned, store: after } = simulateDismantle(
      store,
      'root',
      [
        { cardId: 'A', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 },
        { cardId: 'B', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 },
      ],
      'binder',
    )

    expect(returned).toBe(4)
    expect(after).toEqual(store) // identiques : aucune écriture n'a eu lieu
  })

  it('two deck lines for the same card in different finishes: each settles from its own identity', () => {
    const store: StoreRow[] = [
      { id: 'nonfoil-x', containerId: 'root', cardId: 'X', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
      { id: 'foil-x', containerId: 'root', cardId: 'X', finish: 'foil', condition: 'nm', language: 'en', qty: 1 },
    ]

    const { returned, store: after } = simulateDismantle(
      store,
      'root',
      [
        { cardId: 'X', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
        { cardId: 'X', finish: 'foil', condition: 'nm', language: 'en', qty: 1 },
      ],
      'root',
    )

    expect(returned).toBe(2)
    expect(after.map((r) => r.id).sort()).toEqual(['foil-x', 'nonfoil-x'])
  })

  it('mixed: the target holds some copies and a third container holds the rest', () => {
    const store: StoreRow[] = [
      { id: 'target-row', containerId: 'target', cardId: 'Y', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 1 },
      { id: 'third-row', containerId: 'third', cardId: 'Y', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 2 },
    ]

    const { returned, store: after } = simulateDismantle(
      store,
      'root',
      [{ cardId: 'Y', finish: 'nonfoil', condition: 'nm', language: 'en', qty: 3 }],
      'target',
    )

    expect(returned).toBe(3)
    const targetRow = after.find((r) => r.containerId === 'target' && r.cardId === 'Y')
    expect(targetRow?.id).toBe('target-row') // jamais recréée sous un id neuf
    expect(targetRow?.qty).toBe(3)
    expect(after.find((r) => r.containerId === 'third')).toBeUndefined()
  })
})
