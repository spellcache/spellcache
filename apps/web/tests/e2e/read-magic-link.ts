// Lecture du lien magique écrit par le transport de développement
// (lib/mail/resend.ts) — partagée entre `login.spec.ts` et `auth.setup.ts`,
// un fichier par destinataire pour éviter toute course entre deux projets
// Playwright qui écrivent en parallèle (playwright.config.ts, projets
// `unauthenticated` et `authenticated`).
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { MAGIC_LINK_DEBUG_FILE } from '../../playwright.config'

export async function readMagicLink(email: string): Promise<string> {
  const perRecipientFile = join(
    dirname(MAGIC_LINK_DEBUG_FILE),
    `${encodeURIComponent(email)}.json`,
  )

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const { to, url } = JSON.parse(await readFile(perRecipientFile, 'utf-8')) as {
        to: string
        url: string
      }
      if (to === email) return url
    } catch {
      // Pas encore écrit — retenté ci-dessous.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No magic link written for ${email} in ${perRecipientFile}`)
}
