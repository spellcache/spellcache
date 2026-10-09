// Connexion par lien OU par code : le jeton Auth.js du lien
// magique est un code à 6 chiffres, valable 10 minutes. Le même jeton sert
// le lien (même appareil) et la saisie du code (un autre appareil, ou la
// PWA installée — un lien d'email s'ouvre toujours dans le navigateur, jamais
// dans l'app).
//
// Un code à 6 chiffres n'a qu'un million de valeurs : il ne tient que parce
// que les essais sont comptés et plafonnés (`registerLoginAttempt`), et parce
// qu'il expire vite.
import { randomInt } from 'node:crypto'

import { and, eq, gt, sql } from 'drizzle-orm'

import { verificationTokens } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export const LOGIN_CODE_TTL_SECONDS = 10 * 60
export const MAX_LOGIN_ATTEMPTS = 5

export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

// Compte un essai de connexion pour cet email, AVANT qu'Auth.js ne vérifie
// le code (app/api/auth/[...nextauth]/route.ts) : un essai réussi consomme
// son code, un essai raté reste compté. Au-delà de la limite, tous les codes
// en attente de l'email sont révoqués — il faut en redemander un.
// Renvoie `false` si l'essai doit être refusé.
export async function registerLoginAttempt(email: string): Promise<boolean> {
  const identifier = email.trim().toLowerCase()
  const rows = await db
    .update(verificationTokens)
    .set({ attempts: sql`${verificationTokens.attempts} + 1` })
    .where(eq(verificationTokens.identifier, identifier))
    .returning({ attempts: verificationTokens.attempts })

  // Aucun code en attente : rien à protéger, Auth.js répondra « expiré ».
  if (rows.length === 0) return true

  const worst = Math.max(...rows.map((row) => row.attempts))
  if (worst <= MAX_LOGIN_ATTEMPTS) return true

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier))
  return false
}

// Codes encore valides pour un email : au-delà de cette limite, aucun nouveau
// code n'est envoyé. Sans elle, redemander un code en boucle rendrait cinq
// essais neufs à chaque envoi, et le plafond d'essais ne protégerait plus.
export const MAX_ACTIVE_CODES = 5

export async function canSendLoginCode(email: string): Promise<boolean> {
  const identifier = email.trim().toLowerCase()
  const [row] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(verificationTokens)
    .where(
      and(eq(verificationTokens.identifier, identifier), gt(verificationTokens.expires, new Date())),
    )
  return (row?.active ?? 0) < MAX_ACTIVE_CODES
}
