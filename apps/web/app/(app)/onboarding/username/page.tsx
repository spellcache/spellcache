import { redirect } from 'next/navigation'

import { AppLogo } from '@/components/brand/app-logo'
import { auth } from '@/lib/auth'

import { UsernameForm } from './username-form'

// Ne passe jamais par `requireSession()` : cette page est
// justement celle où le username n'existe pas encore — l'appeler ici
// bouclerait la redirection sur elle-même.
export default async function OnboardingUsernamePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  if (session.user.username) redirect('/collection')

  return (
    <div className="flex h-dvh flex-col items-center justify-center-safe gap-32 overflow-y-auto px-16 py-24">
      <div className="flex flex-col items-center gap-14 text-center">
        <AppLogo size={80} className="rounded-card" />
        <div className="text-title-subscreen font-extrabold text-text">
          Choose a username
        </div>
        <p className="max-w-auth-card-copy text-auth-copy text-text-2">
          This is how other members will see you across spellcache.
        </p>
      </div>
      <div className="w-full max-w-auth-card rounded-card border border-border bg-surface-1 p-24">
        <UsernameForm />
      </div>
    </div>
  )
}
