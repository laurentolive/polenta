import { defineConfig } from '@playwright/test'

/**
 * GH45 — tests d'interface du DESKTOP (Electron) contre une vraie forge du kit deploy/
 * (specs/GH45-tests.md, S2b). Pilote le build (`out/main`) dans un profil isolé
 * (POLENTA_USER_DATA_DIR / POLENTA_KEYTAR_SERVICE) : les comptes du poste ne sont pas touchés.
 *
 *   POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" [POLENTA_E2E_INSTANCE=acme] pnpm test:e2e:desktop
 */
export default defineConfig({
  testDir: './e2e-desktop',
  outputDir: './e2e-desktop/.results',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
