import { FlatCompat } from '@eslint/eslintrc'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

// Une seule configuration, à la racine, pour tout le workspace : les règles
// Next s'appliquent à l'app web (`settings.next.rootDir`), les règles
// TypeScript à tous les packages.
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    settings: { next: { rootDir: 'apps/web/' } },
  },
  {
    ignores: [
      '.*/worktrees/**',
      'design/**',
      // Projet Android généré par Capacitor (copie de www/, sorties Gradle).
      'apps/android/android/**',
      'apps/android/www/capacitor.js',
      '**/.next/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
]

export default eslintConfig
