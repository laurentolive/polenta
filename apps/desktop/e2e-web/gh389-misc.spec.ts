import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH389 — suivi, paramètres, conformité sur la grille commune (specs/GH389-tests.md E11 ; spec §4) :
 * résultat de requête (page Requête : barre sans 👁, filtre, liens), widget table (mode compact : ni
 * barre ni filtre, clavier), détail d'un widget (modale : filtre, pas de 👁 ni d'export, Échap par
 * étapes — GH33, design §11), Paramètres (une grille par repo, double-clic → dialogue), matrice de conformité
 * (lignes de groupe, première colonne figée, pas de 👁). Requête, tableau de bord, widget et
 * paramètre créés par IPC.
 */
const s = setupSession()

interface Widget { id: string; title: string }
interface Dashboard { id: string; widgets: Widget[] }

const SCRIPT = 'export default (data) => data.requirements.slice(0, 5).map((r) => ({ id: r.id, title: r.title, _ids: [r.id] }))'
const PARAM = 'gh389_misc'
let username = ''
let queryId = ''
let dashboardId = ''

const repo = () => s.project.localPath
async function navigate(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}
const dialog = () => s.page.getByRole('dialog')
const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })

test.beforeAll(async () => {
  username = await s.invoke<string>('auth:project-username', repo())
  queryId = (await s.invoke<{ id: string }>('queries:create', repo(), username, { title: 'GH389 requête', script: SCRIPT, scope: 'private', createdBy: username })).id
  dashboardId = (await s.invoke<{ id: string }>('dashboards:create', repo(), username, { title: 'GH389 suivi', scope: 'private', createdBy: username })).id
  await s.invoke<Dashboard>('dashboards:add-widget', repo(), username, dashboardId, {
    title: 'GH389 table', queryId, size: 'md', template: { id: 'table', params: { columns: ['id', 'title'] } },
  })
  await s.invoke('parameters:create', repo(), { name: PARAM, value: '12', unit: 'V', description: 'GH389 paramètre' }, s.project.workspaceDir)
})

test('E11 — page Requête : grille sans 👁, filtre par colonne, liens, export', async () => {
  const p = s.page
  await navigate(s.projectUrl('/query', { queryId }))
  const grid = p.getByTestId('query-result')
  await expect(grid.locator('tr[data-node-id]')).toHaveCount(5)
  const toolbar = p.getByTestId('query-result-toolbar')
  await expect(toolbar.getByTestId('query-result-columns')).toHaveCount(0)
  await expect(toolbar.getByRole('button', { name: /Exporter|Export/ })).toBeVisible()
  await expect(p.getByTestId('query-result-count')).toHaveText('5 / 5')
  const firstId = (await grid.locator('tr[data-node-id="0"] td[data-col="id"]').innerText()).trim()
  await expect(grid.locator(`tr[data-node-id="0"] td[data-col="id"] [data-element-link="${firstId}"]`)).toBeVisible()
  await p.getByTestId('query-result-header-id').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').fill(firstId)
  await p.getByTestId('query-result-count').click()
  await expect(p.getByTestId('query-result-count')).toHaveText('1 / 5')
})

test('E11 — widget table (compact) puis détail : clavier, filtre en modale, Échap par étapes', async () => {
  const p = s.page
  await navigate(s.projectUrl('/dashboard', { dashboardId }))
  const card = widget('GH389 table')
  await expect(card.locator('tr[data-node-id]')).toHaveCount(5)
  // Mode compact : ni barre d'outils, ni filtre, ni poignée de largeur.
  await expect(card.getByTestId('query-result-toolbar')).toHaveCount(0)
  await expect(card.locator('[data-column-filter-icon]')).toHaveCount(0)
  await expect(card.locator('[data-col-resize]')).toHaveCount(0)
  // Clavier : ↓ depuis la cellule Titre de la première ligne.
  await card.locator('tr[data-node-id="0"] td[data-col="title"]').click()
  await p.keyboard.press('ArrowDown')
  await expect(card.locator('tr[data-node-id="1"] td[data-active]')).toHaveAttribute('data-col', 'title')
  // Entrée sur une ligne qui porte des `_ids` : détail du widget.
  await p.keyboard.press('Enter')
  await expect(dialog()).toBeVisible()
  const objects = dialog().getByTestId('drilldown-objects')
  await expect(objects.locator('tr[data-node-id]')).toHaveCount(1)
  await expect(dialog().getByTestId('drilldown-columns')).toHaveCount(0)
  await expect(dialog().getByRole('button', { name: /Exporter|Export/ })).toHaveCount(0)
  await expect(objects.locator('td[data-col="id"] [data-element-link]')).toHaveCount(1)
  // Échap : popover de filtre d'abord.
  await dialog().getByTestId('drilldown-header-title').locator('[data-column-filter-icon]').click()
  await expect(p.locator('[data-column-filter-popover]')).toBeVisible()
  await p.getByTestId('column-filter-input').press('Escape')
  await expect(p.locator('[data-column-filter-popover]')).toHaveCount(0)
  await expect(dialog()).toBeVisible()
  // Cellule active, puis sélection de ligne (design §11), puis la modale.
  await objects.locator('td[data-col="title"]').click()
  await expect(objects.locator('tr[data-selected]')).toHaveCount(1)
  await p.keyboard.press('Escape')
  await expect(objects.locator('td[data-active]')).toHaveCount(0)
  await expect(dialog()).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(objects.locator('tr[data-selected]')).toHaveCount(0)
  await expect(dialog()).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
})

test('E11 — Paramètres : grille par repo, recherche, double-clic → dialogue', async () => {
  const p = s.page
  await navigate(s.projectUrl('/parameters'))
  const row = p.locator(`tr[data-node-id="${PARAM}"]`)
  await expect(row).toBeVisible()
  const grid = p.locator('[data-testid^="parameters-grid-"]').filter({ has: row })
  await expect(grid.locator('[data-testid$="-toolbar"]').getByRole('button', { name: 'Colonnes' })).toBeVisible()
  await expect(grid.locator('[data-testid$="-toolbar"]').getByRole('button', { name: /Exporter|Export/ })).toBeVisible()
  await expect(grid.locator('th[data-col="value"] [data-column-filter-icon]')).toBeVisible()
  await expect(row.locator('td[data-col="unit"]')).toHaveText('V')
  // Recherche globale de l'écran, combinée à la grille.
  await p.getByPlaceholder(/Rechercher/).fill(PARAM)
  await expect(grid.locator('tr[data-node-id]')).toHaveCount(1)
  await row.locator('td[data-col="description"]').click()
  await expect(p.getByText(`Paramètre ${PARAM}`)).toHaveCount(0)
  await row.locator('td[data-col="description"]').dblclick()
  await expect(p.getByText(`Paramètre ${PARAM}`)).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(p.getByText(`Paramètre ${PARAM}`)).toHaveCount(0)
})

test('E11 — matrice de conformité : lignes de groupe, première colonne figée, liens, export', async () => {
  const p = s.page
  await navigate(s.projectUrl('/compliance', { dir: s.project.workspaceDir, repoPath: repo() }))
  const matrix = p.getByTestId('compliance-matrix')
  await expect(matrix).toBeVisible({ timeout: 30_000 })
  await expect(p.getByTestId('compliance-columns')).toHaveCount(0)
  await expect(p.getByTestId('compliance-toolbar').getByRole('button', { name: /Exporter|Export/ })).toBeVisible()
  await expect(matrix.locator('tr[data-group-row]').first()).toBeVisible()
  await expect(p.getByTestId('compliance-header-requirement')).toHaveCSS('position', 'sticky')
  await expect(p.getByTestId('compliance-header-requirement').locator('[data-column-filter-icon]')).toBeVisible()
  const total = await matrix.locator('tr[data-node-id]').count()
  expect(total).toBeGreaterThan(0)
  const firstId = await matrix.locator('tr[data-node-id]').first().getAttribute('data-node-id')
  await p.getByTestId('compliance-header-requirement').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').fill(firstId!)
  await p.getByTestId('compliance-count').click()
  await expect(matrix.locator(`tr[data-node-id="${firstId}"]`)).toBeVisible()
  await expect(matrix.locator(`tr[data-node-id="${firstId}"] td[data-col="requirement"] [data-element-link="${firstId}"]`)).toBeVisible()
  if (total > 1) await expect.poll(() => matrix.locator('tr[data-node-id]').count()).toBeLessThan(total)
  await s.shot('gh389-compliance')
})
