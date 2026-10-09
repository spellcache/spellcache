'use client'

// Écran `Assemble — owned vs missing` : feuille de 812px ouverte depuis le
// bouton `Assemble` du pied de l'écran Planning. Relit `planAssembly` à
// chaque bascule des deux interrupteurs `Take cards from` (aucune écriture
// tant que le bouton `Assemble with N card(s)` n'a pas été pressé) — jamais un calcul
// client, `planAssembly` reste la seule source de vérité, base y compris
// pour la disponibilité des cartes d'un autre deck monté.
import { Boxes, Library, Plus, Share } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DecksIcon } from '@/components/ui/tab-bar'
import { SlotRow } from '@/components/decks/slot-row'
import { Segmented } from '@/components/ui/segmented'
import { SHEET_SCROLL_BLEED, Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { Currency } from '@/lib/format/money'
import { formatMoney } from '@/lib/format/money'

import { assembleDeckAction, planAssemblyAction } from './lifecycle-actions'
import type { AssemblePlan } from '@/lib/decks/assemble'
import type { DeckSlot } from './deck-data'
import { ExportSheet } from './export-sheet'
import { ScrollArea } from '@/components/ui/scroll-area'

function StatTile({
  value,
  label,
  colorClassName,
  borderClassName,
}: {
  value: string
  label: string
  colorClassName: string
  borderClassName: string
}) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-control border bg-surface-2 p-11 ${borderClassName}`}
    >
      <div
        className={`font-mono text-assemble-stat-value font-extrabold ${colorClassName}`}
      >
        {value}
      </div>
      <div className="mt-2 text-assemble-stat-label text-text-2">{label}</div>
    </div>
  )
}

function borrowedSetLine(slot: DeckSlot & { fromDeckName: string }): string {
  const base = slot.setLine.split(' · ')[0]
  return `${base} · from ${slot.fromDeckName}`
}

export function AssembleSheet({
  open,
  onOpenChange,
  deckId,
  deckName,
  cardCount,
  currency,
  onAssembled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deckId: string
  deckName: string
  cardCount: number
  currency: Currency
  onAssembled: (result: {
    deckState: 'built'
    reserved: number
    stillMissing: number
  }) => void
}) {
  const [fromLooseCollection, setFromLooseCollection] = useState(true)
  const [fromOtherBuiltDecks, setFromOtherBuiltDecks] = useState(false)
  const [plan, setPlan] = useState<AssemblePlan | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [tab, setTab] = useState<'missing' | 'owned' | 'borrowed'>('missing')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [assembling, setAssembling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingPlan(true)
    void planAssemblyAction({ deckId, fromLooseCollection, fromOtherBuiltDecks }).then(
      (result) => {
        if (cancelled) return
        setLoadingPlan(false)
        if ('error' in result) {
          setError('Could not compute this plan. Try again.')
          return
        }
        setPlan(result)
        // Une manquante déjà cochée à une bascule précédente le reste tant
        // qu'elle figure encore dans `missing` — une carte qui bascule en
        // `borrowed`/`owned` sort naturellement de l'ensemble (jamais de faux
        // positif envoyé à `assembleDeckAction`).
        setChecked((current) => {
          const missingIds = new Set(result.missing.map((slot) => slot.holdingId))
          return new Set([...current].filter((id) => missingIds.has(id)))
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, deckId, fromLooseCollection, fromOtherBuiltDecks])

  function toggleChecked(holdingId: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(holdingId)) next.delete(holdingId)
      else next.add(holdingId)
      return next
    })
  }

  async function handleAssemble() {
    setAssembling(true)
    setError(null)
    const result = await assembleDeckAction({
      deckId,
      fromLooseCollection,
      fromOtherBuiltDecks,
      acquiredHoldingIds: [...checked],
    })
    setAssembling(false)
    if (!result.ok) {
      setError('Could not assemble this deck. Try again.')
      return
    }
    onOpenChange(false)
    onAssembled(result)
  }

  // Deux compteurs distincts : la tuile `owned` (les trois tuiles affichent
  // des valeurs cohérentes avec le plan : `owned.length`…) et le
  // segment/bouton, qui recensent le contenu de l'onglet « owned »
  // (`[...owned, ...borrowed]`, rendu plus bas) — deux usages différents qui
  // n'ont pas de raison de partager le même nombre. `ownedTileCount` respecte
  // le critère au pied de la lettre ; `ownedCount` reste `owned + borrowed`,
  // cohérent avec ce que l'onglet affiche réellement (une carte empruntée est
  // déjà en main pour l'assemblage, elle appartient légitimement au
  // dénombrement « prêtes à assembler sans achat »).
  const ownedTileCount = plan?.owned.length ?? 0
  const ownedCount = plan ? plan.owned.length + plan.borrowed.length : 0
  const missingCount = plan?.missing.length ?? 0
  const borrowedCount = plan?.borrowed.length ?? 0
  // Cartes cochées « achetées » : elles n'entrent dans la collection qu'au
  // clic sur `Assemble`, et le bouton les compte déjà (demande produit).
  const allMissingChecked = missingCount > 0 && checked.size === missingCount
  const assembleCount = ownedCount + checked.size
  // L'onglet `Decks` (emprunts) n'existe que tant qu'il y a un emprunt : s'il
  // disparaît (interrupteur éteint), on retombe sur `Missing`.
  const activeTab = tab === 'borrowed' && borrowedCount === 0 ? 'missing' : tab

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        // « Assemble {name} » — le nom du deck dans le titre, pas un « Assemble deck » générique.
        title={`Assemble ${deckName}`}
        maxHeight="assemble"
        closeLabel="Close assemble sheet"
        scrollBody={false}
        fixedHeight
      >
        {/* Conteneur défilant unique : sans lui, la
            liste des manquantes et le pied seraient des enfants directs de
            `Dialog.Content`, borné à `max-h-sheet-assemble` sans `overflow`
            — au-delà d'environ 8 manquantes, `Assemble with N card(s)`
            sortirait de l'écran sans que le document défile. Même
            idiome que `filters-sheet.tsx` (`min-h-0 flex-1
            overflow-y-auto`) : le pied (erreur + `Export missing`/`Add to
            collection` + le bouton primaire) sort de ce conteneur pour
            rester toujours visible, comme le design le prévoit
            (`flex:1;min-height:0;overflow:hidden` sur la liste, pied hors
            de cette boîte). */}
        {/* Hors du défilement : sa marge négative le remonte sous le titre,
            et un conteneur `overflow` la rognerait. */}
        <div className="-mt-8 mb-14 text-value-caption text-text-2">
          {deckName} · {cardCount} cards
        </div>
        <ScrollArea
          className={SHEET_SCROLL_BLEED.inner}
          outerClassName={SHEET_SCROLL_BLEED.outer}
        >
          <div className="flex flex-col">
            <div className="mb-14 flex gap-8">
              <StatTile
                value={String(ownedTileCount)}
                // « owned » — pas « you own » : la valeur elle-même
                // (`ownedTileCount`) reste `plan.owned.length` seul, distincte
                // du bouton primaire ci-dessous (voir le commentaire
                // au-dessus de `ownedTileCount`).
                label="owned"
                colorClassName="text-success"
                borderClassName="border-border-tile-owned"
              />
              <StatTile
                value={String(missingCount)}
                label="missing"
                colorClassName="text-warning"
                borderClassName="border-border-tile-missing"
              />
              <StatTile
                value={formatMoney(plan?.toBuyMinor ?? 0, currency)}
                label="to buy"
                colorClassName="text-accent-text"
                borderClassName="border-border"
              />
            </div>

            <div className="mb-9 ml-2 text-section-label font-semibold uppercase tracking-section-label text-text-2">
              Take cards from
            </div>
            <div className="mb-14 overflow-hidden rounded-banner bg-surface-2">
              <div className="flex items-center gap-11 px-13 py-12">
                <Library
                  width={17}
                  height={17}
                  strokeWidth={1.75}
                  className="flex-shrink-0 text-text-2"
                />
                <div className="min-w-0 flex-1">
                  {/* Libellé inversé à la demande produit : l'interrupteur dit
                    « ignorer », éteint par défaut — il pilote toujours
                    `fromLooseCollection`, à l'envers. */}
                  <div className="text-intensity-label font-semibold text-text">
                    Ignore cards in collection
                  </div>
                  <div className="mt-2 text-value-caption text-text-2">
                    Ignore the cards you own in your collection
                  </div>
                </div>
                <Switch
                  checked={!fromLooseCollection}
                  onChange={(ignore) => setFromLooseCollection(!ignore)}
                  label="Ignore cards in collection"
                />
              </div>
              <div className="flex items-center gap-11 border-t border-border px-13 py-12">
                <DecksIcon size={17} />
                <div className="min-w-0 flex-1">
                  {/* Libellé renommé à la demande produit. Un indice fixe,
                      pas un texte qui bascule selon l'état de l'interrupteur. */}
                  <div className="text-intensity-label font-semibold text-text">
                    Use from built decks
                  </div>
                  <div className="mt-2 text-value-caption text-text-2">
                    Borrow missing cards from your other decks
                  </div>
                </div>
                <Switch
                  checked={fromOtherBuiltDecks}
                  onChange={setFromOtherBuiltDecks}
                  label="Use from built decks"
                />
              </div>
            </div>

            <div className="mb-12">
              <Segmented
                size="drawer"
                // Les cartes empruntées ont leur propre onglet (`Decks`), affiché
                  // seulement quand `Use from built decks` en trouve
                  // (demande produit) — plus de section dédiée au-dessus.
                  options={[
                    { value: 'missing', label: `Missing · ${missingCount}` },
                    { value: 'owned', label: `You own · ${ownedTileCount}` },
                    ...(borrowedCount > 0
                      ? [{ value: 'borrowed' as const, label: `Decks · ${borrowedCount}` }]
                      : []),
                  ]}
                  value={activeTab}
                onChange={setTab}
              />
            </div>

            <div className="mb-14 flex flex-col gap-7">
              {/* Le message ne s'affiche qu'au premier calcul : ensuite, une
                  bascule garde la liste précédente à l'écran jusqu'à ce que
                  le nouveau plan arrive, au lieu de la vider — la feuille
                  ne s'effondre plus puis ne se rouvre plus à chaque bascule. */}
              {loadingPlan && !plan && (
                <div className="text-meta text-text-2">
                  Working out what you already own...
                </div>
              )}
              {plan &&
                activeTab === 'missing' &&
                plan?.missing.map((slot) => (
                  <SlotRow
                    key={slot.holdingId}
                    thumbUrl={slot.thumbUrl}
                    name={slot.name}
                    manaCost={slot.manaCost}
                    setLine={slot.setLine}
                    need={slot.need}
                    state="missing"
                    priceLabel={formatMoney(slot.priceMinor ?? 0, currency)}
                    checkable
                    checked={checked.has(slot.holdingId)}
                    onToggle={() => toggleChecked(slot.holdingId)}
                  />
                ))}
              {plan &&
                activeTab === 'owned' &&
                  plan?.owned.map((slot) => (
                    <SlotRow
                      key={slot.holdingId}
                      thumbUrl={slot.thumbUrl}
                      name={slot.name}
                      manaCost={slot.manaCost}
                      setLine={slot.setLine}
                      need={slot.need}
                      state="owned"
                      priceLabel={formatMoney(slot.priceMinor ?? 0, currency)}
                    />
                  ))}
                {plan &&
                  activeTab === 'borrowed' &&
                  plan?.borrowed.map((slot) => (
                    <SlotRow
                      key={slot.holdingId}
                      thumbUrl={slot.thumbUrl}
                      name={slot.name}
                      manaCost={slot.manaCost}
                      setLine={borrowedSetLine(slot)}
                      need={slot.need}
                    state="owned"
                    priceLabel={formatMoney(slot.priceMinor ?? 0, currency)}
                  />
                ))}
            </div>
          </div>
        </ScrollArea>

        {error && <p className="mb-9 mt-9 text-meta text-danger">{error}</p>}

        {/* Pied au standard des feuilles : 18px au-dessus du premier bouton,
            9px entre les deux rangées, 18px sous le dernier (marge de `Sheet`). */}
        <div className="mb-9 mt-18 flex gap-8">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={missingCount === 0}
            className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-11 text-meta font-bold text-text disabled:opacity-50"
          >
            <Share width={15} height={15} strokeWidth={1.75} />
            Export missing
          </button>
          <button
            type="button"
            onClick={() =>
              setChecked(
                allMissingChecked
                  ? new Set()
                  : new Set(plan?.missing.map((slot) => slot.holdingId) ?? []),
              )
            }
            disabled={missingCount === 0}
            className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-2 py-11 text-meta font-bold text-text disabled:opacity-50"
          >
            <Plus width={15} height={15} strokeWidth={1.75} />
            {allMissingChecked ? 'Unmark all' : 'Mark all as bought'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleAssemble()}
          disabled={assembling || loadingPlan}
          className="flex w-full items-center justify-center gap-8 rounded-control bg-accent py-14 text-button-primary font-extrabold text-on-accent disabled:opacity-60"
        >
          <Boxes width={17} height={17} strokeWidth={1.75} />
          {/* « Assemble with N card(s) » — possédées + empruntées + cochées
              « achetées » : tout ce que ce bouton réserve réellement au clic,
              distinct de la tuile « owned » ci-dessus. */}
          {assembling
            ? 'Assembling...'
            : `Assemble with ${assembleCount} card${assembleCount === 1 ? '' : 's'}`}
        </button>

      </Sheet>

      <ExportSheet
        open={exportOpen}
        onOpenChange={setExportOpen}
        deckId={deckId}
        deckName={deckName}
        slots={plan?.missing ?? []}
      />
    </>
  )
}
