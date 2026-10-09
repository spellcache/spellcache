'use client'

// Administration › Users › un compte (sans champ mot de passe, l'auth reste
// en lien magique). Bloc
// d'infos (Email, Created, Collection), bascule Admin/Regular user
// (`setUserRoleAction`, désactivée sur son propre compte) et suppression
// définitive (`deleteUserAction`) derrière un `ConfirmDialog`.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'

import { deleteUserAction, setUserRoleAction } from '../actions'
import type { AdminAccountRow } from './accounts-data'
import { roleLabel } from '@/lib/collections/roles'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function collectionLabel(collection: AdminAccountRow['collection']): string {
  if (!collection) return 'None yet'
  return `#${collection.name} · ${roleLabel(collection.role)}`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-12 py-4">
      <span className="text-row-value font-semibold text-text-2">{label}</span>
      <span className="min-w-0 truncate text-row-value font-semibold text-text">{value}</span>
    </div>
  )
}

export function ManageUserSheet({
  account,
  isSelf,
  open,
  onClose,
  onRoleChange,
  onDeleted,
}: {
  account: AdminAccountRow
  isSelf: boolean
  open: boolean
  onClose: () => void
  onRoleChange: (userId: string, isAdmin: boolean) => void
  onDeleted: (userId: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isAdmin = account.role === 'admin'

  async function toggleAdmin() {
    setPending(true)
    setError(null)
    const next = !isAdmin
    const result = await setUserRoleAction({ userId: account.id, isAdmin: next })
    setPending(false)
    if (!result.ok) {
      setError('Could not change that role.')
      return
    }
    onRoleChange(account.id, next)
  }

  async function handleDelete() {
    setPending(true)
    setError(null)
    const result = await deleteUserAction({ userId: account.id })
    setPending(false)
    setConfirmingDelete(false)
    if (!result.ok) {
      setError(
        result.error === 'owns_shared'
          ? 'This account owns a collection shared with other members. Transfer its ownership first.'
          : 'Could not delete that account.',
      )
      return
    }
    onDeleted(account.id)
    onClose()
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={account.username ?? 'Pending invite'}
      >
        <div className="mb-16 flex flex-col gap-2">
          <InfoRow label="Email" value={account.email} />
          <InfoRow label="Created" value={dateFormatter.format(account.createdAt)} />
          <InfoRow label="Collection" value={collectionLabel(account.collection)} />
        </div>

        <div className="mb-4 flex items-center justify-between gap-12">
          <span className="text-row-value font-semibold text-text-2">Admin</span>
          <button
            type="button"
            onClick={() => void toggleAdmin()}
            disabled={isSelf || pending}
            className={`rounded-pill px-14 py-7 text-row-value font-bold disabled:opacity-55 ${
              isAdmin ? 'bg-accent text-on-accent' : 'bg-surface-2 text-text-2'
            }`}
          >
            {isAdmin ? 'Admin' : 'Regular user'}
          </button>
        </div>
        {isSelf && (
          <p className="mb-16 text-look-hint leading-normal text-text-3">
            This is your own account — another admin has to change your role or disable you.
          </p>
        )}

        {error && <p className="mb-16 text-meta text-danger">{error}</p>}

        {!isSelf && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            className="mt-8 flex w-full items-center justify-center gap-8 rounded-control bg-surface-2 py-13 text-confirm-button font-bold text-danger disabled:opacity-60"
          >
            <Trash2 width={17} height={17} strokeWidth={1.75} />
            Delete account
          </button>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${account.username ?? 'this account'}?`}
        message="The account is removed for good. Cards they added to a shared collection stay with that collection."
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => void handleDelete()}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  )
}
