import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

/**
 * GH45 — lancement du desktop buildé (`out/main`) dans un profil ISOLÉ :
 * - `POLENTA_USER_DATA_DIR` : auth.json, préférences, cache de configuration propres au test ;
 * - `POLENTA_KEYTAR_SERVICE` : jetons dans un service keytar dédié — les comptes personnels du poste
 *   ne sont jamais lus ni modifiés.
 */
export const APP_ROOT = path.resolve(__dirname, '..', '..')
export const MAIN = path.join(APP_ROOT, 'out', 'main', 'index.js')
export const KEYTAR_SERVICE = 'polenta-e2e'

export function newProfile(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-e2e-profile-'))
}

export interface Launched {
  app: ElectronApplication
  page: Page
}

export function electronEnv(profile: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env['ELECTRON_RUN_AS_NODE']   // sinon Electron démarre comme un simple Node
  env['POLENTA_USER_DATA_DIR'] = profile
  env['POLENTA_KEYTAR_SERVICE'] = KEYTAR_SERVICE
  return env
}

export async function launch(profile: string, extraArgs: string[] = []): Promise<Launched> {
  const app = await electron.launch({ args: [MAIN, ...extraArgs], env: electronEnv(profile), timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Lancement avec un fichier de configuration machine (politique DSI), via POLENTA_CONFIG. */
export async function launchWithConfig(profile: string, configFile: string, extraArgs: string[] = []): Promise<Launched> {
  const app = await electron.launch({ args: [MAIN, ...extraArgs], env: { ...electronEnv(profile), POLENTA_CONFIG: configFile }, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Le sélecteur de dossier natif est remplacé (Playwright ne pilote pas les dialogues de l'OS). */
export async function stubFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, folder)
}

export const loginInput = (page: Page) => page.locator('input[autocomplete="username"]')
export const passwordInput = (page: Page) => page.locator('input[autocomplete="current-password"]')
export const otpInput = (page: Page) => page.locator('input[autocomplete="one-time-code"]')

/** Connexion identifiant + mot de passe sur l'écran de connexion déjà affiché (serveur déjà choisi). */
export async function signIn(page: Page, login: string, password: string, otp?: string): Promise<void> {
  await expect(loginInput(page)).toBeVisible()
  await loginInput(page).fill(login)
  await passwordInput(page).fill(password)
  if (otp) await otpInput(page).fill(otp)
  await page.getByRole('button', { name: /^(Se connecter|Log in)$/ }).click()
}

/** Écran de connexion sur un serveur donné (saisie « Serveur de votre entreprise… »). */
export async function chooseServer(page: Page, server: string): Promise<void> {
  await page.locator('select').selectOption('custom')
  await page.locator('input[placeholder*="acme.forge"]').fill(server)
}

export async function openAccountPanel(page: Page): Promise<void> {
  await page.locator('button[title="Compte"], button[title="Account"]').first().click()
}
