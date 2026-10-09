import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Base éphémère partagée par tous les packages (voir testing/global-setup.ts).
    globalSetup: ['testing/global-setup.ts'],
    fileParallelism: false,
  },
})
