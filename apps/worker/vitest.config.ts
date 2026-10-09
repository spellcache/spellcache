import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Base éphémère partagée par tous les packages (packages/db/testing) :
    // démarrée avant les tests d'intégration, arrêtée après. Se dégrade
    // proprement si Docker est indisponible.
    globalSetup: ['../../packages/db/testing/global-setup.ts'],
    // Les fichiers d'intégration partagent une seule base et s'y TRUNCATE
    // mutuellement : exécution sérielle.
    fileParallelism: false,
  },
})
