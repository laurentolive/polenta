import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// GH63 — tests du service d'administration et du proxy Docker (Node seul, kit simulé par des scripts).
export default defineConfig({
  resolve: {
    alias: {
      '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
