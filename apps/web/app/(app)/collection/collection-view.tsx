'use client'

// Écran `Collection home · Compact`, en composant client scindé de
// `page.tsx` (composant serveur) — même patron que `search-view.tsx`. Reçoit
// les données déjà chargées côté serveur en props : aucun refetch côté
// client, l'hydratation se fait par simple passage de props plutôt que par
// un second aller-retour réseau.
import { ArrowDownUp, BookPlus, Layers3, ListPlus, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AddCardSheet } from '@/app/(app)/container/[id]/add-card-sheet'
import { BinderRow } from '@/components/collection/binder-row'
import { ImportExportSheet } from '@/components/collection/import-export-sheet'
import { NavRow } from '@/components/collection/nav-row'
import { ValueCard } from '@/components/collection/value-card'
import { NameSheet } from '@/components/ui/name-sheet'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import { DecksIcon } from '@/components/ui/tab-bar'
import { useCanEdit } from '@/lib/collections/access-context'
import { formatCount, formatMoney } from '@/lib/format/money'

import { createBinderOrListAction } from './actions'
import type { CollectionHome } from './collection-data'

type Segment = 'collection' | 'lists'

export function CollectionView({ initial }: { initial: CollectionHome }) {
  const [segment, setSegment] = useState<Segment>('collection')
  // `null` = feuille fermée. Le `kind` est porté par l'état plutôt que
  // dérivé du segment : le menu `···` propose `New binder` et `New list`
  // depuis n'importe quel onglet, et un `kind` dérivé y créerait l'autre.
  const [naming, setNaming] = useState<'binder' | 'list' | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addCardOpen, setAddCardOpen] = useState(false)
  // Feuille unifiée « Import & export » : ouverte par le
  // menu `···` ET par le bouton héro `Import` (demande produit) — plus
  // aucune seconde feuille d'import sur cet écran, une seule porte d'entrée.
  const [importExportOpen, setImportExportOpen] = useState(false)
  const router = useRouter()
  // Lecture seule (`viewer`) : ni ajout, ni import, ni création.
  const canEdit = useCanEdit()

  const rows = segment === 'collection' ? initial.binders : initial.lists
  const emptyLabel =
    segment === 'collection'
      ? 'No binders yet. Create one to start organizing your collection.'
      : "No list yet. Create one to track cards you don't own."

  // Le segmenté pilote le `kind` créé : un seul lien de section et une seule
  // feuille servent les deux onglets. Rien à dupliquer — `ListSummary` est un
  // alias de `BinderSummary` (collection-data.ts) : même géométrie de ligne
  // pour l'onglet `Lists`.
  const segmentKind: 'binder' | 'list' = segment === 'collection' ? 'binder' : 'list'
  // Reste sur la dernière valeur ouverte pendant la fermeture animée, pour
  // que les libellés de la feuille ne changent pas sous le doigt.
  const kind = naming ?? segmentKind

  function openCreateSheet(next: 'binder' | 'list') {
    setCreateError(null)
    setNaming(next)
  }

  // Création : la feuille
  // partagée `NameSheet` (déjà pré-remplie « New binder »/« New list »),
  // pas un formulaire propre à cet écran — et une **navigation** vers le
  // container créé plutôt qu'une ligne ajoutée localement. `binders`/`lists`
  // n'ont donc pas besoin d'être un état local mutable : la page suivante
  // les relira depuis le serveur.
  async function handleCreate(name: string) {
    setCreating(true)
    setCreateError(null)

    const result = await createBinderOrListAction({ kind, name })

    if (!result.ok) {
      // La feuille se referme sur l'échec — `NameSheet` (components/ui/,
      // socle partagé) n'a pas de créneau d'erreur inline, le message
      // reprend donc le bandeau de page déjà utilisé par `container-view.tsx`
      // pour une action échouée, seul endroit où il reste visible une fois
      // la feuille démontée.
      setCreateError(`Could not create that ${kind}. Try a different name.`)
      setCreating(false)
      setNaming(null)
      return
    }

    setCreating(false)
    setNaming(null)
    router.push(`/container/${result.containerId}`)
  }

  return (
    <Screen
      header={
        <ScreenHeader
          title="Collection"
          onOverflow={canEdit ? () => setMenuOpen(true) : undefined}
          onAdd={canEdit ? () => setAddCardOpen(true) : undefined}
          addLabel="Add a card"
        />
      }
    >
      <ValueCard
        amountMinor={initial.value.amountMinor}
        currency={initial.value.currency}
        delta7d={initial.value.delta7d}
        cards={initial.counts.cards}
        unique={initial.counts.unique}
        addedThisWeek={initial.counts.addedThisWeek}
      />

      <div className="mb-16 flex gap-8">
        <button
          type="button"
          onClick={() => router.push('/search')}
          className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-1 py-11 text-body font-bold text-text"
        >
          <Search width={15} height={15} strokeWidth={1.75} />
          Find a card
        </button>
        {/* Ouvre la même feuille unifiée « Import & export » que la ligne
            `Import / Export` du menu `···` (demande produit). */}
        {canEdit && (
          <button
            type="button"
            onClick={() => setImportExportOpen(true)}
            className="flex flex-1 items-center justify-center gap-7 rounded-control border border-border bg-surface-1 py-11 text-body font-bold text-text"
          >
            <ArrowDownUp width={15} height={15} strokeWidth={1.75} />
            <span>Import</span>
          </button>
        )}
      </div>

      <div className="mb-18">
        <Segmented<Segment>
          options={[
            { value: 'collection', label: 'Collection' },
            { value: 'lists', label: 'Lists' },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </div>

      {segment === 'collection' && (
        <div className="mb-11 flex flex-col gap-11">
          <NavRow
            href={`/container/${initial.rootContainerId}`}
            icon={<Layers3 width={21} height={21} strokeWidth={1.75} />}
            title="All collection"
            subtitle={`${formatCount(initial.counts.cards)} cards · ${formatCount(initial.counts.unique)} unique`}
          />
          {/* Vers `Collection › Decks`, pas vers l'onglet `Decks` : cette
              ligne compte les decks **montés**, ceux dont les cartes sont
              dans la collection. L'onglet est l'atelier, et ses plans n'ont
              rien à voir avec ce total. */}
          <NavRow
            href="/collection/decks"
            icon={<DecksIcon />}
            title="Decks"
            subtitle={`${formatCount(initial.decks.builtCount)} built decks · ${formatMoney(initial.decks.valueMinor, initial.value.currency)}`}
          />
        </div>
      )}

      <div className="mx-4 mb-10 mt-22 flex items-baseline justify-between">
        <div className="text-section-label font-semibold uppercase tracking-section-label text-text-2">
          {segment === 'collection' ? 'Binders' : 'Lists'}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => openCreateSheet(segmentKind)}
            className="text-meta font-bold text-accent-text"
          >
            {segmentKind === 'binder' ? 'New binder' : 'New list'}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-16 py-16 text-center text-body text-text-2">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-11">
          {rows.map((row) => (
            <BinderRow
              key={row.id}
              binder={row}
              currency={initial.value.currency}
              binderBackdrops={initial.binderBackdrops}
              kind={segmentKind}
            />
          ))}
        </div>
      )}

      {/* Feuille de création partagée : champ pré-rempli « New binder »/
          « New list », bouton
          `Create`/`Working...`. Remontée par `key` à chaque `kind` pour
          repartir d'un formulaire vierge — une erreur laissée par l'autre
          onglet ne doit pas s'afficher sous un titre qui ne la concerne
          plus. */}
      <NameSheet
        key={`naming-${naming ?? 'none'}`}
        open={naming !== null}
        title={kind === 'binder' ? 'New binder' : 'New list'}
        label={kind === 'binder' ? 'Binder name' : 'List name'}
        initialValue={kind === 'binder' ? 'New binder' : 'New list'}
        pending={creating}
        onSubmit={(name) => void handleCreate(name)}
        onClose={() => setNaming(null)}
      />
      {createError && (
        <div
          role="alert"
          className="fixed inset-x-16 bottom-toast-offset z-30 flex items-center gap-10 rounded-toast border border-border-device bg-surface-3 px-14 py-12 shadow-toast text-body text-danger"
        >
          <span className="min-w-0 flex-1">{createError}</span>
          <button
            type="button"
            onClick={() => setCreateError(null)}
            className="flex-shrink-0 text-body font-bold text-text-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Le menu de l'écran : ce qui entre et sort de la collection, puis
          les deux containers qu'on peut y créer. Chaque ligne dit sa
          conséquence — « nothing in a list counts as owned » est la
          distinction qui compte entre les deux dernières. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Collection">
        <SheetGroup>
          {/* Feuille unifiée — une seule ligne plutôt que deux lignes
              séparées `Import`/`Export`. */}
          <SheetRow
            icon={ArrowDownUp}
            label="Import / Export"
            hint="Paste a list, or download this collection"
            onClick={() => {
              setMenuOpen(false)
              setImportExportOpen(true)
            }}
          />
          <SheetRow
            icon={BookPlus}
            label="New binder"
            hint="A view over cards you own"
            onClick={() => {
              setMenuOpen(false)
              openCreateSheet('binder')
            }}
          />
          <SheetRow
            icon={ListPlus}
            label="New list"
            hint="Cards you don't own — nothing in a list counts as owned"
            onClick={() => {
              setMenuOpen(false)
              openCreateSheet('list')
            }}
          />
        </SheetGroup>
      </Sheet>

      {/* Le `+` de l'en-tête vise le container racine : une carte ajoutée
          depuis l'accueil entre dans la collection, pas dans un binder. */}
      <AddCardSheet
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        containerId={initial.rootContainerId}
        onAdded={() => router.refresh()}
      />

      <ImportExportSheet
        open={importExportOpen}
        onOpenChange={setImportExportOpen}
        onImported={() => router.refresh()}
      />

    </Screen>
  )
}
