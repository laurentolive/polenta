import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH407 — onglet glissé depuis une autre fenêtre et déposé sur une fenêtre dont la page active est
 * modifiée : l'onglet arrive en arrière-plan et « Quitter cette page ? » s'affiche. Rester : la
 * saisie de la fenêtre d'arrivée est intacte, l'onglet reçu reste dans la barre avec sa propre
 * saisie ; Quitter (au clic sur cet onglet) l'affiche avec sa saisie. Même simulation du glisser que
 * e2e-desktop/gh343-drag.spec.ts (événements HTML5 envoyés aux barres d'onglets).
 *
 *   pnpm test:e2e:desktop -g GH407
 */

test.describe.configure({ mode: 'serial' })

const MIME = 'application/x-polenta-tab'

let app: ElectronApplication
let first: Page
let repo: string
let projectId: string
let reqA: string
let reqB: string

const invoke = <T>(page: Page, channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const q = (o: Record<string, string>) => new URLSearchParams(o).toString()
const reqRoute = (id: string) => `/req/${id}?${q({ repoPath: repo, projectId })}`

const tabs = (page: Page) => page.getByTestId('tab')
const activeTabId = (page: Page) => page.locator('[data-testid="tab"][data-active]').getAttribute('data-tab-id')
const routePath = (page: Page) => new URL(page.url()).pathname.replace(/^\/[A-Za-z]:/, '')
const titleInput = (page: Page) => page.locator('main input.input-field[type="text"]:not([readonly])').first()
const leaveDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Quitter cette page ?' })

async function newWindowAfter(action: () => Promise<unknown>): Promise<Page> {
  const before = new Set(app.windows())
  const created = app.waitForEvent('window', { predicate: p => !before.has(p) })
  await action()
  const page = await created
  await page.waitForLoadState('domcontentloaded')
  return page
}
const openWindow = (route: string) => newWindowAfter(() => invoke(first, 'app:open-window', route))

async function dragStart(page: Page, index: number): Promise<string> {
  const id = await page.evaluate(([i, mime]) => {
    const el = document.querySelectorAll('[data-testid="tab"]')[i as number]
    const dt = new DataTransfer()
    ;(window as unknown as { __gh407Dt: DataTransfer; __gh407El: Element }).__gh407Dt = dt
    ;(window as unknown as { __gh407El: Element }).__gh407El = el
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    return dt.getData(mime as string)
  }, [index, MIME] as const)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  return id
}

async function dragEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gh407Dt: DataTransfer; __gh407El: Element }
    w.__gh407Dt.dropEffect = 'move'
    const target = w.__gh407El.isConnected ? w.__gh407El : document.querySelector('[data-testid="tab-strip"]')!
    target.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: w.__gh407Dt }))
  }).catch(() => {})
}

/** Survol puis dépôt en fin de barre d'onglets. */
async function dropOn(page: Page, dragId: string): Promise<boolean> {
  return page.evaluate(async ([id, mime]) => {
    const strip = document.querySelector('[data-testid="tab-strip"]') as HTMLElement
    const r = strip.getBoundingClientRect()
    const dt = new DataTransfer()
    dt.setData(mime as string, id as string)
    const fire = (type: string) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 4, clientY: r.top + r.height / 2 })
      strip.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    fire('dragenter')
    await new Promise(res => setTimeout(res, 400))   // réponse du main (acceptation)
    const accepted = fire('dragover')
    fire('drop')
    return accepted
  }, [dragId, MIME] as const)
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh407-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
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
        fields: [{ name: 'note', label: 'Note', type: 'text' }],
        statuses: [{ name: 'draft', label: 'Brouillon' }],
      }],
    }],
  })
  reqA = (await invoke<{ id: string }>(first, 'requirements:create', repo, { title: 'Exigence A', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  reqB = (await invoke<{ id: string }>(first, 'requirements:create', repo, { title: 'Exigence B', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  git('add', '-A')
  git('commit', '-m', 'données')
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('GH407 A1 — onglet déposé sur une page modifiée : garde, Rester garde les deux saisies, Quitter affiche l’onglet reçu', async () => {
  // Fenêtre d'arrivée : exigence A modifiée, non enregistrée.
  const target = await openWindow(reqRoute(reqA))
  await expect(titleInput(target)).toHaveValue('Exigence A')
  await titleInput(target).fill('Exigence A — saisie locale')

  // Fenêtre source : deux onglets, le premier sur l'exigence B modifiée (saisie transportée).
  const source = await openWindow(reqRoute(reqB))
  await tabs(source).first().click()
  await source.keyboard.press('Control+t')
  await expect(tabs(source)).toHaveCount(2)
  await tabs(source).first().click()
  await expect.poll(() => routePath(source)).toBe(`/req/${reqB}`)
  await expect(titleInput(source)).toHaveValue('Exigence B')
  await titleInput(source).fill('Exigence B — saisie transportée')

  const activeBefore = await activeTabId(target)
  const id = await dragStart(source, 0)
  expect(await dropOn(target, id)).toBe(true)
  await dragEnd(source)

  // L'onglet est arrivé en arrière-plan ; la garde s'affiche, la page A est toujours montée.
  await expect(leaveDialog(target)).toBeVisible()
  await expect(tabs(target)).toHaveCount(2)
  await expect(tabs(source)).toHaveCount(1)
  await leaveDialog(target).getByRole('button', { name: 'Rester' }).click()
  await expect(leaveDialog(target)).toBeHidden()
  expect(await activeTabId(target)).toBe(activeBefore)
  expect(routePath(target)).toBe(`/req/${reqA}`)
  await expect(titleInput(target)).toHaveValue('Exigence A — saisie locale')

  // Clic sur l'onglet reçu : garde de GH405 ; Quitter → page B avec la saisie transportée.
  await tabs(target).nth(1).click()
  await expect(leaveDialog(target)).toBeVisible()
  await leaveDialog(target).getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect.poll(() => routePath(target)).toBe(`/req/${reqB}`)
  await expect(titleInput(target)).toHaveValue('Exigence B — saisie transportée')
  // Rien n'a été écrit : ni A (abandonnée), ni B (saisie toujours en cours).
  expect(fs.readFileSync(path.join(repo, 'requirements', `${reqA}.yaml`), 'utf8')).not.toContain('saisie locale')
  expect(fs.readFileSync(path.join(repo, 'requirements', `${reqB}.yaml`), 'utf8')).not.toContain('saisie transportée')
})
