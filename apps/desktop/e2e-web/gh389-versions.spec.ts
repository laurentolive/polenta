import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH389 — grilles des versions et du backlog (specs/GH389-tests.md E11, E12 ; spec §2.1, §4) : en-tête
 * repliable de la page d'une version, grilles des changements, des tests à exécuter et de l'analyse
 * figée (barre d'outils, filtre, cases, liens d'élément, clavier, édition bloquée une fois figée),
 * backlog (filtre, cases, inclusion), mémoire du défilement du backlog échantillonnée à chaque frame.
 * Types, éléments, liens et versions créés par IPC.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let versionId = ''
let releasedId = ''
let reqA = ''
let testId = ''
const backlogIds: string[] = []

const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
const commit = async (message: string) => {
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), message)
}
async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const openVersion = (id: string) => navigate(s.page, s.projectUrl(`/version/${id}`, { repoPath: repo() }))
const openBacklog = () => navigate(s.page, s.projectUrl('/versions/backlog', { repoPath: repo() }))

/** Barre d'outils commune d'une grille : 👁, ↕▯, Exporter, compteur ; icône de filtre sur une colonne. */
async function expectGridContract(gridId: string, filterCol: string) {
  const toolbar = s.page.getByTestId(`${gridId}-toolbar`)
  await expect(toolbar.getByTestId(`${gridId}-columns`)).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /Exporter|Export/ })).toBeVisible()
  await expect(s.page.getByTestId(`${gridId}-count`)).toHaveText(/^\d+ \/ \d+$/)
  await expect(s.page.getByTestId(`${gridId}-header-${filterCol}`).locator('[data-column-filter-icon]')).toBeVisible()
}

async function filterColumn(gridId: string, col: string, text: string) {
  await s.page.getByTestId(`${gridId}-header-${col}`).locator('[data-column-filter-icon]').click()
  const popover = s.page.locator('[data-column-filter-popover]')
  await popover.getByTestId('column-filter-input').fill(text)
  await s.page.getByTestId(`${gridId}-count`).click()
  await expect(popover).toHaveCount(0)
}

test.beforeAll(async () => {
  test.setTimeout(300_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh389v_req', label: 'GH389V Exigence', prefix: 'GH389V', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
    { name: 'gh389v_test', label: 'GH389V Test', prefix: 'GH389W', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
  ]
  typeOfCategory(root, 'version', { name: 'gh389v_version', label: 'Version', prefix: 'GH389P', category: 'version', fields: [], statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }] })
  await s.invoke('schema:save', repo(), schema)
  reqA = (await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh389v_req', title: 'GH389V livrée', fields: {} }, ws())).id
  testId = (await s.invoke<{ id: string }>('tests:create', repo(), { objectTypeRef: 'root::gh389v_test', title: 'GH389V test', fields: {}, steps: [] }, ws())).id
  await s.invoke('requirements:link-create', repo(), { type: 'verification', sourceId: testId, targetId: reqA }, ws())
  // Version figée : analyse en tableau (lecture seule).
  releasedId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH389 figée' }, ws())).id
  await s.invoke('versions:include', repo(), releasedId, [reqA], ws())
  await commit('GH389 versions — figée')
  await s.invoke('versions:release', repo(), releasedId, 'gh389-fige', ws())
  // Assez d'éléments au backlog pour faire défiler sa grille.
  for (let i = 1; i <= 40; i++) {
    backlogIds.push((await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh389v_req', title: `GH389V backlog ${i}`, fields: {} }, ws())).id)
  }
  versionId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH389 en cours' }, ws())).id
  await s.invoke('versions:include', repo(), versionId, [backlogIds[0], backlogIds[1]], ws())
  await commit('GH389 versions — backlog')
})

test('E11 — page d’une version : en-tête repliable, changements, tests à exécuter', async () => {
  const p = s.page
  await openVersion(versionId)
  await expect(p.getByTestId('version-page')).toBeVisible()

  // GH439 — plus d'en-tête repliable : ID et état restent dans la barre de titre, les informations sont
  // une section comme les autres (même repli, état retrouvé sur une autre version).
  await expect(p.getByTestId('version-info')).toBeVisible()
  await expect(p.getByTestId('version-header-toggle')).toHaveCount(0)
  await p.getByTestId('version-info-toggle').click()
  await expect(p.getByTestId('version-info')).toHaveCount(0)
  await expect(p.getByTestId('version-state-short')).toBeVisible()
  await openVersion(releasedId)
  await expect(p.getByTestId('version-info')).toHaveCount(0)
  await p.getByTestId('version-info-toggle').click()
  await expect(p.getByTestId('version-info')).toBeVisible()
  await openVersion(versionId)
  await expect(p.getByTestId('version-info')).toBeVisible()

  // Changements : contrat de grille, liens d'élément (élément et version), cases et « Retirer ».
  await expectGridContract('version-changes', 'id')
  const changes = p.getByTestId('version-changes')
  const rowOf = (id: string) => changes.locator(`tr[data-node-id$=":${versionId}:${id}"]`)
  await expect(rowOf(backlogIds[0]).locator(`td[data-col="id"] [data-element-link="${backlogIds[0]}"]`)).toBeVisible()
  await expect(rowOf(backlogIds[0]).locator(`td[data-col="version"] [data-element-link="${versionId}"], td[data-col="version"] [data-page-link="${versionId}"]`)).toHaveCount(1)
  await filterColumn('version-changes', 'id', backlogIds[1])
  await expect(changes.locator('tr[data-node-id]')).toHaveCount(1)
  await expect(p.getByTestId('version-changes-count')).toHaveText('1 / 2')
  await p.getByTestId('version-changes-header-id').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').press('Escape')
  await expect(changes.locator('tr[data-node-id]')).toHaveCount(2)

  // Cases : un clic sur la ligne la coche (grille à cases) ; clavier : ← jusqu'à la case, Espace bascule.
  await rowOf(backlogIds[0]).locator('td[data-col="component"]').click()
  await expect(p.getByTestId('version-remove-selected')).toBeVisible()
  await p.keyboard.press('ArrowLeft')
  await expect(rowOf(backlogIds[0]).locator('td[data-active]')).toHaveAttribute('data-col', '__check')
  await p.keyboard.press('Space')
  await expect(p.getByTestId('version-remove-selected')).toHaveCount(0)
  await p.keyboard.press('Space')
  await expect(p.getByTestId('version-remove-selected')).toBeVisible()
  await p.keyboard.press('Space')
  await expect(p.getByTestId('version-remove-selected')).toHaveCount(0)

  // Tests à exécuter : le test qui couvre une exigence incluse n'y est pas (reqA est dans la version
  // figée) ; la grille de la version figée le liste.
  await openVersion(releasedId)
  const tests = p.getByTestId('version-tests-list')
  await expect(tests).toBeVisible()
  await expectGridContract('version-tests', 'id')
  await expect(tests.locator(`tr[data-node-id="${testId}"] [data-element-link="${testId}"]`)).toBeVisible()
  await expect(tests.locator(`[data-testid="version-tests-check-${testId}"]`)).toBeVisible()
  await expect(p.getByTestId('version-campaign-create')).toBeEnabled()
  await p.getByTestId(`version-tests-check-${testId}`).click()
  await expect(p.getByTestId('version-campaign-create')).toBeDisabled()
  await p.getByTestId(`version-tests-check-${testId}`).click()

  // Analyse figée : tableau en lecture seule, ID en lien d'élément, aucune cellule ne s'ouvre.
  const analysis = p.getByTestId('version-impact-rows')
  await expect(analysis).toBeVisible()
  await expectGridContract('version-analysis', 'status')
  const impactRow = analysis.locator('tr[data-node-id]').first()
  await expect(impactRow.locator('td[data-col="id"] [data-element-link]')).toHaveCount(1)
  await impactRow.locator('td[data-col="status"]').dblclick()
  await expect(analysis.locator('select')).toHaveCount(0)
  await s.shot('gh389-version-page')
})

test('E11 — backlog : contrat de grille, filtre, cases, liens', async () => {
  const p = s.page
  await openBacklog()
  const table = p.getByTestId('backlog-table')
  await expect(table).toBeVisible()
  await expectGridContract('backlog', 'id')
  const id = backlogIds[10]
  await expect(table.locator(`tr[data-node-id="${id}"] td[data-col="id"] [data-element-link="${id}"]`)).toBeVisible()
  await filterColumn('backlog', 'id', id)
  await expect(table.locator('tr[data-node-id]')).toHaveCount(1)
  await p.getByTestId(`backlog-check-${id}`).click()
  await expect(p.getByTestId('backlog-include')).toBeEnabled()
  await p.getByTestId(`backlog-check-${id}`).click()
  await expect(p.getByTestId('backlog-include')).toBeDisabled()
  await p.getByTestId('backlog-header-id').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').press('Escape')
  await expect.poll(() => table.locator('tr[data-node-id]').count()).toBeGreaterThan(35)
})

// ── E12 — mémoire du défilement du backlog (leçon 2026-11-06 : chaque frame, plusieurs chemins) ──

interface Visible { node: string; offset: number }
function readVisible(el: HTMLElement): Visible {
  const area = el.getBoundingClientRect()
  for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const r = row.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= area.top) continue
    return { node: row.dataset.nodeId!, offset: Math.round(r.top - area.top) }
  }
  return { node: '', offset: 0 }
}
const scroller = () => s.page.getByTestId('backlog-table').locator('[data-view-scroll]')
const position = () => scroller().evaluate(readVisible)
const same = (a: Visible, b: Visible) => a.node === b.node && Math.abs(a.offset - b.offset) <= 2

async function scrollBacklog(fraction: number): Promise<Visible> {
  await scroller().evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f }, fraction)
  await s.page.waitForTimeout(400)
  return position()
}
async function startSampling() {
  await s.page.evaluate(`(() => {
    const readVisible = ${readVisible.toString()}
    window.__gh389 = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('[data-testid="backlog-table"] [data-view-scroll]')
      if (location.pathname.endsWith('/versions/backlog') && el && el.querySelector('[data-node-id]')) window.__gh389.push(readVisible(el))
      if (performance.now() - start < 2500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}
async function expectRestored(expected: Visible) {
  await expect.poll(async () => { const p = await position(); return same(p, expected) ? 'ok' : JSON.stringify(p) }).toBe('ok')
  await s.page.waitForTimeout(2600)
  const samples = await s.page.evaluate(() => (window as unknown as { __gh389: Visible[] }).__gh389)
  expect(samples.length).toBeGreaterThan(0)
  const off = samples.filter(p => !same(p, expected))
  expect(off, `frames hors position ${JSON.stringify(expected)} : ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
}
const tabs = () => s.page.getByTestId('tab')

test('E12 — backlog : position reprise au retour sur l’onglet, sans peindre le haut', async () => {
  await s.openView('Version')
  await openBacklog()
  const p = await scrollBacklog(0.7)
  expect(p.node).not.toBe(backlogIds[0])
  const count = await tabs().count()
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await s.openView('Exigences')
  await startSampling()
  await tabs().nth(start).click()
  await expectRestored(p)
})

test('E12 — backlog : position reprise par Précédent, sans peindre le haut', async () => {
  await openBacklog()
  const p = await scrollBacklog(0.5)
  await openVersion(versionId)
  await expect(s.page.getByTestId('version-page')).toBeVisible()
  await startSampling()
  await s.page.goBack()
  await expectRestored(p)
})

test('E12 — backlog : position reprise par la barre d’activité, sans peindre le haut', async () => {
  await s.openView('Version')
  await openBacklog()
  const p = await scrollBacklog(0.8)
  await s.openView('Exigences')
  await expect.poll(() => new URL(s.page.url()).pathname).not.toContain('/versions/backlog')
  await startSampling()
  await s.openView('Version')
  await expect.poll(() => new URL(s.page.url()).pathname).toContain('/versions/backlog')
  await expectRestored(p)
})
