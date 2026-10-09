import { existsSync } from 'node:fs'

import { defineConfig } from 'drizzle-kit'

// Un seul `.env`, à la racine du dépôt : drizzle-kit tourne depuis ce
// package. Une variable déjà présente dans l'environnement (CI, tests
// d'intégration) n'est jamais écrasée par le fichier.
if (existsSync('../../.env')) process.loadEnvFile('../../.env')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
