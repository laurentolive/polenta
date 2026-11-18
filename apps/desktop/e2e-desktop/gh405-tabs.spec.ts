import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH405 — Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageDown / Ctrl+PageUp : onglet voisin, dans l'ordre
 * visuel, en boucle, partout (champ, richtext, terminal), garde « Quitter cette page ? »
 * (specs/GH405-tests.md E1–E7). Sans forge : un repo git local ouvert comme projet par IPC ; la page
 * de l'exigence est ouverte dans une fenêtre dédiée (`app:open-window`), sous file:// un pushState
 * ne route pas.
 *
 *   pnpm test:e2e:desktop -g GH405
 */

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let repo: string
let projectId: string
let reqId: string

const invoke = <T>(p: Page, channel: string, ...args: unknown[]): Promise<T> =>
  p.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const tabs = () => page.getByTestId('tab')
const activeTab = () => page.locator('[data-testid="tab"][data-active]')
const dialog = () => page.getByRole('dialog')
const tabIds = () => tabs().evaluateAll(els => els.map(el => el.getAttribute('data-tab-id')))
const activeId = () => activeTab().getAttribute('data-tab-id')
/** Page affichée (sous file://, préfixée par le lecteur : `/C:/req/…`). */
const routePath = () => new URL(page.url()).pathname.replace(/^\/[A-Za-z]:/, '')
const titleInput = () => page.locator('main input.input-field[type="text"]').first()

async function expectActive(index: number): Promise<void> {
  const ids = await tabIds()
  await expect.poll(activeId).toBe(ids[index])
}

/** Raccourci, focus rendu au corps de la page. */
async function press(keys: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(keys)
}

/** Ferme les onglets au-delà du premier (le premier est la page de l'exigence). */
async function keepFirstTab(): Promise<void> {
  while (await tabs().count() > 1) {
    await tabs().last().click({ button: 'middle' })
    if (await dialog().isVisible()) await dialog().getByRole('button', { name: /sans enregistrer/ }).click()
  }
  if (await activeId() !== (await tabIds())[0]) await tabs().first().click()
  await expect.poll(routePath).toContain(`/req/${reqId}`)
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh405-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
  let first: Page
  ;({ app, page: first } = await launch(newProfile()))
  expect((await invoke<{ status: string }>(first, 'workspace:open-project', repo)).status).toBe('ok')
  projectId = Buffer.from(repo, 'utf8').toString('base64url')
  await invoke(first, 'schema:save', repo, {
    version: 1,
    linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [{
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'statement', label: 'Énoncé', type: 'richtext' }],
        statuses: [{ name: 'draft', label: 'Brouillon' }],
      }],
    }],
  })
  reqId = (await invoke<{ id: string }>(first, 'requirements:create', repo, { title: 'GH405', objectTypeRef: 'root::exigence', fields: {} }, repo)).id

  const before = new Set(app.windows())
  const created = app.waitForEvent('window', { predicate: p => !before.has(p) })
  await invoke(first, 'app:open-window', `/req/${reqId}?${new URLSearchParams({ repoPath: repo, projectId })}`)
  page = await created
  await page.waitForLoadState('domcontentloaded')
  await expect(titleInput()).toHaveValue('GH405', { timeout: 20_000 })
})

test.afterAll(async () => {
  await app?.close()
})

test('E1/E7 — Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageDown/PageUp : ordre visuel, en boucle ; Ctrl+T / Ctrl+W', async () => {
  await press('Control+t')
  await press('Control+t')
  await expect(tabs()).toHaveCount(3)
  await tabs().first().click()
  await expectActive(0)

  await press('Control+Tab')
  await expectActive(1)
  await press('Control+Tab')
  await expectActive(2)
  await press('Control+Tab')
  await expectActive(0)
  await press('Control+Shift+Tab')
  await expectActive(2)
  await press('Control+PageUp')
  await expectActive(1)
  await press('Control+PageDown')
  await expectActive(2)
  await press('Control+PageDown')
  await expectActive(0)
  await expect(dialog()).toBeHidden()

  // Ctrl+W sur le dernier onglet (le premier porte la page de l'exigence des tests suivants).
  await press('Control+Shift+Tab')
  await expectActive(2)
  await press('Control+w')
  await expect(tabs()).toHaveCount(2)
  await keepFirstTab()
})

test('E2 — ordre après glisser d\'un onglet', async () => {
  await press('Control+t')
  await press('Control+t')
  await expect(tabs()).toHaveCount(3)
  const [a, b, c] = await tabIds()
  // C glissé avant B : A C B.
  await tabs().nth(2).dragTo(tabs().nth(1), { targetPosition: { x: 2, y: 10 } })
  await expect.poll(tabIds).toEqual([a, c, b])
  await tabs().first().click()
  await expect.poll(activeId).toBe(a)
  await press('Control+Tab')
  await expect.poll(activeId).toBe(c)
  await keepFirstTab()
})

test('E3 — un seul onglet : rien', async () => {
  await expect(tabs()).toHaveCount(1)
  const url = page.url()
  await press('Control+Tab')
  await press('Control+PageDown')
  await expect(tabs()).toHaveCount(1)
  await expect(dialog()).toBeHidden()
  expect(page.url()).toBe(url)
})

test('E4 — focus dans un champ texte ou un richtext : le raccourci change d\'onglet, rien n\'est saisi', async () => {
  await press('Control+t')
  await tabs().first().click()
  await expect.poll(routePath).toContain(`/req/${reqId}`)

  await titleInput().focus()
  await page.keyboard.press('Control+Tab')
  await expectActive(1)
  await page.keyboard.press('Control+Shift+Tab')
  await expectActive(0)
  await expect(titleInput()).toHaveValue('GH405')

  const editor = page.locator('main .ProseMirror[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.press('Control+PageDown')
  await expectActive(1)
  await expect(dialog()).toBeHidden()
  await page.keyboard.press('Control+PageUp')
  await expectActive(0)
  await expect(page.locator('main .ProseMirror[contenteditable="true"]').first()).toHaveText('')
  await expect(activeTab().locator('.rounded-full')).toHaveCount(0)
  await keepFirstTab()
})

test('E5 — exigence modifiée : popup ; Rester garde la saisie, Quitter ne l\'enregistre pas', async () => {
  await press('Control+t')
  await tabs().first().click()
  await expect.poll(routePath).toContain(`/req/${reqId}`)
  await expect(titleInput()).toHaveValue('GH405')
  await titleInput().fill('GH405 modifié')
  // Saisie prise en compte par le formulaire (point « modifié » sur l'onglet).
  await expect(activeTab().locator('.rounded-full')).toHaveCount(1)
  await page.keyboard.press('Control+Tab')
  await expect(dialog()).toContainText('Quitter cette page ?')
  await page.keyboard.press('Control+Tab')
  await dialog().getByRole('button', { name: 'Rester' }).click()
  await expect(dialog()).toBeHidden()
  await expectActive(0)
  await expect(titleInput()).toHaveValue('GH405 modifié')
  await expect(activeTab().locator('.rounded-full')).toHaveCount(1)

  await page.keyboard.press('Control+PageDown')
  await dialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expectActive(1)
  const saved = await invoke<{ title: string }>(page, 'requirements:get', repo, reqId)
  expect(saved.title).toBe('GH405')
  await keepFirstTab()
  await expect(titleInput()).toHaveValue('GH405')
})

test('E6 — menu ▾ ouvert : le raccourci ne fait rien', async () => {
  await press('Control+t')
  await tabs().first().click()
  await page.getByTitle('Tous les onglets').click()
  await page.keyboard.press('Control+Tab')
  await expectActive(0)
  await page.keyboard.press('Escape')
  await keepFirstTab()
})

test('E4 — focus dans le terminal Git Bash', async () => {
  test.skip(process.platform !== 'win32', 'Git Bash : Windows seulement')
  await press('Control+t')
  await expectActive(1)
  await page.locator('button[title="Version"]').first().click()
  await page.getByRole('button', { name: "Voir l'arbre de versions" }).click()
  await page.waitForFunction(() => window.location.pathname.endsWith('/graph'))
  await page.keyboard.press('Control+Backquote')
  const host = page.locator('[data-testid="terminal-host"]')
  await expect(host.locator('.xterm-rows')).toContainText('$', { timeout: 20_000 })
  await host.locator('textarea').focus()
  // Une tabulation reçue par bash compléterait `/tm` en `/tmp/` : la sortie serait `/tmp/X`.
  await page.keyboard.type('echo /tm')
  await expect(host.locator('.xterm-rows')).toContainText('echo /tm')
  await page.keyboard.press('Control+Tab')
  await expectActive(0)
  await page.keyboard.press('Control+Tab')
  await expectActive(1)
  await host.locator('textarea').focus()
  await page.keyboard.type('X')
  await page.keyboard.press('Enter')
  await expect(host.locator('.xterm-rows')).toContainText('/tmX')
  await expect(host.locator('.xterm-rows')).not.toContainText('/tmp/X')
  await keepFirstTab()
})
