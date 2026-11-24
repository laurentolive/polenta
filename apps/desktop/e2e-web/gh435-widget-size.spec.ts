import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect, type Locator } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH435 — dimensions réglables des widgets, mise en page en flux (specs/GH435-tests.md E1 à E3, E8 à E12).
 * Souris réelle : poignées du bord droit et du bas, échantillonnage de chaque frame du glissement.
 */
const s = setupSession()

interface Widget { id: string; title: string; size: string; width?: number; height?: number }
interface Dashboard { id: string; widgets: Widget[]; widgetOrder: string[] }
interface WidgetDef { title: string; size?: 'sm' | 'md' | 'lg'; width?: number; height?: number }

let username: string
let queryId: string

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
/** Assez large pour que la zone du dashboard mesure sa largeur de référence (1104 px). */
const WIDE = { width: 1800, height: 1000 }

test.beforeAll(async () => {
  const { localPath } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const q = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH435 lignes', scope: 'shared', createdBy: username,
    script: "export default () => [{ lettre: 'a', n: 2 }, { lettre: 'b', n: 5 }]\n",
  })
  queryId = q.id
})

test.afterEach(async () => {
  await s.page.unrouteAll({ behavior: 'ignoreErrors' })
  await s.page.setViewportSize(DEFAULT_VIEWPORT)
})

async function makeDashboard(title: string, widgets: WidgetDef[], scope: 'shared' | 'private' = 'shared'): Promise<string> {
  const { localPath } = s.project
  const d = await s.invoke<Dashboard>('dashboards:create', localPath, username, { title, scope, createdBy: username })
  for (const w of widgets) {
    await s.invoke('dashboards:add-widget', localPath, username, d.id, {
      title: w.title, queryId, size: w.size ?? 'md',
      ...(w.width !== undefined ? { width: w.width } : {}),
      ...(w.height !== undefined ? { height: w.height } : {}),
      template: { id: 'kpi', params: { measure: 'sum', measureColumn: 'n' } },
    })
  }
  return d.id
}

async function navigate(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}
const openDashboard = (id: string) => navigate(s.projectUrl('/dashboard', { dashboardId: id }))

const card = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })
const slotOf = (title: string) => card(title).locator('xpath=ancestor::*[@data-testid="widget-slot"]')
const grid = () => s.page.getByTestId('dashboard-grid')
/** Widget enregistré ; vide pendant une écriture en cours (écriture sans fichier temporaire : lu entre la
 *  troncature et l'écriture, le dashboard est vu absent). */
const saved = async (dashboardId: string, title: string): Promise<Widget> => {
  const d = await s.invoke<Dashboard | null>('dashboards:get', s.project.localPath, username, dashboardId)
  return d?.widgets.find(w => w.title === title) ?? ({} as Widget)
}
const sharedYaml = (dashboardId: string) =>
  yaml.load(fs.readFileSync(path.join(s.project.localPath, 'dashboards', dashboardId, 'dashboard.yaml'), 'utf8')) as { widgets: Array<Record<string, unknown>> }
const width = async (loc: Locator) => Math.round((await loc.boundingBox())!.width)
const height = async (loc: Locator) => Math.round((await loc.boundingBox())!.height)

/** Saisit une poignée et la déplace de (dx, dy) en `steps` mouvements, comme un utilisateur. */
async function dragHandle(handle: Locator, dx: number, dy: number, steps = 15) {
  await handle.scrollIntoViewIfNeeded()
  const b = (await handle.boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await s.page.mouse.move(x, y)
  // Le survol d'une poignée retire le glisser-déposer de la carte avant que le bouton ne soit pressé.
  await s.page.waitForTimeout(80)
  await s.page.mouse.down()
  await s.page.mouse.move(x + dx, y + dy, { steps })
  await s.page.mouse.up()
}

/** Largeur et hauteur de l'emplacement d'un widget à chaque frame, jusqu'à `sampleStop`. */
async function sampleStart(title: string) {
  await s.page.evaluate(t => {
    const cardEl = [...document.querySelectorAll('[data-testid=widget-card]')].find(c => (c.textContent ?? '').includes(t))
    const slot = cardEl!.closest('[data-testid=widget-slot]') as HTMLElement
    const w = window as unknown as { __samples: Array<{ w: number; h: number }>; __sampling: boolean }
    w.__samples = []
    w.__sampling = true
    const tick = () => {
      const r = slot.getBoundingClientRect()
      w.__samples.push({ w: r.width, h: r.height })
      if (w.__sampling) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, title)
}
async function sampleStop(): Promise<Array<{ w: number; h: number }>> {
  return s.page.evaluate(() => {
    const w = window as unknown as { __samples: Array<{ w: number; h: number }>; __sampling: boolean }
    w.__sampling = false
    return w.__samples
  })
}

test('E1 — largeur : le glissement suit le pointeur, l\'enregistrement a lieu au relâchement, la taille survit au rechargement', async () => {
  const id = await makeDashboard('GH435 E1', [{ title: 'Mobile' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const slot = slotOf('Mobile')
  await expect.poll(() => width(slot)).toBe(544)
  await expect(slot.getByTestId('widget-resize-w')).toBeVisible()

  await sampleStart('Mobile')
  await dragHandle(slot.getByTestId('widget-resize-w'), 156, 0)
  const samples = await sampleStop()
  expect(samples.length).toBeGreaterThan(3)
  for (const smp of samples) {
    expect(smp.w).toBeGreaterThanOrEqual(240)
    expect(smp.w).toBeLessThanOrEqual(1104)
  }
  // Le glissement avance toujours dans le même sens, sans retour vers l'ancienne taille.
  for (let i = 1; i < samples.length; i++) expect(samples[i].w).toBeGreaterThanOrEqual(samples[i - 1].w - 1)

  await expect.poll(async () => (await saved(id, 'Mobile')).width).toBe(700)
  expect(sharedYaml(id).widgets[0]).toMatchObject({ width: 700 })
  expect('height' in sharedYaml(id).widgets[0]).toBe(false)
  expect(Math.abs(await width(slot) - 700)).toBeLessThanOrEqual(1)

  await s.page.reload()
  await openDashboard(id)
  await expect.poll(async () => Math.abs(await width(slotOf('Mobile')) - 700)).toBeLessThanOrEqual(1)
})

test('E1b — hauteur, dashboard privé : valeur écrite dans le .pref, carte à la taille demandée', async () => {
  const id = await makeDashboard('GH435 E1b', [{ title: 'Haute' }], 'private')
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const slot = slotOf('Haute')
  await expect.poll(() => height(card('Haute'))).toBe(256)

  await dragHandle(slot.getByTestId('widget-resize-h'), 0, 144)
  await expect.poll(async () => (await saved(id, 'Haute')).height).toBe(400)
  const pref = JSON.parse(fs.readFileSync(path.join(s.project.localPath, `.${username}.pref`), 'utf8')) as { dashboards: Array<{ id: string; widgets: Array<{ height?: number; width?: number }> }> }
  const privateWidget = pref.dashboards.find(d => d.id === id)!.widgets[0]
  expect(privateWidget.height).toBe(400)
  expect(privateWidget.width).toBeUndefined()
  expect(Math.abs(await height(card('Haute')) - 400)).toBeLessThanOrEqual(1)
})

test('E2 — bornes : jamais hors 240 à 1104 en largeur ni 160 à 720 en hauteur, à aucune frame', async () => {
  const id = await makeDashboard('GH435 E2', [{ title: 'Bornée', width: 700, height: 320 }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const slot = slotOf('Bornée')
  await expect.poll(() => width(slot)).toBe(700)

  const all: Array<{ w: number; h: number }> = []
  const drag = async (axis: 'w' | 'h', delta: number, expected: { width?: number; height?: number }) => {
    await sampleStart('Bornée')
    await dragHandle(slot.getByTestId(`widget-resize-${axis}`), axis === 'w' ? delta : 0, axis === 'h' ? delta : 0)
    all.push(...await sampleStop())
    await expect.poll(async () => {
      const w = await saved(id, 'Bornée')
      return { width: w.width, height: w.height }
    }).toMatchObject(expected)
    await expect.poll(async () => Math.round((await slot.boundingBox())!.width)).toBe(expected.width ?? 700)
  }
  await drag('w', 3000, { width: 1104 })
  await drag('w', -3000, { width: 240 })
  await drag('h', 3000, { width: 240, height: 720 })
  await drag('h', -3000, { width: 240, height: 160 })

  for (const smp of all) {
    expect(smp.w).toBeGreaterThanOrEqual(240)
    expect(smp.w).toBeLessThanOrEqual(1104)
    expect(smp.h).toBeGreaterThanOrEqual(160)
    expect(smp.h).toBeLessThanOrEqual(720)
  }
  expect(sharedYaml(id).widgets[0]).toMatchObject({ width: 240, height: 160 })
})

test('E2b — fichier modifié à la main ou valeur hors bornes envoyée : ramenée aux bornes, sans erreur', async () => {
  const id = await makeDashboard('GH435 E2b', [{ title: 'Excessive' }, { title: 'Envoyée' }])
  const file = path.join(s.project.localPath, 'dashboards', id, 'dashboard.yaml')
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) as { widgets: Array<Record<string, unknown>> }
  doc.widgets[0].width = 5000
  doc.widgets[0].height = 10
  fs.writeFileSync(file, yaml.dump(doc))

  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect.poll(() => width(slotOf('Excessive'))).toBe(1104)
  await expect.poll(() => height(card('Excessive'))).toBe(160)

  const sent = await saved(id, 'Envoyée')
  await s.invoke('dashboards:update-widget', s.project.localPath, username, id, sent.id, { width: 99999, height: 1 })
  expect(sharedYaml(id).widgets[1]).toMatchObject({ width: 1104, height: 160 })
})

test('E3 — flux : côte à côte quand la zone le permet, à la ligne sinon, pleine largeur sous 640 px, sans défilement horizontal', async () => {
  const id = await makeDashboard('GH435 E3', [{ title: 'Premier' }, { title: 'Second' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect.poll(async () => width(grid())).toBe(1104)

  for (const vw of [1800, 1300, 1100, 900, 700, 560]) {
    await s.page.setViewportSize({ width: vw, height: 1000 })
    // La zone suit la fenêtre : attendre qu'elle ait cessé de bouger.
    let g = -1
    await expect.poll(async () => { const now = await width(grid()); const stable = now === g; g = now; return stable }).toBe(true)
    const a = (await slotOf('Premier').boundingBox())!
    const b = (await slotOf('Second').boundingBox())!
    if (g < 640) {
      expect(Math.round(a.width), `zone ${g}`).toBe(g)
      expect(Math.round(b.width), `zone ${g}`).toBe(g)
      expect(b.y).toBeGreaterThan(a.y)
    } else {
      expect(Math.round(a.width), `zone ${g}`).toBe(Math.min(544, g))
      if (g >= 1104) {
        expect(Math.abs(b.y - a.y), `zone ${g} : côte à côte`).toBeLessThan(2)
        expect(b.x).toBeGreaterThan(a.x)
      } else {
        expect(b.y, `zone ${g} : à la ligne`).toBeGreaterThan(a.y + 100)
      }
    }
    const overflow = await grid().evaluate(el => {
      let p = el.parentElement
      while (p && getComputedStyle(p).overflowY !== 'auto') p = p.parentElement
      return p ? p.scrollWidth - p.clientWidth : 0
    })
    expect(overflow, `zone ${g} : défilement horizontal`).toBeLessThanOrEqual(0)
  }
})

test('E8 — dashboard d\'un format plus récent : aucune poignée, fichier jamais réécrit', async () => {
  const dir = path.join(s.project.localPath, 'dashboards', 'DASHBOARD-9435')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'dashboard.yaml'), yaml.dump({
    id: 'DASHBOARD-9435', title: 'GH435 format futur', formatVersion: 2, widgetOrder: ['w1'], createdBy: 'e2e', createdAt: '2026-01-01T00:00:00Z',
    widgets: [{ id: 'w1', title: 'Futur', queryId, size: 'md', width: 700 }],
  }))
  fs.writeFileSync(path.join(dir, 'w1.vl.json'), '{ "data": { "name": "rows" }, "mark": "bar" }')
  const before = fs.readFileSync(path.join(dir, 'dashboard.yaml'), 'utf8')

  await s.page.setViewportSize(WIDE)
  await openDashboard('DASHBOARD-9435')
  await expect(card('Futur')).toBeVisible()
  await expect(s.page.getByTestId('dashboard-readonly')).toBeVisible()
  await expect(s.page.getByTestId('widget-resize-w')).toHaveCount(0)
  await expect(s.page.getByTestId('widget-resize-h')).toHaveCount(0)
  expect(fs.readFileSync(path.join(dir, 'dashboard.yaml'), 'utf8')).toBe(before)
})

test('E9 — réordonner par l\'en-tête fonctionne comme avant ; saisir une poignée redimensionne sans déplacer la carte', async () => {
  const id = await makeDashboard('GH435 E9', [{ title: 'Un' }, { title: 'Deux' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect.poll(async () => (await slotOf('Deux').boundingBox())!.x).toBeGreaterThan((await slotOf('Un').boundingBox())!.x)

  const current = () => s.invoke<Dashboard>('dashboards:get', s.project.localPath, username, id)
  const idUn = (await saved(id, 'Un')).id
  const idDeux = (await saved(id, 'Deux')).id
  await card('Deux').getByText('Deux', { exact: true }).dragTo(card('Un'), { targetPosition: { x: 10, y: 60 } })
  await expect.poll(async () => (await current()).widgetOrder).toEqual([idDeux, idUn])
  const orderAfterReorder = (await current()).widgetOrder

  // Poignée : la carte se redimensionne, l'ordre ne change pas et la carte n'est pas déposée ailleurs.
  const handle = slotOf('Un').getByTestId('widget-resize-w')
  await dragHandle(handle, 60, 0)
  await expect.poll(async () => (await saved(id, 'Un')).width).toBe(604)
  expect((await current()).widgetOrder).toEqual(orderAfterReorder)
})

test('E10 — dashboard d\'avant GH435 : largeurs 264 / 544 / 1104, hauteur 256 ; les dimensions suivent le changement de portée', async () => {
  const id = await makeDashboard('GH435 E10', [{ title: 'Petit', size: 'sm' }, { title: 'Moyen', size: 'md' }, { title: 'Grand', size: 'lg' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect.poll(() => width(slotOf('Petit'))).toBe(264)
  expect(await width(slotOf('Moyen'))).toBe(544)
  expect(await width(slotOf('Grand'))).toBe(1104)
  for (const t of ['Petit', 'Moyen', 'Grand']) expect(await height(card(t))).toBe(256)
  expect(JSON.stringify(sharedYaml(id))).not.toMatch(/width|height/)

  const moyen = await saved(id, 'Moyen')
  await s.invoke('dashboards:update-widget', s.project.localPath, username, id, moyen.id, { width: 700, height: 320 })
  const toPrivate = await s.invoke<Dashboard>('dashboards:set-scope', s.project.localPath, username, id, 'private')
  expect(toPrivate.widgets.find(w => w.title === 'Moyen')).toMatchObject({ width: 700, height: 320 })
  const backShared = await s.invoke<Dashboard>('dashboards:set-scope', s.project.localPath, username, toPrivate.id, 'shared')
  expect(backShared.widgets.find(w => w.title === 'Moyen')).toMatchObject({ width: 700, height: 320 })
  expect(backShared.widgets.find(w => w.title === 'Petit')).not.toHaveProperty('width')
})

test('E11 — modale : un autre préréglage remet les dimensions au défaut, enregistrer sans y toucher les conserve', async () => {
  const id = await makeDashboard('GH435 E11', [{ title: 'Garde', width: 700, height: 320 }, { title: 'Remet', width: 700, height: 320 }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const dialog = () => s.page.getByRole('dialog')

  // Sans toucher au préréglage : dimensions conservées, rappelées dans la modale.
  await card('Garde').getByTitle('Modifier le widget').click()
  await expect(dialog().getByTestId('widget-size-custom')).toContainText('700 × 320 px')
  await dialog().getByRole('button', { name: 'Sauvegarder' }).click()
  await expect(dialog()).toHaveCount(0)
  expect(await saved(id, 'Garde')).toMatchObject({ size: 'md', width: 700, height: 320 })

  // Autre préréglage : dimensions retirées.
  await card('Remet').getByTitle('Modifier le widget').click()
  await dialog().getByLabel('Large', { exact: true }).check()
  await dialog().getByRole('button', { name: 'Sauvegarder' }).click()
  await expect(dialog()).toHaveCount(0)
  const remet = await saved(id, 'Remet')
  expect(remet.size).toBe('lg')
  expect(remet).not.toHaveProperty('width')
  expect(remet).not.toHaveProperty('height')
  await expect.poll(() => width(slotOf('Remet'))).toBe(1104)
  expect(await height(card('Remet'))).toBe(256)
})

test('E12 — écriture refusée : la carte revient à sa taille enregistrée et l\'erreur est affichée', async () => {
  s.allowConsoleErrors(/status of 500/, /écriture refusée/)
  const id = await makeDashboard('GH435 E12', [{ title: 'Refusée' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const slot = slotOf('Refusée')
  await expect.poll(() => width(slot)).toBe(544)
  const before = fs.readFileSync(path.join(s.project.localPath, 'dashboards', id, 'dashboard.yaml'), 'utf8')

  await s.page.route(/\/rpc\/dashboards(%3A|:)update-widget/, route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: 'écriture refusée (test)' } }),
  }))
  await dragHandle(slot.getByTestId('widget-resize-w'), 200, 0)
  await expect(s.page.getByTestId('widget-size-error')).toContainText('écriture refusée')
  await expect.poll(() => width(slot)).toBe(544)
  expect(fs.readFileSync(path.join(s.project.localPath, 'dashboards', id, 'dashboard.yaml'), 'utf8')).toBe(before)
})

test('E5b (partie 1) — double-clic sur une poignée : la dimension revient au défaut et sa clé disparaît du fichier', async () => {
  const id = await makeDashboard('GH435 E13', [{ title: 'Remise', width: 700, height: 320 }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const slot = slotOf('Remise')
  await expect.poll(() => width(slot)).toBe(700)

  await slot.getByTestId('widget-resize-w').dblclick()
  await expect.poll(() => width(slot)).toBe(544)
  expect('width' in sharedYaml(id).widgets[0]).toBe(false)
  expect(sharedYaml(id).widgets[0]).toMatchObject({ height: 320 })

  await slot.getByTestId('widget-resize-h').dblclick()
  await expect.poll(() => height(card('Remise'))).toBe(256)
  expect(Object.keys(sharedYaml(id).widgets[0])).toEqual(['id', 'title', 'queryId', 'size', 'template'])
})
