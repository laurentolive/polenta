import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH343 sprint 1 — deux projets différents dans deux fenêtres (specs/GH343-tests.md T8–T16, T19
 * pour l'affichage du compte). Sans forge : deux repos git locaux ouverts comme projets par IPC,
 * deux comptes fictifs (hôtes `.invalid`, jetons dans le service keytar des e2e, retirés à la fin).
 *
 *   pnpm test:e2e:desktop -g GH343
 */

test.describe.configure({ mode: 'serial' })

const HOST_A = 'git-a.gh343.invalid'
const HOST_B = 'git-b.gh343.invalid'

let profile: string
let app: ElectronApplication
let first: Page
let repoA: string
let repoB: string
let idA: string
let idB: string

const invoke = <T>(page: Page, channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const encodeId = (dir: string) => Buffer.from(dir, 'utf8').toString('base64url')
const stateFile = () => path.join(profile, 'windows-state.json')
const schemaRoute = (id: string) => `/schema?repoPath=&projectId=${id}`

function makeRepo(name: string, host: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `polenta-gh343-${name}-`))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.name', 'e2e')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'remote', 'add', 'origin', `https://${host}/acme/${name}.git`)
  git(dir, 'commit', '--allow-empty', '-m', 'init')
  return dir
}

async function appWindows(): Promise<Page[]> {
  const visible: Page[] = []
  for (const p of app.windows()) {
    if (p.isClosed()) continue
    const shown = await app.browserWindow(p).then(w => w.evaluate(bw => !bw.isDestroyed() && bw.isVisible())).catch(() => false)
    if (shown) visible.push(p)
  }
  return visible
}

async function waitForWindowCount(n: number): Promise<Page[]> {
  await expect.poll(async () => (await appWindows()).length, { timeout: 20_000 }).toBe(n)
  return appWindows()
}

async function newWindowAfter(action: () => Promise<unknown>): Promise<Page> {
  const before = new Set(app.windows())
  const created = app.waitForEvent('window', { predicate: p => !before.has(p) })
  await action()
  const page = await created
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Page affichée (sous file://, préfixée par le lecteur : `/C:/schema`). */
const routePath = (page: Page) => new URL(page.url()).pathname.replace(/^\/[A-Za-z]:/, '')
const projectOf = (page: Page) => new URL(page.url()).searchParams.get('projectId')
/** Accueil : `/`, et il y reste (pas de saut différé). */
async function expectStaysHome(page: Page): Promise<void> {
  await expect.poll(() => routePath(page), { timeout: 15_000 }).toBe('/')
  await page.waitForTimeout(2_000)
  expect(routePath(page)).toBe('/')
}

async function quitApp(): Promise<void> {
  const closed = new Promise<void>(resolve => app.process().once('exit', () => resolve()))
  await app.evaluate(({ app: electronApp }) => { electronApp.quit() })
  await closed
}

/** Panneau Projet affiché (le bouton de la barre d'activité replie le panneau s'il l'est déjà). */
async function showProjectPanel(page: Page): Promise<void> {
  const probe = page.getByTestId('project-new-window')
  // Le panneau peut s'afficher après le premier rendu : l'attendre avant de décider de cliquer.
  await probe.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (!(await probe.isVisible())) await page.locator('button[title="Projet"]').first().click()
  await expect(probe).toBeVisible()
}

test.beforeAll(async () => {
  repoA = makeRepo('a', HOST_A)
  repoB = makeRepo('b', HOST_B)
  idA = encodeId(repoA)
  idB = encodeId(repoB)
  profile = newProfile()
  // Deux comptes, un par forge ; compte par défaut : celui de la forge A.
  fs.writeFileSync(path.join(profile, 'auth.json'), JSON.stringify({
    accounts: [
      { remoteHost: HOST_A, username: 'alice', name: 'Alice A', email: 'a@x', provider: 'forgejo', baseUrl: `https://${HOST_A}` },
      { remoteHost: HOST_B, username: 'bruno', name: 'Bruno B', email: 'b@x', provider: 'forgejo', baseUrl: `https://${HOST_B}` },
    ],
    defaultAccount: `${HOST_A}:alice`,
  }))
  ;({ app, page: first } = await launch(profile))
  for (const host of [HOST_A, HOST_B]) await invoke(first, 'auth:save-token', `https://${host}`, 'tok-gh343')
  for (const repo of [repoA, repoB]) {
    expect((await invoke<{ status: string }>(first, 'workspace:open-project', repo)).status).toBe('ok')
  }
  await invoke(first, 'workspace:mark-recent', repoB)
  await invoke(first, 'workspace:mark-recent', repoA)   // dernier projet ouvert : A
})

test.afterAll(async () => {
  if (app) {
    const [win] = await appWindows().catch(() => [])
    if (win) for (const host of [HOST_A, HOST_B]) await invoke(win, 'auth:delete-token', `https://${host}`).catch(() => {})
  }
  await app?.close().catch(() => {})
})

let home: Page
let wA: Page
let wB: Page

test('GH343 T9 — nouvelle fenêtre depuis l’accueil : elle reste sur l’accueil', async () => {
  // Fenêtre de lancement : elle était sur /login (aucun compte au démarrage) ; elle n'a plus droit au saut.
  home = await newWindowAfter(() => invoke(first, 'app:open-window', '/'))
  await expectStaysHome(home)
  await home.getByTestId('tab').first().click()   // focus sans toucher aux cartes de l'accueil
  const viaShortcut = await newWindowAfter(() => home.keyboard.press('Control+Shift+N'))
  await expectStaysHome(viaShortcut)
  await app.browserWindow(viaShortcut).then(w => w.evaluate(bw => bw.close()))
})

test('GH343 T11 — clic droit sur un projet récent → nouvelle fenêtre sur ce projet', async () => {
  await showProjectPanel(home)
  const recentB = home.getByTestId('project-recent').filter({ hasText: path.basename(repoB) })
  await recentB.click({ button: 'right' })
  wB = await newWindowAfter(() => home.getByRole('button', { name: 'Ouvrir dans une nouvelle fenêtre' }).dispatchEvent('mousedown'))
  await expect.poll(() => projectOf(wB), { timeout: 15_000 }).toBe(idB)
  expect(routePath(home)).toBe('/')
})

test('GH343 T10 — « Nouvelle fenêtre » du panneau Projet, fenêtre sur un projet : nouvelle fenêtre sur l’accueil', async () => {
  wA = await newWindowAfter(() => invoke(first, 'app:open-window', schemaRoute(idA)))
  await expect.poll(() => projectOf(wA), { timeout: 15_000 }).toBe(idA)
  await showProjectPanel(wA)
  const blank = await newWindowAfter(() => wA.getByTestId('project-new-window').click())
  await expectStaysHome(blank)
  await app.browserWindow(blank).then(w => w.evaluate(bw => bw.close()))
})

test('GH343 T19 — chaque fenêtre affiche le compte de la forge de son projet', async () => {
  await wA.locator('button[title="Compte"]').first().click()
  await expect(wA.getByText('Alice A')).toBeVisible()
  await wB.locator('button[title="Compte"]').first().click()
  await expect(wB.getByText('Bruno B')).toBeVisible()
  await wA.locator('button[title="Projet"]').first().click()
  await wB.locator('button[title="Projet"]').first().click()
})

test('GH343 T16 — une écriture dans le projet A ne relance pas les lectures de la fenêtre B', async () => {
  // Vue Exigences de B : requêtes globales actives (liens du workspace, couverture), celles que
  // repo:file-changed invalidait pour n'importe quel repo.
  const productB = await newWindowAfter(() => invoke(first, 'app:open-window', `/product?projectId=${idB}&category=requirement`))
  await expect.poll(() => projectOf(productB), { timeout: 15_000 }).toBe(idB)
  await productB.waitForTimeout(3_000)
  // Compteur, côté main, des appels IPC de cette fenêtre (lectures relancées par repo:file-changed).
  // `window.polenta` est figé par contextBridge : les handlers de ipcMain sont enveloppés (champ
  // interne `_invokeHandlers` d'Electron, test seulement).
  const senderId = await app.browserWindow(productB).then(w => w.evaluate(bw => bw.webContents.id))
  await app.evaluate(({ ipcMain }, id) => {
    const g = globalThis as unknown as { __gh343Calls: Record<string, number>; __gh343Wrapped?: boolean }
    g.__gh343Calls = {}
    if (g.__gh343Wrapped) return
    g.__gh343Wrapped = true
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (e: { sender: { id: number } }, ...a: unknown[]) => unknown> })._invokeHandlers
    for (const [channel, fn] of handlers) {
      handlers.set(channel, (e, ...a) => {
        if (e.sender.id === id) g.__gh343Calls[channel] = (g.__gh343Calls[channel] ?? 0) + 1
        return fn(e, ...a)
      })
    }
  }, senderId)
  const callsByChannel = () => app.evaluate(() => (globalThis as unknown as { __gh343Calls: Record<string, number> }).__gh343Calls)
  // Hors minuteries sans rapport avec le fichier modifié : pull automatique, état de fenêtre, état
  // git interrogé toutes les 3 s (useModificationMode, useBranchCheckout).
  const calls = async () => Object.entries(await callsByChannel())
    .filter(([c]) => !/^(app:|sync:auto|sync:status$)/.test(c))
    .reduce((n, [, v]) => n + v, 0)
  // Fichier de liens : invalide les clés du workspace (liens, couverture, widgets, versions…).
  const touch = (repo: string) => {
    fs.mkdirSync(path.join(repo, 'links'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'links', 'links.yaml'), `# ${Date.now()}\nlinks: []\n`)
  }

  await productB.waitForTimeout(1_500)
  await app.evaluate(() => { (globalThis as unknown as { __gh343Calls: Record<string, number> }).__gh343Calls = {} })
  touch(repoA)
  await productB.waitForTimeout(3_000)
  expect(await callsByChannel().then(c => Object.keys(c).filter(k => !/^(app:|sync:auto|sync:status$)/.test(k)))).toEqual([])

  // Contrôle de l'instrument : la même écriture dans le projet B relance bien des lectures.
  touch(repoB)
  await expect.poll(calls, { timeout: 5_000 }).toBeGreaterThan(0)
  await app.browserWindow(productB).then(w => w.evaluate(bw => bw.close()))
  await productB.waitForEvent('close').catch(() => {})
})

test('GH343 T12/T13 — fermer le projet dans une fenêtre ne touche ni les autres ni le dernier projet d’une autre', async () => {
  // Deux fenêtres sur A (wA et une copie) : fermer A dans la copie garde A comme dernier projet ouvert.
  const copyA = await newWindowAfter(() => invoke(first, 'app:open-window', schemaRoute(idA)))
  await expect.poll(() => projectOf(copyA), { timeout: 15_000 }).toBe(idA)
  await showProjectPanel(copyA)
  await copyA.getByTitle('Fermer le projet').click()
  await expectStaysHome(copyA)
  expect((await invoke<{ workspaceDir: string } | null>(first, 'workspace:get-last-opened'))?.workspaceDir).toBe(repoA)
  expect(projectOf(wA)).toBe(idA)
  expect(projectOf(wB)).toBe(idB)
  await app.browserWindow(copyA).then(w => w.evaluate(bw => bw.close()))

  // B fermé dans sa fenêtre : A (autre fenêtre, dernier projet) n'est pas affecté.
  const before = wA.url()
  await wB.getByTitle('Fermer le projet').click()
  await expectStaysHome(wB)
  expect(wA.url()).toBe(before)
  // Le projet fermé n'est pas remarqué comme dernier ouvert au départ de /schema (remontage du routeur).
  await wB.waitForTimeout(1_000)
  expect((await invoke<{ workspaceDir: string } | null>(first, 'workspace:get-last-opened'))?.workspaceDir).toBe(repoA)
})

test('GH343 T14 — relance : chaque fenêtre rouvre sur son projet, celle de l’accueil y reste', async () => {
  // Une fenêtre sur B, puis plus de fenêtre de lancement (restée sur /login, page non mémorisée :
  // elle rouvrirait en premier, avec le saut).
  const onBWindow = await newWindowAfter(() => invoke(first, 'app:open-window', schemaRoute(idB)))
  await expect.poll(() => projectOf(onBWindow), { timeout: 15_000 }).toBe(idB)
  await app.browserWindow(first).then(w => w.evaluate(bw => bw.close()))
  await first.waitForEvent('close').catch(() => {})
  const windows = await appWindows()
  // Fenêtres attendues : A, B, et des fenêtres à l'accueil (dont la fenêtre de lancement).
  const onA = windows.filter(p => projectOf(p) === idA).length
  const onB = windows.filter(p => projectOf(p) === idB).length
  const onHome = windows.filter(p => routePath(p) === '/' ).length
  await quitApp()
  const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as { windows: { route?: string }[] }
  expect(saved.windows.length).toBe(windows.length)

  ;({ app } = await launch(profile))
  const reopened = await waitForWindowCount(windows.length)
  await expect.poll(() => reopened.filter(p => projectOf(p) === idA).length, { timeout: 20_000 }).toBe(onA)
  await expect.poll(() => reopened.filter(p => projectOf(p) === idB).length, { timeout: 20_000 }).toBe(onB)
  await reopened[0].waitForTimeout(2_000)
  expect(reopened.filter(p => routePath(p) === '/').length).toBe(onHome)
})

test('GH343 T15/T8 — page mémorisée invalide : seule la première fenêtre saute ; sans disposition : saut', async () => {
  await quitApp()
  const gone = encodeId(path.join(os.tmpdir(), 'polenta-gh343-absent'))
  fs.writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    windows: [
      { x: 60, y: 60, width: 900, height: 700, route: schemaRoute(idB) },
      { x: 120, y: 120, width: 900, height: 700, route: `/product?projectId=${gone}` },
    ],
  }))
  ;({ app } = await launch(profile))
  const [w1, w2] = await waitForWindowCount(2)
  const pages = [w1, w2]
  await expect.poll(() => pages.some(p => projectOf(p) === idB), { timeout: 20_000 }).toBe(true)
  const other = pages.find(p => projectOf(p) !== idB)!
  await expectStaysHome(other)

  // T8 — sans disposition mémorisée : la fenêtre de lancement saute dans le dernier projet ouvert.
  await invoke(other, 'workspace:mark-recent', repoA)
  await quitApp()
  fs.rmSync(stateFile())
  ;({ app } = await launch(profile))
  const [only] = await waitForWindowCount(1)
  await expect.poll(() => projectOf(only), { timeout: 20_000 }).toBe(idA)
})
