import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH238 — terminal Git Bash des vues Version (specs/GH238-tests.md E1–E6). Sans forge : un repo
 * git local ouvert comme projet par IPC. Windows avec Git for Windows installé.
 *
 *   pnpm test:e2e:desktop -g GH238
 */

test.skip(process.platform !== 'win32', 'Git Bash : Windows seulement')

let app: ElectronApplication
let page: Page
let repo: string

const panel = () => page.getByTestId('terminal-panel')
const screenText = () => page.locator('[data-testid="terminal-host"] .xterm-rows')
const sidebar = () => page.getByTestId('sidebar')

/** Navigation par la barre d'activité (Version → /graph, Exigences → /requirements…). */
async function activity(label: 'Version' | 'Exigences'): Promise<void> {
  await page.locator(`button[title="${label}"]`).first().click()
}

/** Tape une ligne dans le terminal (focus dans xterm), attend son écho, puis Entrée. */
async function run(line: string): Promise<void> {
  await page.locator('[data-testid="terminal-host"] textarea').focus()
  await page.keyboard.type(line)
  await expect(screenText()).toContainText(line)
  await page.keyboard.press('Enter')
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh238-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-b', 'main')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '--allow-empty', '-m', 'init')
  ;({ app, page } = await launch(newProfile()))
  const result = await page.evaluate(dir => window.polenta.invoke('workspace:open-project', dir), repo) as { status: string }
  expect(result.status).toBe('ok')
  // Profil sans compte : l'accueil renvoie vers /login (sans barre d'activité). Un pushState sur
  // une route du projet affiche la mise en page (le router la voit comme « Not Found » sous
  // file://), d'où une vraie navigation par la barre d'activité.
  const projectId = await page.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)
  await page.evaluate(id => {
    window.history.pushState({}, '', `/graph?projectId=${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, projectId)
  await activity('Version')
  await page.waitForFunction(() => window.location.pathname.endsWith('/graph'))
})

test.afterAll(async () => {
  await app?.close()
})

test('E1 — Ctrl+ù ouvre Git Bash dans le repo', async () => {
  await expect(panel()).toBeHidden()
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeVisible()
  await expect(panel()).toContainText('Git Bash')
  await expect(screenText()).toContainText('$', { timeout: 20_000 })
  await run('pwd')
  const msys = '/' + repo.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase())
  await expect(screenText()).toContainText(msys.split('/').pop()!)
})

test('E2 — git add : Stagés à jour sans action manuelle', async () => {
  await run('echo GH238 > f.txt')
  await expect(sidebar()).toContainText('f.txt', { timeout: 10_000 })
  await expect(sidebar()).not.toContainText('Stagés')
  // L'index git n'est pas surveillé par le watcher : seul le rafraîchissement du terminal le voit.
  await run('git add f.txt')
  await expect(sidebar()).toContainText('Stagés', { timeout: 5_000 })
})

test('E3 — masquer / quitter les vues Version conserve le contenu ; Ctrl+ù sans effet ailleurs', async () => {
  await run('echo marker-E3')
  await expect(screenText()).toContainText('marker-E3')
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeHidden()
  await activity('Exigences')
  await page.locator('body').click()
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeHidden()
  await activity('Version')
  await expect(panel()).toBeHidden()
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeVisible()
  await expect(screenText()).toContainText('marker-E3')
})

test('E4 — exit puis Entrée relance un shell', async () => {
  await run('exit')
  await expect(screenText()).toContainText('processus terminé', { timeout: 10_000 })
  await page.keyboard.press('Enter')
  // Écran effacé à la relance : attendre l'invite du nouveau shell avant de taper.
  await expect(screenText()).toContainText('$', { timeout: 20_000 })
  await run('echo restarted-E4')
  await expect(screenText()).toContainText('restarted-E4', { timeout: 20_000 })
})

test('E5 — Tuer pendant sleep : fin de session', async () => {
  await run('sleep 30')
  await panel().getByTitle(/Tuer le processus|Kill process/).click()
  await expect(screenText()).toContainText('processus terminé', { timeout: 10_000 })
  const sleeping = execFileSync('tasklist', ['/FI', 'IMAGENAME eq sleep.exe']).toString()
  expect(sleeping).not.toContain('sleep.exe')
})

test('E6 — bouton du header Version', async () => {
  const button = page.getByTestId('version-terminal-toggle')
  await button.click()
  await expect(panel()).toBeHidden()
  await button.click()
  await expect(panel()).toBeVisible()
})

test('E7 — rechargement de la fenêtre : aucun shell orphelin', async () => {
  // Shell tué en E5 : Entrée en relance un.
  await page.locator('[data-testid="terminal-host"] textarea').focus()
  await page.keyboard.press('Enter')
  await expect(screenText()).toContainText('$', { timeout: 20_000 })
  await run('sleep 77')
  // Sous file://, recharger /graph échoue (fichier introuvable) : c'est la navigation de la page
  // principale qui compte, réussie ou non.
  await page.reload().catch(() => {})
  await expect.poll(() => execFileSync('tasklist', ['/FI', 'IMAGENAME eq sleep.exe']).toString(), { timeout: 10_000 })
    .not.toContain('sleep.exe')
})
