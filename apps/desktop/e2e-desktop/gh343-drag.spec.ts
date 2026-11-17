import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH343 sprint 2 — glisser un onglet hors de la fenêtre / vers une autre fenêtre
 * (specs/GH343-tests.md T25–T32).
 *
 * Playwright ne produit pas de glisser système entre deux BrowserWindow : les événements HTML5
 * (`dragstart`, `dragenter`/`dragover`/`drop`, `dragend`) sont envoyés aux barres d'onglets des
 * fenêtres, avec le `DataTransfer` d'un vrai glisser. Toute la chaîne est réelle (barre d'onglets,
 * main, autre renderer) ; seul le geste à la souris reste un test manuel (T33). La position du
 * pointeur au lâcher (`screen.getCursorScreenPoint`) est fixée par le test.
 *
 *   pnpm test:e2e:desktop -g GH343
 */

test.describe.configure({ mode: 'serial' })

const MIME = 'application/x-polenta-tab'
const HOST = 'git-drag.gh343.invalid'

let app: ElectronApplication
let first: Page
let repo: string
let repoB: string
let projectId: string
let projectB: string
let reqId: string
let testId: string
let campaignId: string

const invoke = <T>(page: Page, channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const encodeId = (dir: string) => Buffer.from(dir, 'utf8').toString('base64url')
const q = (o: Record<string, string>) => new URLSearchParams(o).toString()
const reqRoute = () => `/req/${reqId}?${q({ repoPath: repo, projectId })}`
const testRoute = () => `/test/${testId}?${q({ repoPath: repo, projectId })}`
const campaignRoute = () => `/campaign/${campaignId}?${q({ repoPath: repo, projectId })}`
const schemaRoute = () => `/schema?${q({ repoPath: '', projectId })}`
const diffRoute = () => `/diff?${q({ projectId, repoPath: repo, filepath: 'notes.txt' })}`
const productRoute = (id = projectId) => `/product?${q({ projectId: id, category: 'requirement' })}`

const tabs = (page: Page) => page.getByTestId('tab')
const routePath = (page: Page) => new URL(page.url()).pathname.replace(/^\/[A-Za-z]:/, '')
const dirtyDot = (page: Page, index = 0) => tabs(page).nth(index).locator('span.rounded-full')

function makeRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `polenta-gh343-drag-${name}-`))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.name', 'e2e')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'commit', '--allow-empty', '-m', 'init')
  return dir
}

async function newWindowAfter(action: () => Promise<unknown>): Promise<Page> {
  const before = new Set(app.windows())
  const created = app.waitForEvent('window', { predicate: p => !before.has(p) })
  await action()
  const page = await created
  await page.waitForLoadState('domcontentloaded')
  return page
}

const openWindow = (route: string) => newWindowAfter(() => invoke(first, 'app:open-window', route))
const destroy = (page: Page) => app.browserWindow(page).then(w => w.evaluate(bw => { if (!bw.isDestroyed()) bw.destroy() })).catch(() => {})

/** Position du pointeur au lâcher, vue par le main. */
async function setCursor(point: { x: number; y: number }): Promise<void> {
  await app.evaluate(({ screen }, p) => { screen.getCursorScreenPoint = () => p }, point)
}
async function cursorOver(page: Page): Promise<void> {
  const b = await app.browserWindow(page).then(w => w.evaluate(bw => bw.getBounds()))
  await setCursor({ x: b.x + 100, y: b.y + 100 })
}
const cursorOutside = () => setCursor({ x: -30_000, y: -30_000 })

/** Début du glisser de l'onglet `index` : id du glisser (valeur du type MIME). */
async function dragStart(page: Page, index: number): Promise<string> {
  const id = await page.evaluate(([i, mime]) => {
    const el = document.querySelectorAll('[data-testid="tab"]')[i as number]
    const dt = new DataTransfer()
    ;(window as unknown as { __gh343Dt: DataTransfer; __gh343El: Element }).__gh343Dt = dt
    ;(window as unknown as { __gh343El: Element }).__gh343El = el
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    return dt.getData(mime as string)
  }, [index, MIME] as const)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  return id
}

/** Fin du geste côté source : `dropped` = une cible a accepté le dépôt. */
async function dragEnd(page: Page, dropped: boolean): Promise<void> {
  if (page.isClosed()) return
  await page.evaluate(d => {
    const w = window as unknown as { __gh343Dt: DataTransfer; __gh343El: Element }
    w.__gh343Dt.dropEffect = d ? 'move' : 'none'
    const target = w.__gh343El.isConnected ? w.__gh343El : document.querySelector('[data-testid="tab-strip"]')!
    target.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: w.__gh343Dt }))
  }, dropped).catch(() => {})   // fenêtre fermée entre-temps (dernier onglet parti)
}

/** Survol puis dépôt sur la barre d'onglets d'une fenêtre, à l'emplacement `slot` (défaut : fin). */
async function dropOn(page: Page, dragId: string, slot?: number): Promise<boolean> {
  return page.evaluate(async ([id, mime, s]) => {
    const strip = document.querySelector('[data-testid="tab-strip"]') as HTMLElement
    const items = strip.querySelectorAll<HTMLElement>('[data-testid="tab"]')
    const r = (s as number | null) !== null && (s as number) < items.length ? items[s as number].getBoundingClientRect() : strip.getBoundingClientRect()
    const clientX = (s as number | null) !== null && (s as number) < items.length ? r.left + 2 : r.right - 4
    const clientY = r.top + r.height / 2
    const dt = new DataTransfer()
    dt.setData(mime as string, id as string)
    const fire = (type: string) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY })
      strip.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    fire('dragenter')
    await new Promise(res => setTimeout(res, 400))   // réponse du main (acceptation)
    const accepted = fire('dragover')
    fire('drop')
    return accepted
  }, [dragId, MIME, slot ?? null] as const)
}

/** Fenêtre ouverte sur `route`, avec un second onglet (le premier reste actif). */
async function windowWithTwoTabs(route: string): Promise<Page> {
  const page = await openWindow(route)
  await expect(tabs(page)).toHaveCount(1)
  await page.getByTestId('tab').first().click()
  await page.keyboard.press('Control+t')
  await expect(tabs(page)).toHaveCount(2)
  await tabs(page).first().click()
  await expect.poll(() => routePath(page)).toBe(route.split('?')[0])
  return page
}

const fieldValues = (page: Page) => page.$$eval('main input, main textarea', els => els.map(e => (e as HTMLInputElement).value))

test.beforeAll(async () => {
  repo = makeRepo('a')
  repoB = makeRepo('b')
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'ligne 1\n')
  git(repo, 'add', 'notes.txt')
  git(repo, 'commit', '-m', 'notes')
  // Un compte (fictif) : une fenêtre à l'accueil reste sur l'accueil au lieu de /login (T30).
  const profile = newProfile()
  fs.writeFileSync(path.join(profile, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: HOST, username: 'dora', name: 'Dora', email: 'd@x', provider: 'forgejo', baseUrl: `https://${HOST}` }],
    defaultAccount: `${HOST}:dora`,
  }))
  ;({ app, page: first } = await launch(profile))
  await invoke(first, 'auth:save-token', `https://${HOST}`, 'tok-gh343')
  for (const r of [repo, repoB]) expect((await invoke<{ status: string }>(first, 'workspace:open-project', r)).status).toBe('ok')
  projectId = encodeId(repo)
  projectB = encodeId(repoB)
  await invoke(first, 'schema:save', repo, {
    version: 1,
    linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [
        { name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [{ name: 'note', label: 'Note', type: 'text' }], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        { name: 'essai', label: 'Essai', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [{ name: 'lieu', label: 'Lieu', type: 'text' }], statuses: [{ name: 'planned', label: 'Planifiée' }] },
      ],
    }],
  })
  reqId = (await invoke<{ id: string }>(first, 'requirements:create', repo, { title: 'Exigence glissée', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  const steps = [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }]
  testId = (await invoke<{ id: string }>(first, 'tests:create', repo, { title: 'Essai glissé', objectTypeRef: 'root::essai', fields: {}, steps }, repo)).id
  campaignId = (await invoke<{ id: string }>(first, 'campaigns:create', repo, { title: 'Campagne glissée', objectTypeRef: 'root::campagne', testCaseIds: [testId] }, repo)).id
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'données')
})

test.afterAll(async () => {
  const live = app?.windows().find(p => !p.isClosed())
  if (live) await invoke(live, 'auth:delete-token', `https://${HOST}`).catch(() => {})
  await app?.close().catch(() => {})
})

let target: Page

test('GH343 T25 — onglet avec historique déposé dans une autre fenêtre : présent, actif, Précédent ; parti de l’origine', async () => {
  target = await openWindow(productRoute())
  await expect(tabs(target)).toHaveCount(1)
  const source = await windowWithTwoTabs(reqRoute())
  await expect(tabs(source).first()).toContainText('Exigence glissée')
  // Historique : exigence → modèle de données (barre d'activité « Projet ») → préférences.
  await source.locator('button[title="Projet"]').first().click()
  await expect.poll(() => routePath(source)).toBe('/schema')
  await source.getByRole('link', { name: 'Préférences' }).click()
  await expect.poll(() => routePath(source)).toBe('/preferences')

  const id = await dragStart(source, 0)
  expect(await dropOn(target, id, 0)).toBe(true)
  await dragEnd(source, true)

  await expect(tabs(target)).toHaveCount(2)
  await expect.poll(() => routePath(target)).toBe('/preferences')
  await expect(tabs(source)).toHaveCount(1)
  await expect.poll(() => routePath(source)).not.toBe('/preferences')
  // Précédent : la page d'avant dans l'historique de l'onglet, dans la fenêtre d'arrivée.
  await target.getByTitle(/^Précédent/).click()
  await expect.poll(() => routePath(target)).toBe('/schema')
  await target.getByTitle(/^Précédent/).click()
  await expect.poll(() => routePath(target)).toBe(`/req/${reqId}`)
  await destroy(source)
})

test('GH343 T26 — exigence modifiée non enregistrée : saisie et point « modifié » transférés ; Enregistrer écrit', async () => {
  const source = await windowWithTwoTabs(reqRoute())
  const title = source.locator('main input.input-field[type="text"]:not([readonly])').first()
  await expect(title).toHaveValue('Exigence glissée')
  await title.fill('Exigence glissée — saisie transférée')
  await expect(dirtyDot(source)).toBeVisible()

  const id = await dragStart(source, 0)
  expect(await dropOn(target, id)).toBe(true)
  await dragEnd(source, true)

  await expect.poll(() => routePath(target)).toBe(`/req/${reqId}`)
  const arrived = target.locator('main input.input-field[type="text"]:not([readonly])').first()
  await expect(arrived).toHaveValue('Exigence glissée — saisie transférée')
  await expect(dirtyDot(target, (await tabs(target).count()) - 1)).toBeVisible()
  await expect(tabs(source)).toHaveCount(1)
  // Non enregistrée pendant le transfert ; « Sauvegarder » dans la fenêtre d'arrivée l'écrit.
  expect(fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8')).not.toContain('saisie transférée')
  await target.getByRole('button', { name: 'Sauvegarder' }).click()
  await expect.poll(() => fs.readFileSync(path.join(repo, 'requirements', `${reqId}.yaml`), 'utf8')).toContain('saisie transférée')
  await destroy(source)
})

test('GH343 T27 — saisie transférée : test, Schéma, campagne, diff', async () => {
  // Test : titre.
  {
    const source = await windowWithTwoTabs(testRoute())
    const title = source.locator('main input.input-field[type="text"]:not([readonly])').first()
    await expect(title).toHaveValue('Essai glissé')
    await title.fill('Essai glissé — modifié')
    await expect(dirtyDot(source)).toBeVisible()
    const id = await dragStart(source, 0)
    expect(await dropOn(target, id)).toBe(true)
    await dragEnd(source, true)
    await expect.poll(() => routePath(target)).toBe(`/test/${testId}`)
    await expect(target.locator('main input.input-field[type="text"]:not([readonly])').first()).toHaveValue('Essai glissé — modifié')
    await destroy(source)
  }
  // Campagne : édition des champs.
  {
    const source = await windowWithTwoTabs(campaignRoute())
    await source.getByRole('button', { name: 'Modifier les champs' }).click()
    const lieu = source.locator('main input[type="text"]').last()
    await lieu.fill('Atelier 3')
    await expect(dirtyDot(source)).toBeVisible()
    const id = await dragStart(source, 0)
    expect(await dropOn(target, id)).toBe(true)
    await dragEnd(source, true)
    await expect.poll(() => routePath(target)).toBe(`/campaign/${campaignId}`)
    await expect.poll(() => fieldValues(target)).toContain('Atelier 3')
    await destroy(source)
  }
  // Schéma : type de lien ajouté, non enregistré.
  {
    const source = await windowWithTwoTabs(schemaRoute())
    await source.getByRole('button', { name: 'Liens', exact: true }).click()
    await source.getByRole('button', { name: '+ Ajouter un type de lien' }).click()
    await expect(dirtyDot(source)).toBeVisible()
    const id = await dragStart(source, 0)
    expect(await dropOn(target, id)).toBe(true)
    await dragEnd(source, true)
    await expect.poll(() => routePath(target)).toBe('/schema')
    const last = (await tabs(target).count()) - 1
    await expect(dirtyDot(target, last)).toBeVisible()
    await destroy(source)
  }
  // Diff : texte modifié dans l'éditeur (modification locale).
  {
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'ligne 1\nligne 2\n')
    const source = await windowWithTwoTabs(diffRoute())
    const editor = source.locator('.cm-content[contenteditable="true"]').last()
    await expect(editor).toBeVisible({ timeout: 20_000 })
    await editor.click()
    await source.keyboard.press('Control+End')
    await source.keyboard.type('ligne glissée')
    await expect(dirtyDot(source)).toBeVisible()
    const id = await dragStart(source, 0)
    expect(await dropOn(target, id)).toBe(true)
    await dragEnd(source, true)
    await expect.poll(() => routePath(target)).toBe('/diff')
    await expect(target.locator('.cm-content[contenteditable="true"]').last()).toContainText('ligne glissée', { timeout: 20_000 })
    await expect(dirtyDot(target, (await tabs(target).count()) - 1)).toBeVisible()
    await destroy(source)
  }
})

test('GH343 T28 — dernier onglet d’une fenêtre déposé ailleurs : la fenêtre d’origine se ferme', async () => {
  const source = await openWindow(reqRoute())
  await expect(tabs(source)).toHaveCount(1)
  const closed = source.waitForEvent('close')
  const before = await tabs(target).count()
  const id = await dragStart(source, 0)
  expect(await dropOn(target, id)).toBe(true)
  await dragEnd(source, true)
  await closed
  await expect(tabs(target)).toHaveCount(before + 1)
})

test('GH343 T29 — fenêtre d’un autre projet : dépôt refusé, l’onglet reste', async () => {
  const other = await openWindow(productRoute(projectB))
  await expect.poll(() => new URL(other.url()).searchParams.get('projectId')).toBe(projectB)
  const source = await windowWithTwoTabs(reqRoute())
  const id = await dragStart(source, 0)
  expect(await dropOn(other, id)).toBe(false)
  await cursorOver(other)
  await dragEnd(source, false)
  await source.waitForTimeout(1_000)
  expect(await invoke(other, 'app:tab-drag-take', id)).toBeNull()
  await expect(tabs(source)).toHaveCount(2)
  await expect(tabs(other)).toHaveCount(1)
  await destroy(other)
  await destroy(source)
})

test('GH343 T30 — fenêtre à l’accueil : dépôt accepté, elle ouvre le projet de l’onglet', async () => {
  const home = await openWindow('/')
  await expect.poll(() => routePath(home)).toBe('/')
  await expect(home.getByTestId('tab-strip')).toBeVisible()
  const source = await windowWithTwoTabs(reqRoute())
  const id = await dragStart(source, 0)
  expect(await dropOn(home, id)).toBe(true)
  await dragEnd(source, true)
  await expect.poll(() => routePath(home)).toBe(`/req/${reqId}`)
  await expect(tabs(home)).toHaveCount(1)
  await home.waitForTimeout(1_500)   // pas de remise à zéro des onglets au changement de projet
  await expect(tabs(home)).toHaveCount(1)
  expect(routePath(home)).toBe(`/req/${reqId}`)
  await destroy(home)
  await destroy(source)
})

test('GH343 T31 — lâché hors des fenêtres : nouvelle fenêtre avec l’onglet, son historique et sa saisie', async () => {
  const source = await windowWithTwoTabs(reqRoute())
  await source.locator('button[title="Projet"]').first().click()
  await expect.poll(() => routePath(source)).toBe('/schema')
  await tabs(source).first().click()   // reste sur /schema (onglet actif)
  await source.getByTitle(/^Précédent/).click()
  await expect.poll(() => routePath(source)).toBe(`/req/${reqId}`)
  const title = source.locator('main input.input-field[type="text"]:not([readonly])').first()
  await title.fill('Saisie dans une nouvelle fenêtre')

  await cursorOutside()
  const id = await dragStart(source, 0)
  const created = await newWindowAfter(() => dragEnd(source, false))
  await expect.poll(() => routePath(created), { timeout: 15_000 }).toBe(`/req/${reqId}`)
  await expect(tabs(created)).toHaveCount(1)
  await expect(created.locator('main input.input-field[type="text"]:not([readonly])').first()).toHaveValue('Saisie dans une nouvelle fenêtre')
  await expect(dirtyDot(created)).toBeVisible()
  await expect(tabs(source)).toHaveCount(1)
  // Suivant : la page d'après (le modèle de données) est dans l'historique reçu (pas de clic : la page
  // est modifiée, la navigation demanderait confirmation).
  await expect(created.getByTitle(/^Suivant/)).toBeEnabled()
  await expect(created.getByTitle(/^Précédent/)).toBeDisabled()   // première entrée de l'historique
  expect(id).toBeTruthy()
  await destroy(created)
  await destroy(source)
})

test('GH343 T32 — dernier onglet lâché hors des fenêtres : rien', async () => {
  const source = await openWindow(reqRoute())
  await expect(tabs(source)).toHaveCount(1)
  await cursorOutside()
  const count = app.windows().length
  await dragStart(source, 0)
  await dragEnd(source, false)
  await source.waitForTimeout(2_000)
  expect(app.windows().length).toBe(count)
  await expect(tabs(source)).toHaveCount(1)
  await destroy(source)
})
