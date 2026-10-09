import { z } from 'zod'

import { AppLogo } from '@/components/brand/app-logo'

import { LoginForm } from './login-form'

// `?error=<code>` posé par Auth.js sur redirection d'échec (lib/auth.ts,
// `pages: { error: '/login' }`) : entrée externe, validée à la frontière
// avant d'atteindre le composant (docs/development.md ; même précédent que
// app/api/card-image/[cardId]/[variant]/route.ts).
const searchParamsSchema = z.object({ error: z.string().optional() })

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `safeParse`, pas `parse` : un `?error=` malformé (répété, tableau) ne
  // doit pas faire échouer l'écran de connexion, seulement se comporter
  // comme s'il était absent.
  const parsed = searchParamsSchema.safeParse(await searchParams)
  const error = parsed.success ? parsed.data.error : undefined

  return (
    <div className="flex h-dvh flex-col items-center justify-center-safe gap-32 overflow-y-auto px-16 py-24">
      <div className="flex flex-col items-center gap-16">
        <AppLogo size={80} className="rounded-card" />
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="text-title-screen font-extrabold tracking-title-screen text-text">
            spellcache
          </div>
          <p className="text-auth-copy text-text-2">Your card collection, binders and decks.</p>
        </div>
      </div>
      <div className="w-full max-w-auth-card rounded-card border border-border bg-surface-1 p-24">
        <LoginForm initialError={error} />
      </div>
    </div>
  )
}
