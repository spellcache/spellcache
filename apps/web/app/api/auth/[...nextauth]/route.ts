// Handlers Auth.js v5 — endpoints
// signin/callback/session bruts, ne répond jamais en dehors de ce contrat.
//
// Le retour du lien magique et la saisie du code passent par
// `GET /api/auth/callback/resend` : chaque essai y est compté avant qu'Auth.js
// ne vérifie le code (lib/auth-codes/login-code.ts) — sinon le million de
// codes possibles pourrait être parcouru en appelant cette route en boucle.
//
// Auth.js accepte aussi le callback en POST et lit alors `email`/`token` dans
// l'URL : aucun provider de l'app n'en a besoin, il est fermé pour que le
// comptage ne puisse pas être contourné. Un `email` répété est refusé de même :
// Auth.js garde la dernière valeur, `searchParams.get` la première.
import { NextResponse, type NextRequest } from 'next/server'

import { registerLoginAttempt } from '@/lib/auth-codes/login-code'
import { handlers } from '@/lib/auth'

function isCallback(request: NextRequest): boolean {
  return request.nextUrl.pathname.toLowerCase().includes('/callback/')
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  if (isCallback(request) && url.searchParams.has('token')) {
    const emails = url.searchParams.getAll('email')
    if (emails.length !== 1 || url.searchParams.getAll('token').length !== 1) {
      return NextResponse.redirect(new URL('/login?error=Verification', url))
    }
    if (!(await registerLoginAttempt(emails[0]))) {
      return NextResponse.redirect(new URL('/login?error=TooManyAttempts', url))
    }
  }
  return handlers.GET(request)
}

export async function POST(request: NextRequest) {
  if (isCallback(request)) return new NextResponse(null, { status: 405, headers: { Allow: 'GET' } })
  return handlers.POST(request)
}
