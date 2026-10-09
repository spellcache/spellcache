// Remet le réglage d'inscription relevé par `global-setup.ts`.
import { existsSync, readFileSync } from 'node:fs'
import { Pool } from 'pg'

import { PREVIOUS_SIGNUP_MODE_FILE } from './global-setup'

export default async function globalTeardown(): Promise<void> {
  if (!process.env.DATABASE_URL || !existsSync(PREVIOUS_SIGNUP_MODE_FILE)) return
  const previous = readFileSync(PREVIOUS_SIGNUP_MODE_FILE, 'utf8').trim()
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query('UPDATE site_settings SET signup_mode = $1 WHERE id = 1', [
      previous === 'open' ? 'open' : 'invite',
    ])
  } finally {
    await pool.end()
  }
}
