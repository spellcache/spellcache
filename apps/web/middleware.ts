// Runtime Edge, deux rôles :
//
// 1. Content-Security-Policy à nonce, sur toutes les pages : seuls les scripts
//    portant le nonce de la requête s'exécutent (Next le lit dans l'en-tête
//    de requête et l'appose à ses propres scripts). Une injection de HTML ne
//    peut donc plus exécuter de script. Toutes les pages sont rendues à la
//    requête (le layout racine lit le thème), le nonce est neuf à chaque fois.
//
// 2. Garde de session : l'adapter Drizzle (`pg`) ne fonctionne pas ici, donc
//    on se limite à la présence du cookie de session Auth.js — la validité
//    réelle (session en base, username défini) est vérifiée côté serveur par
//    `requireSession()` (lib/auth-guards.ts).
import { NextResponse, type NextRequest } from 'next/server'

// Noms de cookie d'Auth.js v5 (session strategy `database`) : préfixé
// `__Secure-` dès que Auth.js sert des cookies sécurisés (HTTPS/production).
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token']

const PROTECTED_PREFIXES = [
  '/collection',
  '/search',
  '/decks',
  '/tools',
  '/settings',
  '/onboarding',
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// Images de cartes et icônes de set : CDN de Scryfall (`*.scryfall.io`).
// `'unsafe-eval'` et WebSocket : rafraîchissement à chaud de `next dev` seulement.
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.scryfall.io",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function middleware(request: NextRequest) {
  if (isProtected(request.nextUrl.pathname)) {
    const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  const nonce = btoa(crypto.randomUUID())
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: [
    // Pages seulement : ni routes d'API, ni fichiers statiques.
    '/((?!api/|_next/static|_next/image|icons/|mana/|sw\\.js|site\\.webmanifest|favicon).*)',
  ],
}
