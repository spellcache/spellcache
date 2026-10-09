// Handlers Auth.js v5 — endpoints
// signin/callback/session bruts, ne répond jamais en dehors de ce contrat.
//
// Le retour du lien magique et la saisie du code passent par
// `GET /api/auth/callback/resend` : chaque essai y est compté avant qu'Auth.js
// ne vérifie le code (lib/auth-codes/login-code.ts) — sinon le million de
// codes possibles pourrait être parcouru en appelant cette route en boucle.
import { NextResponse, type NextRequest } from 'next/server'

import { registerLoginAttempt } from '@/lib/auth-codes/login-code'
import { handlers } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  if (url.pathname.endsWith('/callback/resend')) {
    const email = url.searchParams.get('email')
    if (email && !(await registerLoginAttempt(email))) {
      return NextResponse.redirect(new URL('/login?error=TooManyAttempts', url))
    }
  }
  return handlers.GET(request)
}

export const { POST } = handlers
