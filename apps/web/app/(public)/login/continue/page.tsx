// Page d'atterrissage du lien de l'email (lib/mail/resend.ts#continueUrlFor) :
// l'ouvrir ne consomme rien. Seul le bouton envoie vers la route de rappel
// d'Auth.js, qui vérifie et brûle le code — un scanner de liens qui ouvre
// l'URL avant l'utilisateur ne peut donc plus invalider la connexion.
// Écran sans design dédié : composé des seuls tokens et éléments de l'écran
// de connexion (docs/development.md).
import { z } from 'zod'

import { AppLogo } from '@/components/brand/app-logo'

import { ContinueButton } from './continue-button'

const searchParamsSchema = z.object({
  token: z.string().regex(/^\d{6}$/),
  email: z.string().email(),
  // Chemin interne seulement : jamais une redirection vers un autre site.
  callbackUrl: z.string().optional(),
})

// Ne garde que le chemin de `callbackUrl` (Auth.js le fournit en URL
// absolue de ce site) : quelle que soit l'origine écrite dans le lien, la
// suite reste sur spellcache — jamais une redirection ouverte.
function safeCallbackPath(callbackUrl: string | undefined): string {
  if (!callbackUrl) return '/onboarding/username'
  try {
    const parsed = new URL(callbackUrl, 'https://spellcache.invalid')
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return '/onboarding/username'
  }
}

export default async function LoginContinuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const parsed = searchParamsSchema.safeParse(await searchParams)

  return (
    <div className="flex h-dvh flex-col items-center justify-center-safe gap-32 overflow-y-auto px-16 py-24">
      <div className="flex flex-col items-center gap-16">
        <AppLogo size={80} className="rounded-card" />
        <div className="text-title-screen font-extrabold tracking-title-screen text-text">
          spellcache
        </div>
      </div>
      <div className="w-full max-w-auth-card rounded-card border border-border bg-surface-1 p-24">
        {parsed.success ? (
          <div className="flex flex-col items-center gap-14 text-center">
            <p className="text-auth-copy text-text-2">
              Signing in as <span className="font-semibold text-text">{parsed.data.email}</span>
            </p>
            <ContinueButton
              href={`/api/auth/callback/resend?${new URLSearchParams({
                token: parsed.data.token,
                email: parsed.data.email,
                callbackUrl: safeCallbackPath(parsed.data.callbackUrl),
              })}`}
            />
          </div>
        ) : (
          <p className="text-center text-auth-copy text-text-2">
            This link is incomplete. Request a new one from the sign-in screen.
          </p>
        )}
      </div>
    </div>
  )
}
