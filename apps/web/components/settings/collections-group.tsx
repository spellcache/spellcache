'use client'

// Groupes de collection de Settings (multi-collection) : « Current
// collection » (la collection affichée, lien vers Settings › Collection)
// puis « Switch to » (les autres collections du compte et « New
// collection »). Un clic
// sur une ligne change la collection affichée par toute l'app (Collection,
// Decks, barre latérale) — `router.refresh()` relit les écrans serveur.
//
// Aucun langage visuel nouveau : `SettingsGroup`/`SettingRow` et la
// `NameSheet` déjà livrés.
import { Library, Plus, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { NameSheet } from '@/components/ui/name-sheet'
import type { MyCollection } from '@/lib/collections/active'
import { roleLabel } from '@/lib/collections/roles'

import {
  createCollectionAction,
  switchCollectionAction,
} from '@/app/(app)/settings/collections-actions'

export function CollectionsGroup({ collections }: { collections: MyCollection[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const shown = collections.find((collection) => collection.active)
  const others = collections.filter((collection) => !collection.active)

  async function handleSwitch(collectionId: string) {
    setPendingId(collectionId)
    const result = await switchCollectionAction({ collectionId })
    setPendingId(null)
    if (result.ok) router.refresh()
  }

  async function handleCreate(name: string) {
    setCreatePending(true)
    const result = await createCollectionAction({ name })
    setCreatePending(false)
    if (!result.ok) return
    setCreating(false)
    router.refresh()
  }

  return (
    <>
      {/* Collection affichée, seule dans son groupe — comme un sélecteur de
          compte (Google, Slack) : la page dit laquelle est en cours au lieu
          de le signaler par une décoration sur une ligne parmi d'autres. */}
      {shown && (
        <SettingsGroup label="Current collection">
          {/* Nom, membres, départ et suppression vivent dans Settings ›
              Collection (`app/(app)/settings/collection/page.tsx`). */}
          <SettingRow
            icon={roleIcon(shown.role)}
            label={shown.name}
            labelSuffix="Current"
            value={roleLabel(shown.role)}
            href="/settings/collection"
          />
        </SettingsGroup>
      )}

      <SettingsGroup label={others.length > 0 ? 'Switch to' : 'Other collections'}>
        {others.map((collection) => (
          <SettingRow
            key={collection.id}
            icon={roleIcon(collection.role)}
            label={collection.name}
            value={roleLabel(collection.role)}
            // Pas de chevron : la ligne bascule sur place, elle n'ouvre pas
            // d'écran.
            chevron={false}
            pending={pendingId === collection.id}
            onClick={() => void handleSwitch(collection.id)}
          />
        ))}
        <SettingRow
          icon={<Plus width={18} height={18} strokeWidth={1.75} />}
          label="New collection"
          chevron={false}
          onClick={() => setCreating(true)}
        />
      </SettingsGroup>

      <NameSheet
        key={creating ? 'open' : 'closed'}
        open={creating}
        title="New collection"
        label="Collection name"
        pending={createPending}
        onSubmit={(name) => void handleCreate(name)}
        onClose={() => setCreating(false)}
      />
    </>
  )
}

function roleIcon(role: MyCollection['role']) {
  return role === 'owner' ? (
    <Library width={18} height={18} strokeWidth={1.75} />
  ) : (
    <Users width={18} height={18} strokeWidth={1.75} />
  )
}

