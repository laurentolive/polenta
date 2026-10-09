import { defineConfig } from '@playwright/test'
import { E2E } from './e2e-web/support/env'

/**
 * GH44 — tests de bout en bout du client web (`specs/GH44-tests.md`, scénarios S2). Ils pilotent
 * un vrai navigateur (Chromium) sur le serveur web **buildé** (`pnpm build:web`), avec un serveur
 * git HTTP local à la place de la forge : Publier pousse vers un repo nu que le test relit.
 *
 * `pnpm test:e2e:web` (build compris). Réseau requis une fois par exécution : la démo est clonée
 * depuis GitHub pour amorcer le repo nu (ou `POLENTA_E2E_DEMO_SOURCE=<chemin ou URL>`).
 */
export default defineConfig({
  testDir: './e2e-web',
  outputDir: './e2e-web/.results',
  globalSetup: './e2e-web/support/global-setup.ts',
  // Un seul serveur, un seul utilisateur, un projet partagé entre les étapes : exécution en série.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e-web/.report', open: 'never' }]],
  use: {
    baseURL: E2E.baseUrl,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node out/web-server/index.cjs',
    url: `${E2E.baseUrl}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: E2E.serverEnv,
  },
})
