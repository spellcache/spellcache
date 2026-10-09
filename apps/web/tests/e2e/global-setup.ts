// Les specs e2e créent leurs comptes par le vrai cycle de lien magique
// (`/login` avec un email neuf) : il faut des inscriptions ouvertes. Le
// réglage d'Administration › Users vaut `invite` par défaut — on l'ouvre le
// temps de la suite et `global-teardown.ts` remet la valeur d'origine, pour
// ne pas laisser la base de dev ouverte derrière soi.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

export const PREVIOUS_SIGNUP_MODE_FILE = fileURLToPath(
  new URL('../../test-results/previous-signup-mode.txt', import.meta.url),
)

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rows } = await pool.query<{ signup_mode: string }>(
      'SELECT signup_mode FROM site_settings WHERE id = 1',
    )
    // `test-results/` n'existe pas encore sur une copie neuve (CI).
    mkdirSync(dirname(PREVIOUS_SIGNUP_MODE_FILE), { recursive: true })
    writeFileSync(PREVIOUS_SIGNUP_MODE_FILE, rows[0]?.signup_mode ?? 'invite')
    await pool.query(
      `INSERT INTO site_settings (id, signup_mode) VALUES (1, 'open')
       ON CONFLICT (id) DO UPDATE SET signup_mode = 'open'`,
    )
  } finally {
    await pool.end()
  }
}
