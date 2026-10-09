// Settings › Collection : tout ce qui concerne la collection affichée —
// son nom, ses membres (ajout, rôle, transfert, retrait), la quitter ou la
// supprimer. Atteint depuis le groupe « Current collection » de Settings.
// Les gardes de chaque mutation vivent dans leurs Server Actions.
import { CollectionDetailsGroup } from '@/components/settings/collection-details-group'
import { MembersGroup } from '@/components/settings/members-group'
import { SettingsScreenHeader } from '@/components/settings/settings-screen-header'
import { Screen } from '@/components/ui/screen'
import { requireSession } from '@/lib/auth-guards'

import { getSettingsData } from '../settings-data'

export default async function CollectionSettingsPage() {
  const session = await requireSession()
  const data = await getSettingsData(session.id)

  return (
    <Screen header={<SettingsScreenHeader title="Collection" />}>
      {/* Colonne de hauteur pleine : la zone de danger de `MembersGroup` se
          pose en bas de l'écran (`mt-auto`). */}
      <div className="flex min-h-full flex-col">
        <CollectionDetailsGroup
          key={`${data.collection.id}-${data.collection.name}`}
          collectionId={data.collection.id}
          name={data.collection.name}
          role={data.collection.role}
        />
        {/* `key` : l'état local (membres, rôle) repart de zéro si la
          collection affichée change. */}
        <MembersGroup
          key={data.collection.id}
          collectionId={data.collection.id}
          collectionName={data.collection.name}
          role={data.collection.role}
          members={data.members}
          currentUserId={session.id}
        />
      </div>
    </Screen>
  )
}
