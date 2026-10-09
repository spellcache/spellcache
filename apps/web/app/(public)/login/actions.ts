'use server'

// Demande de lien magique. Entrée validée par Zod à la frontière avant
// d'atteindre `signIn()` (docs/development.md).
import { headers } from 'next/headers'
import { z } from 'zod'

import { signIn } from '@/lib/auth'
import { canSendLoginCode } from '@/lib/auth-codes/login-code'
import { isTestMailTransport } from '@/lib/mail/resend'
import { rateLimit } from '@/lib/redis'
import { canRequestMagicLink } from '@/lib/site-settings'

const emailSchema = z.string().trim().toLowerCase().email()

export async function requestMagicLinkAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: 'invalid_email' | 'send_failed' }> {
  const parsed = emailSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_email' }

  // Plafonds par email et par IP (anti-bombardement de boîte, quota Resend).
  // Au-delà, même réponse qu'un envoi réussi, sans rien envoyer — un refus
  // visible permettrait de distinguer un compte existant d'un email inconnu.
  // L'IP vient de `X-Forwarded-For`, posé par le reverse proxy de l'hébergeur.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Le plafond par IP protège le quota Resend et les boîtes de réception :
  // sans objet avec le transport de test, où rien ne part et où la suite
  // e2e crée plus de 30 comptes depuis la même adresse.
  const allowed =
    (await rateLimit(`ratelimit:login:email:${parsed.data}`, 5, 900)) &&
    (isTestMailTransport() || (await rateLimit(`ratelimit:login:ip:${ip}`, 30, 900)))
  if (!allowed) return { ok: true }

  // Inscriptions sur invitation : un email inconnu reçoit le même écran
  // « Check your inbox » qu'un compte existant, sans qu'aucun lien ne parte
  // — ne jamais révéler quels emails ont un compte.
  if (!(await canRequestMagicLink(parsed.data))) return { ok: true }
  // Trop de codes actifs pour cet email : même réponse, aucun nouvel envoi
  // (lib/auth-codes/login-code.ts#canSendLoginCode).
  if (!(await canSendLoginCode(parsed.data))) return { ok: true }

  // `redirect: false` : renvoie l'URL de résultat plutôt que de rediriger —
  // cet écran gère lui-même l'état « check your inbox ».
  // Auth.js encode un échec d'envoi (`MagicLinkSendError`, lib/mail/resend.ts)
  // dans cette URL via `?error=…` plutôt que de rejeter la promesse.
  //
  // `redirectTo` fixe explicitement le `callbackUrl` encodé dans le lien
  // magique : sans lui, next-auth retombe sur le `Referer` de cette Server
  // Action (`node_modules/next-auth/lib/actions.js`), c'est-à-dire `/login`
  // — le lien ramènerait alors l'utilisateur authentifié sur l'écran de
  // connexion au lieu de l'onboarding.
  // `/onboarding/username` convient dans tous les cas : la page y redirige
  // elle-même vers `/collection` si le username est déjà défini
  // (app/(app)/onboarding/username/page.tsx).
  const resultUrl = await signIn('resend', {
    email: parsed.data,
    redirect: false,
    redirectTo: '/onboarding/username',
  })

  // `resultUrl` peut être relative ou absolue selon le contexte de requête —
  // un test de motif évite de la faire échouer via `new URL()`.
  if (typeof resultUrl === 'string' && /[?&]error=/.test(resultUrl)) {
    return { ok: false, error: 'send_failed' }
  }

  return { ok: true }
}
