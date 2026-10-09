// Garde de session, runtime Edge : l'adapter Drizzle (`pg`)
// ne fonctionne pas ici, donc on se limite à la présence du cookie de
// session Auth.js — la validité réelle (session en base, username défini)
// est vérifiée côté serveur par `requireSession()` (lib/auth-guards.ts).
import { NextResponse, type NextRequest } from 'next/server'

// Noms de cookie d'Auth.js v5 (session strategy `database`) : préfixé
// `__Secure-` dès que Auth.js sert des cookies sécurisés (HTTPS/production).
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token']

export function middleware(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))

  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/collection/:path*',
    '/search/:path*',
    '/decks/:path*',
    '/tools/:path*',
    '/settings/:path*',
    '/onboarding/:path*',
  ],
}
