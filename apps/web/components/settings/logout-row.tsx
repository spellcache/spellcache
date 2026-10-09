'use client'

// Ligne `Logout` de Settings : une confirmation explicite avant de couper la
// session — le tap de confirmation qu'une action destructrice exige
// (`ConfirmDialog`). Îlot client minimal : `logoutAction` reste la
// Server Action de `../actions.ts`, appelée ici après confirmation plutôt
// que posée derrière un `<form action=...>`.
import { LogOut } from 'lucide-react'
import { useState, useTransition } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export function LogoutRow({ logoutAction }: { logoutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <SettingRow
        icon={<LogOut width={18} height={18} strokeWidth={1.75} />}
        label="Logout"
        danger
        chevron={false}
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        title="Log out?"
        message="You'll need to sign in again to access your collection."
        confirmLabel="Logout"
        pending={pending}
        onConfirm={() => {
          setOpen(false)
          startTransition(() => {
            void logoutAction()
          })
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
