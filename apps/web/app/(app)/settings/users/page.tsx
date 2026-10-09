// Administration › Users : visible admin seulement, garde côté serveur — un
// `member` reçoit un vrai 403, pas un masquage d'interface.
import { forbidden } from 'next/navigation'

import { SettingsScreenHeader } from '@/components/settings/settings-screen-header'
import { ForbiddenError, requireAdmin } from '@/lib/auth-guards'
import { Screen } from '@/components/ui/screen'
import { getSignupMode } from '@/lib/site-settings'

import { listAdminAccounts } from './accounts-data'
import { InviteForm } from './invite-form'
import { SignupModeGroup } from './signup-mode-group'
import { UsersList } from './users-list'

export default async function UsersPage() {
  const admin = await (async () => {
    try {
      return await requireAdmin()
    } catch (error) {
      if (error instanceof ForbiddenError) forbidden()
      throw error
    }
  })()

  const [accounts, signupMode] = await Promise.all([listAdminAccounts(), getSignupMode()])

  return (
    <Screen header={<SettingsScreenHeader title="Users" />}>
      <SignupModeGroup initialMode={signupMode} />

      <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
        Invite an account
      </div>
      <InviteForm />

      <UsersList accounts={accounts} currentUserId={admin.id} />
    </Screen>
  )
}
