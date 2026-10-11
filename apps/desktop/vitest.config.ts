import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// GH44 — tests du serveur web (noyau Node, sans Electron). Mêmes alias que electron.vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
      '@polenta/merge-core': resolve(__dirname, '../../packages/merge-core/src/index.ts'),
    },
  },
  test: {
    // GH45 — aussi les services du process main (forges, configuration machine, comptes).
    include: ['src/web-server/**/*.test.ts', 'src/main/services/**/*.test.ts'],
    environment: 'node',
    // GH49 — les services partagés lisent la marque au chargement (src/shared/brand.ts).
    setupFiles: ['scripts/register-brand.ts'],
    testTimeout: 20_000,
  },
})
