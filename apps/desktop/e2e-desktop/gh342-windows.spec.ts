import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH342 — plusieurs fenêtres sur le même projet (specs/GH342-tests.md F1–F3, R1–R5, D1). Sans
 * forge : un repo git local ouvert comme projet par IPC.
 *
 *   pnpm test:e2e:desktop -g GH342
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let app: ElectronApplication
let first: Page
let repo: string
let projectId: string
let reqId: string

const invoke = <T>(page: Page, channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const stateFile = () => path.join(profile, 'windows-state.json')
const reqRoute = () => `/req/${reqId}?repoPath=${encodeURIComponent(repo)}&projectId=${projectId}`

/** Fenêtres visibles de l'application (Page Playwright). */
async function appWindows(): Promise<Page[]> {
  const pages = app.windows()
  const visible: Page[] = []
  for (const p of pages) {
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

const tabs = (page: Page) => page.getByTestId('tab')
/** Chemin de la route (sous file://, préfixé par le lecteur : `/C:/req/…`). */
const onPath = (page: Page, route: string) => new URL(page.url()).pathname.endsWith(route)
const bounds = (page: Page) => app.browserWindow(page).then(w => w.evaluate(bw => ({ ...bw.getNormalBounds(), maximized: bw.isMaximized() })))

async function quitApp(): Promise<void> {
  const closed = new Promise<void>(resolve => app.process().once('exit', () => resolve()))
  await app.evaluate(({ app: electronApp }) => { electronApp.quit() })
  await closed
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh342-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
  profile = newProfile()
  ;({ app, page: first } = await launch(profile))
  expect((await invoke<{ status: string }>(first, 'workspace:open-project', repo)).status).toBe('ok')
  projectId = await first.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)
  await invoke(first, 'schema:save', repo, {
    version: 1,
    linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [{
        name: 'exigence', label: 'Exigence GH342', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'note', label: 'Note', type: 'text' }],
        statuses: [{ name: 'draft', label: 'Brouillon' }],
      }],
    }],
  })
  reqId = (await invoke<{ id: string }>(first, 'requirements:create', repo, { title: 'Exigence fenêtres', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  git('add', '-A')
  git('commit', '-m', 'exigence')
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

let w2: Page
let w3: Page

test('GH342 F1 — une fenêtre s’ouvre sur une page ; Ctrl+Shift+N en ouvre une autre sur la même page', async () => {
  w2 = await newWindowAfter(() => invoke(first, 'app:open-window', reqRoute()))
  await expect(tabs(w2)).toHaveCount(1)
  await expect(tabs(w2).first()).toContainText('Exigence fenêtres')
  expect(onPath(w2, `/req/${reqId}`)).toBe(true)

  await w2.locator('body').click()
  w3 = await newWindowAfter(() => w2.keyboard.press('Control+Shift+N'))
  await expect(tabs(w3)).toHaveCount(1)
  await expect(tabs(w3).first()).toContainText('Exigence fenêtres')
  expect(onPath(w3, `/req/${reqId}`)).toBe(true)
  expect(new URL(w3.url()).searchParams.get('projectId')).toBe(projectId)

  const [b2, b3] = [await bounds(w2), await bounds(w3)]
  // Mise à l'échelle Windows (125 %…) : arrondis d'un pixel.
  expect(Math.abs(b3.width - b2.width)).toBeLessThanOrEqual(2)
  expect(b3.x - b2.x).toBeGreaterThan(10)
})

test('GH342 F2/F3 — menu d’onglet « Ouvrir dans une nouvelle fenêtre » : copie, fenêtres indépendantes', async () => {
  await w2.locator('body').click()
  await w2.keyboard.press('Control+t')
  await expect(tabs(w2)).toHaveCount(2)

  await tabs(w2).first().click({ button: 'right' })
  const w4 = await newWindowAfter(() => w2.getByRole('button', { name: 'Ouvrir dans une nouvelle fenêtre' }).dispatchEvent('mousedown'))
  await expect(tabs(w4).first()).toContainText('Exigence fenêtres')
  expect(onPath(w4, `/req/${reqId}`)).toBe(true)
  await expect(tabs(w2)).toHaveCount(2)   // copie : l'onglet reste
  await expect(tabs(w3)).toHaveCount(1)   // les autres fenêtres ne bougent pas

  await app.browserWindow(w4).then(w => w.evaluate(bw => bw.close()))
  await waitForWindowCount(3)
})

test('GH342 D1 — une modification enregistrée dans une fenêtre apparaît dans l’autre', async () => {
  await tabs(w2).first().click()
  const title = w2.locator('main input.input-field[type="text"]:not([readonly])').first()
  await expect(title).toHaveValue('Exigence fenêtres')
  await title.fill('Exigence modifiée ailleurs')
  await w2.getByRole('button', { name: 'Sauvegarder' }).click()
  await expect.poll(() => fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8').includes('modifiée ailleurs')).toBe(true)
  // CA4 : moins de 3 s après l'écriture (mesuré : < 1 s).
  await expect(tabs(w3).first()).toContainText('Exigence modifiée ailleurs', { timeout: 3_000 })
})

test('GH342 CA9 — une seule fenêtre par projet fait le pull automatique', async () => {
  expect(await invoke<boolean>(w2, 'app:auto-pull-owner')).toBe(true)    // la plus ancienne sur le projet
  expect(await invoke<boolean>(w3, 'app:auto-pull-owner')).toBe(false)
  expect(await invoke<boolean>(first, 'app:auto-pull-owner')).toBe(true) // hors projet : sans objet
})

const windowId = (page: Page) => app.browserWindow(page).then(w => w.evaluate(bw => bw.id))

test('GH342 P2 — un dialogue natif est rattaché à la fenêtre qui le demande', async () => {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __gh342Parent?: number | null }
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const parent = args.length > 1 ? args[0] as { id: number } : null
      g.__gh342Parent = parent ? parent.id : null
      return { canceled: true, filePaths: [] }
    }) as typeof dialog.showOpenDialog
  })
  await invoke(w3, 'dialog:pick-folder')
  const parent = await app.evaluate(() => (globalThis as unknown as { __gh342Parent?: number | null }).__gh342Parent)
  expect(parent).toBe(await windowId(w3))
})

test('GH342 P1 — la sortie d’un terminal n’arrive qu’à sa fenêtre', async () => {
  test.skip(process.platform !== 'win32', 'Git Bash : Windows seulement')
  const detected = await invoke<{ status: string }>(w2, 'terminal:detect')
  test.skip(detected.status !== 'found', 'Git Bash non installé')
  for (const p of [w2, w3]) {
    await p.evaluate(() => {
      const w = window as unknown as { __gh342Data: string; polenta: { on: (c: string, cb: (...a: unknown[]) => void) => void } }
      w.__gh342Data = ''
      w.polenta.on('terminal:data', (_id, chunk) => { w.__gh342Data += String(chunk) })
    })
  }
  const session = await invoke<{ id: string }>(w2, 'terminal:start', 'shell', repo, 80, 24)
  await invoke(w2, 'terminal:write', session.id, 'echo gh342-marqueur\r')
  await expect.poll(() => w2.evaluate(() => (window as unknown as { __gh342Data: string }).__gh342Data), { timeout: 15_000 }).toContain('gh342-marqueur')
  expect(await w3.evaluate(() => (window as unknown as { __gh342Data: string }).__gh342Data)).toBe('')
  await invoke(w2, 'terminal:kill', session.id)
})

test('GH342 P4 — fermer une fenêtre avec un onglet non sauvegardé demande confirmation', async () => {
  const w5 = await newWindowAfter(() => invoke(first, 'app:open-window', reqRoute()))
  const title = w5.locator('main input.input-field[type="text"]:not([readonly])').first()
  await expect(title).toHaveValue('Exigence modifiée ailleurs')
  await title.fill('Saisie non enregistrée')
  const close = () => app.browserWindow(w5).then(w => w.evaluate(bw => bw.close()))

  await close()
  const guard = w5.getByTestId('window-close-guard')
  await expect(guard).toBeVisible()
  await expect(guard).toContainText('Exigence modifiée ailleurs')
  await guard.getByRole('button', { name: 'Annuler' }).click()
  await expect(guard).toBeHidden()
  await w5.waitForTimeout(3_500)   // au-delà du délai d'accusé de réception : pas de fermeture forcée
  expect(w5.isClosed()).toBe(false)

  await close()
  await expect(guard).toBeVisible()
  const gone = w5.waitForEvent('close')
  await guard.getByRole('button', { name: 'Fermer quand même' }).click()
  await gone
  expect(fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8')).not.toContain('Saisie non enregistrée')
})

test('GH342 P5 — fermer une fenêtre pendant une saisie de la vue Édition l’enregistre', async () => {
  const editRoute = `/product?projectId=${projectId}&node=root&type=exigence&view=edit&item=${reqId}`
  const w6 = await newWindowAfter(() => invoke(first, 'app:open-window', editRoute))
  const note = w6.locator('div.flex.flex-col.gap-1', { has: w6.locator('label', { hasText: /^Note/ }) }).locator('input, textarea').first()
  await expect(note).toBeVisible({ timeout: 20_000 })
  await note.click()
  await w6.keyboard.type('saisie en cours')
  const gone = w6.waitForEvent('close')
  await app.browserWindow(w6).then(w => w.evaluate(bw => bw.close()))   // sans quitter le champ
  await gone
  await expect.poll(() => fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8')).toContain('saisie en cours')
})

test('GH342 P7 — fermer le projet dans une fenêtre le laisse ouvert dans l’autre', async () => {
  const before = w3.url()
  await w2.locator('button[title="Projet"]').first().click()
  await w2.getByTitle('Fermer le projet').click()
  await expect.poll(() => onPath(w2, `/req/${reqId}`)).toBe(false)
  await w3.waitForTimeout(1_000)
  expect(w3.url()).toBe(before)
  await expect(tabs(w3).first()).toContainText('Exigence modifiée ailleurs')
})

test('GH342 R1/R2/R4 — relance : fenêtres ouvertes à la fermeture, positions, page, maximisation', async () => {
  // R2 : la fenêtre 2, fermée en cours de session, ne sera pas rouverte.
  await app.browserWindow(w2).then(w => w.evaluate(bw => bw.close()))
  await waitForWindowCount(2)
  await app.browserWindow(w3).then(w => w.evaluate(bw => bw.setBounds({ x: 120, y: 90, width: 900, height: 640 })))
  await app.browserWindow(first).then(w => w.evaluate(bw => bw.maximize()))
  await expect.poll(() => bounds(first).then(b => b.maximized)).toBe(true)
  await quitApp()

  const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  expect(saved.windows).toHaveLength(2)

  ;({ app } = await launch(profile))
  const windows = await waitForWindowCount(2)
  // Le renderer rouvert navigue vers sa page au démarrage (`__open`) : attendre la navigation.
  await expect.poll(() => windows.some(p => onPath(p, `/req/${reqId}`)), { timeout: 15_000 }).toBe(true)
  const onReq = windows.find(p => onPath(p, `/req/${reqId}`))
  const other = windows.find(p => p !== onReq)
  expect(onReq).toBeDefined()
  await expect(tabs(onReq!).first()).toContainText('Exigence modifiée ailleurs')
  const restored = await bounds(onReq!)
  expect(restored.maximized).toBe(false)
  for (const [k, v] of [['x', 120], ['y', 90], ['width', 900], ['height', 640]] as const) {
    expect(Math.abs(restored[k] - v), k).toBeLessThanOrEqual(2)
  }
  await expect.poll(() => bounds(other!).then(b => b.maximized)).toBe(true)
})

test('GH342 R3/R5 — projet disparu et fenêtre hors écran : démarrage habituel, fenêtre visible', async () => {
  await quitApp()
  const gone = path.join(os.tmpdir(), 'polenta-gh342-absent')
  const goneId = Buffer.from(gone, 'utf8').toString('base64url')
  fs.writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    windows: [{ x: -9000, y: -9000, width: 1000, height: 700, route: `/product?projectId=${goneId}` }],
  }))

  ;({ app } = await launch(profile))
  const [win] = await waitForWindowCount(1)
  await expect.poll(() => onPath(win, '/product')).toBe(false)
  await expect.poll(() => onPath(win, '/login') || onPath(win, '/')).toBe(true)
  const b = await bounds(win)
  const work = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  expect(b.x).toBeGreaterThanOrEqual(work.x)
  expect(b.y).toBeGreaterThanOrEqual(work.y)
  expect(b.x + b.width).toBeLessThanOrEqual(work.x + work.width)
  expect(b.y + b.height).toBeLessThanOrEqual(work.y + work.height)
})

test('GH342 P8 — quitter l’application pendant une saisie de la vue Édition l’enregistre', async () => {
  const [win] = await appWindows()
  const editRoute = `/product?projectId=${projectId}&node=root&type=exigence&view=edit&item=${reqId}`
  const edit = await newWindowAfter(() => invoke(win, 'app:open-window', editRoute))
  const note = edit.locator('div.flex.flex-col.gap-1', { has: edit.locator('label', { hasText: /^Note/ }) }).locator('input, textarea').first()
  await expect(note).toBeVisible({ timeout: 20_000 })
  await note.click()
  await note.press('End')
  await edit.keyboard.type(' — avant la sortie')
  await quitApp()   // app.quit() : pas de garde, mais les saisies sont enregistrées
  expect(fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8')).toContain('avant la sortie')
  ;({ app } = await launch(profile))   // pour afterAll
})
