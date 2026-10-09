// Envoi du lien magique. Consommé par le
// provider Email de `lib/auth.ts` via `sendVerificationRequest` — jamais par
// Resend directement, pour garder le transport de développement au même
// endroit que l'envoi réel.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { Resend } from 'resend'

const DEFAULT_FROM = 'spellcache <onboarding@resend.dev>'

export class MagicLinkSendError extends Error {}

// Transport de test des suites e2e : aucune clé Resend, et le lien est écrit
// dans le fichier désigné par `MAGIC_LINK_DEBUG_FILE` (tests/e2e/read-magic-link.ts).
// Jamais positionné sur une instance réelle : quiconque lit ce fichier peut
// se connecter avec le lien qu'il contient.
export function isTestMailTransport(): boolean {
  return !process.env.RESEND_API_KEY && Boolean(process.env.MAGIC_LINK_DEBUG_FILE)
}

// Le lien de l'email ne consomme pas le code : il mène à une page « Continue
// to spellcache » (app/(public)/login/continue) dont le bouton, lui, ouvre la
// route de rappel d'Auth.js. Les scanners de liens (Outlook Safe Links,
// antivirus) ouvrent l'URL avant l'utilisateur ; sur la route de rappel, ils
// brûleraient le code à usage unique — et le code saisi à la main avec.
export function continueUrlFor(callbackUrl: string): string {
  const url = new URL(callbackUrl)
  url.pathname = '/login/continue'
  return url.toString()
}

export async function sendMagicLinkEmail({
  to,
  url,
  code,
}: {
  to: string
  // URL de rappel Auth.js (consomme le code) — jamais envoyée telle quelle.
  url: string
  code: string
}): Promise<void> {
  const continueUrl = continueUrlFor(url)
  const apiKey = process.env.RESEND_API_KEY

  // Le build de production des tests e2e (CI) passe par le transport de
  // test ci-dessous, sans rien journaliser.
  if (!apiKey && process.env.NODE_ENV === 'production' && !isTestMailTransport()) {
    // En production, journaliser le lien donnerait une connexion valide à
    // quiconque lit les logs : on refuse l'envoi plutôt que de le dégrader.
    throw new MagicLinkSendError('RESEND_API_KEY is not set')
  }

  if (!apiKey) {
    // Transport de développement : Resend refuse d'envoyer
    // depuis un domaine non vérifié, et l'absence de clé ne doit jamais
    // bloquer la connexion — le lien part dans la console à la place.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[lib/mail/resend] Magic link for ${to}: ${continueUrl} (code ${code})`)
    }

    // Uniquement pour `tests/e2e/login.spec.ts` et `tests/e2e/auth.setup.ts` :
    // sans boîte mail réelle, les tests
    // lisent ce fichier plutôt que de parser la sortie standard du process
    // `pnpm dev`. N'écrit rien tant que la variable n'est pas positionnée.
    //
    // Un fichier par destinataire (nommé à partir de `to`), pas un fichier
    // unique partagé : `playwright.config.ts` fait tourner le projet
    // `authenticated` (`auth.setup.ts`) et le projet `unauthenticated`
    // (`login.spec.ts`) en parallèle, chacun avec sa propre adresse — un
    // fichier unique se ferait écraser par l'autre projet entre l'écriture
    // et la lecture.
    if (process.env.MAGIC_LINK_DEBUG_FILE) {
      const dir = dirname(process.env.MAGIC_LINK_DEBUG_FILE)
      const perRecipientFile = join(dir, `${encodeURIComponent(to)}.json`)
      await mkdir(dir, { recursive: true })
      // `url` reste l'URL de rappel directe (les tests l'ouvrent sans passer
      // par la page de confirmation), `code` sert aux tests de saisie.
      await writeFile(perRecipientFile, JSON.stringify({ to, url, code }))
    }

    return
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
    to,
    subject: `${code} is your spellcache sign-in code`,
    html: `<p>Enter this code in spellcache to sign in:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>Or, on this device, <a href="${continueUrl}">continue to spellcache</a>.</p><p>The code and the link expire in 10 minutes. If you didn't ask to sign in, you can ignore this email.</p>`,
    text: `Your spellcache sign-in code: ${code}\n\nOr, on this device, continue to spellcache: ${continueUrl}\n\nThe code and the link expire in 10 minutes.`,
  })

  if (error) {
    // Remonte à l'appelant (le message d'erreur d'envoi doit atteindre
    // l'utilisateur) plutôt que d'échouer silencieusement.
    throw new MagicLinkSendError(error.message)
  }
}
