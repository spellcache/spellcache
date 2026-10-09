'use client'

// Réglage des inscriptions (Administration › Users) : ouvertes à tout email,
// ou sur invitation seulement (défaut). Composé des `SettingsGroup`/
// `SettingRow`/`Switch` déjà livrés — aucun langage visuel nouveau.
import { UserCheck } from 'lucide-react'
import { useState } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { Switch } from '@/components/ui/switch'
import type { SignupMode } from '@spellcache/db/schema'

import { setSignupModeAction } from '../actions'

export function SignupModeGroup({ initialMode }: { initialMode: SignupMode }) {
  const [mode, setMode] = useState(initialMode)
  const [pending, setPending] = useState(false)
  const open = mode === 'open'

  async function handleChange(nextOpen: boolean) {
    const next: SignupMode = nextOpen ? 'open' : 'invite'
    const previous = mode
    setMode(next)
    setPending(true)
    const result = await setSignupModeAction({ mode: next })
    setPending(false)
    // Retour arrière optimiste si l'écriture échoue (docs/development.md).
    if (!result.ok) setMode(previous)
  }

  return (
    <SettingsGroup label="Sign-ups">
      <SettingRow
        icon={<UserCheck width={18} height={18} strokeWidth={1.75} />}
        label="Open sign-ups"
        subtitle={
          open
            ? 'Anyone with an email can create an account'
            : 'Only invited accounts can sign in'
        }
        pending={pending}
        control={<Switch checked={open} onChange={(next) => void handleChange(next)} label="Open sign-ups" />}
      />
    </SettingsGroup>
  )
}
