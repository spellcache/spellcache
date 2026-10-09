import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `tsconfig.json` pose `"jsx": "preserve"` (le SWC de Next fait le vrai
  // transform, pas `tsc` — docs/development.md, aucun composant n'importe `React`).
  // Esbuild (Vite) ne comprend pas cette valeur et retombe sur le runtime
  // classique (`React.createElement`, exigeant un `React` global) : sans
  // cette option, tout fichier `.test.tsx` qui rend un composant réel
  // planterait avec `React is not defined` (`tests/unit/row-heights.test.tsx`,
  // `tests/unit/mana-cost.test.tsx` — le rendu réel des composants remplace
  // ici un calcul de hauteur à la main).
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    // Reflète le path mapping `@/*` de tsconfig.json — les tests important
    // depuis `lib/`, `db/` et `worker/` l'utilisent comme le reste du code.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `next-auth` v5 importe `next/server` sans extension : Next
      // n'a pas de champ `exports`, donc la résolution ESM stricte de
      // Vitest/Node échoue en dehors du bundler de Next lui-même — alias
      // explicite plutôt que de renoncer à tester `lib/auth.ts`.
      'next/server': fileURLToPath(
        new URL('./node_modules/next/server.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // `.test.tsx` inclus à côté de `.test.ts` (par exemple
    // `tests/unit/mana-cost.test.tsx`) — sans elle, un fichier de
    // test contenant du JSX (le rendu `react-dom/server` réel d'un
    // composant, plutôt qu'un calcul à la main sur ses props) ne s'exécute
    // jamais silencieusement, tout en semblant présent sur le disque. Aucun
    // jsdom n'est activé pour autant : `environment` reste
    // `node`, seule l'extension change ce qui se transforme en JSX.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
    ],
    server: {
      // Force Vite (donc l'alias `next/server` ci-dessus) à traiter
      // `next-auth`/`@auth/core` au lieu de les externaliser vers l'`import()`
      // natif de Node, qui n'applique aucun alias.
      deps: { inline: [/next-auth/, /@auth\/core/] },
    },
    // Base éphémère (voir packages/db/testing/global-setup.ts) : démarrée avant
    // les tests d'intégration, arrêtée après. Se dégrade proprement si Docker
    // est indisponible — n'affecte pas les tests unitaires.
    globalSetup: ['../../packages/db/testing/global-setup.ts'],
    // Les fichiers d'intégration partagent UNE base (5433) et se TRUNCATE
    // mutuellement les tables : exécutés en parallèle, ils se marchent
    // dessus et la suite devient non déterministe. Sériel — le coût est de
    // quelques secondes, la reproductibilité les vaut.
    fileParallelism: false,
  },
})
