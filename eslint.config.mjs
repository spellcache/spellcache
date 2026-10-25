import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// Une seule configuration, à la racine, pour tout le workspace : les règles
// Next s'appliquent à l'app web (`settings.next.rootDir`), les règles
// TypeScript à tous les packages.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    settings: { next: { rootDir: 'apps/web/' } },
  },
  {
    // Le shell Android n'est pas une app Next : il redirige vers l'instance distante.
    files: ['apps/android/**'],
    rules: { '@next/next/no-location-assign-relative-destination': 'off' },
  },
  {
    ignores: [
      '.*/worktrees/**',
      'design/**',
      // Projet Android généré par Capacitor (copie de www/, sorties Gradle).
      'apps/android/android/**',
      'apps/android/www/capacitor.js',
      '**/.next/**',
      // Site de documentation : sortie du build et types générés par Astro.
      'apps/docs/dist/**',
      'apps/docs/.astro/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
]

export default eslintConfig
