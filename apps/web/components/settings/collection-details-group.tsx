'use client'

// Groupe « Details » de Settings › Collection : le nom de la collection
// affichée et son renommage (réservé à l'`owner`, comme côté serveur —
// renameCollectionAction). `NameSheet` déjà livrée, aucun visuel nouveau.
import { Library, Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { renameCollectionAction } from '@/app/(app)/settings/collection-actions'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { NameSheet } from '@/components/ui/name-sheet'
import type { MemberRole } from '@spellcache/db/schema'

export function CollectionDetailsGroup({
  collectionId,
  name,
  role,
}: {
  collectionId: string
  name: string
  role: MemberRole
}) {
  const router = useRouter()
  const [renaming, setRenaming] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleRename(next: string) {
    setPending(true)
    const result = await renameCollectionAction({ collectionId, name: next })
    setPending(false)
    if (!result.ok) return
    setRenaming(false)
    router.refresh()
  }

  return (
    <>
      <SettingsGroup label="Details">
        {/* Une seule ligne : le nom, et pour l'`owner` un crayon à droite qui
            ouvre le renommage — la ligne entière est cliquable. */}
        <SettingRow
          icon={<Library width={18} height={18} strokeWidth={1.75} />}
          label={name}
          value={
            role === 'owner' ? (
              <Pencil width={16} height={16} strokeWidth={1.75} aria-label="Rename collection" />
            ) : undefined
          }
          chevron={false}
          onClick={role === 'owner' ? () => setRenaming(true) : undefined}
        />
      </SettingsGroup>

      <NameSheet
        key={renaming ? `rename-${name}` : 'rename-closed'}
        open={renaming}
        title="Rename collection"
        label="Collection name"
        initialValue={name}
        confirmLabel="Save"
        pending={pending}
        onSubmit={(next) => void handleRename(next)}
        onClose={() => setRenaming(false)}
      />
    </>
  )
}
