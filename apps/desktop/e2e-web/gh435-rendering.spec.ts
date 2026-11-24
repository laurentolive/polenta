import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Locator } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'

/**
 * GH435 — rendu adapté à la carte : légendes sans troncature, graphique qui suit la taille de son corps,
 * message « trop petit », tableaux ajustés à leur contenu (specs/GH435-tests.md E4 à E7).
 */
const s = setupSession()

interface Widget { id: string; title: string; size: string; width?: number; height?: number }
interface Dashboard { id: string; widgets: Widget[] }
interface WidgetDef { title: string; query: string; template: { id: string; params: Record<string, unknown> }; size?: 'sm' | 'md' | 'lg'; width?: number; height?: number }

const WIDE = { width: 1800, height: 1000 }
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

let username: string
const queries: Record<string, string> = {}

/** 34 caractères exactement : « Série 1 libellé de trente-quatre » complété par des points. */
const SERIES_SCRIPT = `export default () => Array.from({ length: 9 }, (_, i) => ({
  categorie: 'Lot ' + (i % 3),
  serie: ('Série ' + (i + 1) + ' libellé de trente-quatre').padEnd(34, '.'),
  n: i + 1,
}))\n`
const rowsScript = (n: number) => `export default () => Array.from({ length: ${n} }, (_, i) => ({ id: 'L' + String(i + 1).padStart(3, '0'), valeur: i + 1 }))\n`

test.beforeAll(async () => {
  const { localPath } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const create = async (key: string, script: string) => {
    queries[key] = (await s.invoke<{ id: string }>('queries:create', localPath, username, { title: `GH435 ${key}`, scope: 'shared', createdBy: username, script })).id
  }
  await create('series', SERIES_SCRIPT)
  await create('rows3', rowsScript(3))
  await create('rows8', rowsScript(8))
  await create('rows100', rowsScript(100))
})

test.afterEach(async () => {
  await s.page.unrouteAll({ behavior: 'ignoreErrors' })
  await s.page.emulateMedia({ media: null })
  await s.page.setViewportSize(DEFAULT_VIEWPORT)
  // Après la route d'impression (E13), retour sur l'application pour les tests suivants.
  if (new URL(s.page.url()).pathname.startsWith('/print/')) await s.page.goto(s.projectUrl('/dashboard'))
})

const BAR = { id: 'bar', params: { category: 'categorie', series: 'serie', measure: 'sum', measureColumn: 'n' } }
const TABLE = { id: 'table', params: { columns: ['id', 'valeur'] } }

async function makeDashboard(title: string, widgets: WidgetDef[]): Promise<string> {
  const { localPath } = s.project
  const d = await s.invoke<Dashboard>('dashboards:create', localPath, username, { title, scope: 'shared', createdBy: username })
  for (const w of widgets) {
    await s.invoke('dashboards:add-widget', localPath, username, d.id, {
      title: w.title, queryId: queries[w.query], size: w.size ?? 'md', template: w.template,
      ...(w.width !== undefined ? { width: w.width } : {}),
      ...(w.height !== undefined ? { height: w.height } : {}),
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
/** Widget enregistré ; vide pendant une écriture en cours (le service écrit sans fichier temporaire : un dashboard lu
 *  entre la troncature et l'écriture du fichier est vu absent). */
const saved = async (dashboardId: string, title: string): Promise<Widget> => {
  const d = await s.invoke<Dashboard | null>('dashboards:get', s.project.localPath, username, dashboardId)
  return d?.widgets.find(w => w.title === title) ?? ({} as Widget)
}
const rect = async (loc: Locator) => (await loc.boundingBox())!
const width = async (loc: Locator) => Math.round((await rect(loc)).width)
const height = async (loc: Locator) => Math.round((await rect(loc)).height)

async function dragHandle(handle: Locator, dx: number, dy: number, steps = 15) {
  await handle.scrollIntoViewIfNeeded()
  const b = (await handle.boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await s.page.mouse.move(x, y)
  await s.page.waitForTimeout(80)
  await s.page.mouse.down()
  await s.page.mouse.move(x + dx, y + dy, { steps })
  await s.page.mouse.up()
}

/** Éléments texte du graphique de la carte dont la boîte sort du corps de la carte (px de tolérance : 1). */
const textsOutsideBody = (title: string) => card(title).evaluate(el => {
  const body = el.querySelector('[data-testid=widget-body]')!.getBoundingClientRect()
  return [...el.querySelectorAll('svg text')].filter(t => {
    const r = t.getBoundingClientRect()
    return r.width > 0 && (r.left < body.left - 1 || r.right > body.right + 1 || r.top < body.top - 1 || r.bottom > body.bottom + 1)
  }).map(t => t.textContent)
})
/** Écart (px) entre la taille du SVG du graphique et celle de son conteneur de mesure. */
const svgGap = (title: string) => card(title).evaluate(el => {
  const host = el.querySelector('[data-testid=vega-view]')!.getBoundingClientRect()
  const svg = el.querySelector('[data-testid=vega-view] svg')!.getBoundingClientRect()
  return Math.max(Math.abs(host.width - svg.width), Math.abs(host.height - svg.height))
})
const legendLabels = (title: string) => card(title).locator('.role-legend-label text').allTextContents()

test('E4 — 9 séries de 34 caractères, tailles md et lg : tous les libellés entiers, rien ne sort de la carte, le SVG remplit le corps', async () => {
  const id = await makeDashboard('GH435 E4', [
    { title: 'Légende md', query: 'series', template: BAR, size: 'md' },
    { title: 'Légende lg', query: 'series', template: BAR, size: 'lg' },
  ])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  for (const title of ['Légende md', 'Légende lg']) {
    await expect(card(title).locator('[data-testid=vega-view] svg'), title).toBeVisible()
    await expect.poll(async () => (await legendLabels(title)).length, { message: title }).toBe(9)
    const labels = await legendLabels(title)
    for (const label of labels) {
      expect(label, `${title} : libellé tronqué`).not.toContain('…')
      expect(label.length, `${title} : libellé entier`).toBe(34)
    }
    expect(await textsOutsideBody(title), `${title} : texte hors de la carte`).toEqual([])
    expect(await svgGap(title), `${title} : le SVG remplit son conteneur`).toBeLessThanOrEqual(2)
  }
  await s.shot('gh435-e4-legendes')
})

test('E4b — même graphique en sm : libellés entiers, ou message « trop petit » — jamais de texte tronqué en silence', async () => {
  const id = await makeDashboard('GH435 E4b', [{ title: 'Légende sm', query: 'series', template: BAR, size: 'sm' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const tooSmall = card('Légende sm').getByTestId('widget-too-small')
  const svg = card('Légende sm').locator('[data-testid=vega-view] svg')
  await expect.poll(async () => (await tooSmall.count()) + (await svg.count())).toBeGreaterThan(0)
  if (await tooSmall.count() === 0) {
    for (const label of await legendLabels('Légende sm')) expect(label).not.toContain('…')
    expect(await textsOutsideBody('Légende sm')).toEqual([])
  } else {
    await expect(svg).toHaveCount(0)
  }
})

test('E5 — tableaux : 8 lignes en entier sans défilement, 100 lignes plafonnées à 720 puis défilement, hauteur enregistrée respectée', async () => {
  const id = await makeDashboard('GH435 E5', [
    { title: 'Huit lignes', query: 'rows8', template: TABLE, size: 'lg' },
    { title: 'Cent lignes', query: 'rows100', template: TABLE, size: 'lg' },
    { title: 'Hauteur fixe', query: 'rows8', template: TABLE, size: 'lg', height: 200 },
  ])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const scroller = (title: string) => card(title).locator('[data-excel-grid]')
  const overflows = (title: string) => scroller(title).evaluate(el => el.scrollHeight - el.clientHeight)

  await expect(card('Huit lignes').locator('tbody tr')).toHaveCount(8)
  const eight = await height(card('Huit lignes'))
  expect(eight).toBeGreaterThan(160)
  expect(eight).toBeLessThan(720)
  expect(await overflows('Huit lignes')).toBeLessThanOrEqual(1)
  // Toutes les lignes sont visibles dans la carte.
  const lastRow = await rect(card('Huit lignes').locator('tbody tr').last())
  const bodyRect = await rect(card('Huit lignes'))
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(bodyRect.y + bodyRect.height + 1)

  await expect.poll(() => height(card('Cent lignes'))).toBe(720)
  expect(await overflows('Cent lignes')).toBeGreaterThan(50)

  // Hauteur enregistrée (200 px, plus basse que les 8 lignes) : respectée, le tableau défile dans la carte.
  await expect.poll(() => height(card('Hauteur fixe'))).toBe(200)
  expect(await overflows('Hauteur fixe')).toBeGreaterThan(0)
})

test('E5c — le nombre de lignes qui change ajuste la hauteur, jamais sous 160 px', async () => {
  const id = await makeDashboard('GH435 E5c', [{ title: 'Variable', query: 'rows8', template: TABLE, size: 'lg' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect(card('Variable').locator('tbody tr')).toHaveCount(8)
  const before = await height(card('Variable'))

  await s.invoke('queries:update', s.project.localPath, username, queries['rows8'], { script: rowsScript(2) })
  await s.page.reload()
  await openDashboard(id)
  await expect(card('Variable').locator('tbody tr')).toHaveCount(2)
  expect(await height(card('Variable'))).toBe(160)
  expect(before).toBeGreaterThan(160)
  await s.invoke('queries:update', s.project.localPath, username, queries['rows8'], { script: rowsScript(8) })
})

test('E5b (partie 2) — tableau automatique : tirer la poignée du bas enregistre la hauteur, le double-clic revient à l\'ajustement', async () => {
  const id = await makeDashboard('GH435 E5b', [{ title: 'Auto', query: 'rows8', template: TABLE, size: 'lg' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect(card('Auto').locator('tbody tr')).toHaveCount(8)
  const start = await height(card('Auto'))

  await dragHandle(slotOf('Auto').getByTestId('widget-resize-h'), 0, 60)
  await expect.poll(async () => (await saved(id, 'Auto')).height).toBe(start + 60)
  expect(Math.abs(await height(card('Auto')) - (start + 60))).toBeLessThanOrEqual(1)

  await slotOf('Auto').getByTestId('widget-resize-h').dblclick()
  await expect.poll(async () => (await saved(id, 'Auto')).height).toBeUndefined()
  await expect.poll(() => height(card('Auto'))).toBe(start)
})

test('E6 — le graphique suit sa carte : fenêtre réduite, puis carte redimensionnée, sans rechargement', async () => {
  const id = await makeDashboard('GH435 E6', [{ title: 'Suiveur', query: 'series', template: BAR, size: 'lg' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const svg = card('Suiveur').locator('[data-testid=vega-view] svg')
  await expect(svg).toBeVisible()
  const first = await width(svg)

  await s.page.setViewportSize({ width: 1300, height: 1000 })
  await expect.poll(async () => await svgGap('Suiveur'), { timeout: 10_000 }).toBeLessThanOrEqual(2)
  await expect.poll(() => width(svg)).toBeLessThan(first - 100)
  expect(await textsOutsideBody('Suiveur')).toEqual([])

  await s.page.setViewportSize(WIDE)
  await expect.poll(() => width(svg), { timeout: 10_000 }).toBeGreaterThan(first - 40)

  // Carte redimensionnée à la souris : le SVG suit (deux redessins au plus par seconde et par rafale, puis le dernier).
  await dragHandle(slotOf('Suiveur').getByTestId('widget-resize-w'), -400, 0)
  await expect.poll(async () => await svgGap('Suiveur'), { timeout: 10_000 }).toBeLessThanOrEqual(2)
  await expect.poll(() => width(svg)).toBeLessThan(first - 300)
  expect(await textsOutsideBody('Suiveur')).toEqual([])
})

test('E7 — graphique ramené à 240 × 160 : message « trop petit » à la place d\'un tracé coupé ; agrandi, le graphique revient', async () => {
  const id = await makeDashboard('GH435 E7', [{ title: 'Étroit', query: 'series', template: BAR, size: 'md' }])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const svg = card('Étroit').locator('[data-testid=vega-view] svg')
  await expect(svg).toBeVisible()

  await dragHandle(slotOf('Étroit').getByTestId('widget-resize-w'), -3000, 0)
  await dragHandle(slotOf('Étroit').getByTestId('widget-resize-h'), 0, -3000)
  await expect.poll(async () => (await saved(id, 'Étroit')).height).toBe(160)
  expect(await width(card('Étroit'))).toBe(240)
  await expect(card('Étroit').getByTestId('widget-too-small')).toBeVisible()
  await expect(card('Étroit').getByTestId('widget-too-small')).toContainText('trop petit')
  await expect(svg).toHaveCount(0)

  await dragHandle(slotOf('Étroit').getByTestId('widget-resize-w'), 500, 0)
  await dragHandle(slotOf('Étroit').getByTestId('widget-resize-h'), 0, 200)
  await expect(svg).toBeVisible()
  await expect(card('Étroit').getByTestId('widget-too-small')).toHaveCount(0)
  expect(await textsOutsideBody('Étroit')).toEqual([])
})

/** Texte HTML ou SVG du widget dont la police, une fois l'échelle d'impression appliquée, est sous 8 px. */
const tooSmallFonts = (selector: string, scale: number) => s.page.evaluate(([sel, k]) => {
  const root = document.querySelector(sel as string)!
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
    if (!own) continue
    const px = parseFloat(getComputedStyle(el).fontSize)
    if (px * (k as number) < 7.95) out.push(`${el.tagName.toLowerCase()} ${px}px « ${(el.textContent ?? '').trim().slice(0, 30)} »`)
  }
  return out
}, [selector, scale] as const)

test('E13 — route d\'impression : grille à la largeur de référence, cartes à leurs dimensions, sans poignée ni défilement horizontal, texte ≥ 8 px imprimés', async () => {
  const id = await makeDashboard('GH435 E13', [
    { title: 'Pleine', query: 'rows3', template: TABLE, size: 'lg', height: 300 },
    { title: 'Moitié A', query: 'rows3', template: TABLE, size: 'md', height: 200 },
    { title: 'Moitié B', query: 'series', template: BAR, size: 'md', height: 256 },
  ])
  // Largeur de mise en page du moteur : largeur utile de la page (718,1 px) / échelle (0,65) = 1104,8 px.
  await s.page.setViewportSize({ width: 1105, height: 1600 })
  await s.page.emulateMedia({ media: 'print' })
  const params = new URLSearchParams({
    repoPath: s.project.localPath, workspaceDir: s.project.workspaceDir, username, dashboardId: id, __print: '/print/dashboard',
  })
  await s.page.goto(`/?${params}`)
  const root = s.page.getByTestId('print-dashboard')
  await expect(root).toBeVisible()
  await expect(s.page.getByTestId('widget-card')).toHaveCount(3)
  // Les trois widgets ont fini de se dessiner (tableaux, graphique).
  await expect(card('Moitié B').locator('[data-testid=vega-view] svg, [data-testid=widget-too-small]')).toHaveCount(1)
  await expect(card('Pleine').locator('tbody tr')).toHaveCount(3)

  expect(await width(root)).toBe(1104)
  expect(await width(slotOf('Pleine'))).toBe(1104)
  expect(await width(slotOf('Moitié A'))).toBe(544)
  expect(await width(slotOf('Moitié B'))).toBe(544)
  expect(Math.abs((await rect(slotOf('Moitié A'))).y - (await rect(slotOf('Moitié B'))).y)).toBeLessThan(2)
  expect(await height(card('Pleine'))).toBe(300)
  expect(await height(card('Moitié A'))).toBe(200)
  expect(await height(card('Moitié B'))).toBe(256)
  await expect(s.page.getByTestId('widget-resize-w')).toHaveCount(0)
  await expect(s.page.getByTestId('widget-resize-h')).toHaveCount(0)
  expect(await s.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1105)
  // Texte lisible une fois la page réduite à l'échelle 0,65 (légendes et axes du graphique compris).
  expect(await tooSmallFonts('[data-testid=print-dashboard]', 0.65)).toEqual([])
})

/** Export PDF par l'interface (bouton Exporter → PDF), comme `s4-print.spec.ts`. */
async function exportPdf(name: string): Promise<Buffer> {
  await s.page.getByRole('button', { name: 'Exporter' }).first().click()
  const downloadPromise = s.page.waitForEvent('download', { timeout: 90_000 })
  await s.page.getByRole('button', { name: 'PDF' }).click()
  const download = await downloadPromise
  const target = path.join(E2E.downloadsDir, `${name}-${download.suggestedFilename()}`)
  await download.saveAs(target)
  await s.page.getByRole('button', { name: 'Fermer' }).click()
  return fs.readFileSync(target)
}
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

test('E13b — PDF d\'un dashboard de 13 cartes de 720 px : page A4, 7 pages (aucune carte coupée ; 6 en flux continu)', async () => {
  const cards: WidgetDef[] = Array.from({ length: 13 }, (_, i) => ({
    title: `Carte ${String(i + 1).padStart(2, '0')}`, query: 'rows3', template: { id: 'kpi', params: { measure: 'sum', measureColumn: 'valeur' } }, size: 'lg', height: 720,
  }))
  const id = await makeDashboard('GH435 E13b', cards)
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  await expect(s.page.getByTestId('widget-card')).toHaveCount(13)
  const pdf = await exportPdf('gh435-13-cartes')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'))!
  // A4 = 595,3 × 841,9 pt ; le moteur arrondit la boîte de page au point près.
  expect(parseFloat(media[1])).toBeGreaterThan(594)
  expect(parseFloat(media[1])).toBeLessThan(597)
  expect(parseFloat(media[2])).toBeGreaterThan(841)
  expect(parseFloat(media[2])).toBeLessThan(844)
  expect(pageCount(pdf)).toBe(7)
})

test('E14 — titre d\'un widget : infobulle seulement s\'il est réellement tronqué', async () => {
  const long = 'Un titre de widget vraiment très long qui ne tient pas dans une carte étroite'
  const id = await makeDashboard('GH435 E14', [
    { title: long, query: 'rows3', template: TABLE, size: 'md', width: 240 },
    { title: 'Court', query: 'rows3', template: TABLE, size: 'md' },
  ])
  await s.page.setViewportSize(WIDE)
  await openDashboard(id)
  const titleOf = (t: string) => card(t).getByText(t, { exact: true })
  await titleOf(long).hover()
  await expect(titleOf(long)).toHaveAttribute('title', long)
  await titleOf('Court').hover()
  expect(await titleOf('Court').getAttribute('title')).toBe('')
  // La carte la plus étroite ne déborde pas horizontalement.
  const overflow = await card(long).evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
