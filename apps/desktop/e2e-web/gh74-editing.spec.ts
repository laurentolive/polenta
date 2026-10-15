import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH74 sprint 4 — vue Suivi (specs/GH74-tests.md) : vues natives (T6), détachement et retour au
 * modèle (T7), requête SQL d'avant GH74 dans un widget (F4), format plus récent (F6), thème (R1),
 * marque sans identifiants (R4), erreur de script (R6), rafraîchissement (R8), seed d'un repo neuf
 * (D1), widget du seed proposé à un seed existant (D4). Objets créés par le test (IPC ou fichiers).
 */
const s = setupSession()

interface Widget { id: string; title: string; state: { customized: boolean }; template?: { id: string }; transform?: string; spec: string }
interface Dashboard { id: string; title: string; widgets: Widget[] }
interface Campaign { id: string; runs: Array<{ entryId: string }> }

const DASHBOARD = 'GH74 édition'
let username: string
let dashboardId: string

async function navigate(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}
const openDashboard = (id: string) => navigate(s.projectUrl('/dashboard', { dashboardId: id }))
const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })
const dialog = () => s.page.getByRole('dialog')

async function addQuery(title: string, script: string): Promise<string> {
  const q = await s.invoke<{ id: string }>('queries:create', s.project.localPath, username, { title, script, scope: 'private', createdBy: username })
  return q.id
}
async function addWidget(title: string, queryId: string, content: Record<string, unknown>): Promise<Widget> {
  const d = await s.invoke<Dashboard>('dashboards:add-widget', s.project.localPath, username, dashboardId, { title, queryId, size: 'md', ...content })
  return d.widgets.find(w => w.title === title)!
}

test.beforeAll(async () => {
  const { localPath } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  dashboardId = (await s.invoke<{ id: string }>('dashboards:create', localPath, username, { title: DASHBOARD, scope: 'private', createdBy: username })).id
})

test('D1 — premier accès à Suivi : bibliothèque, types et jsconfig copiés ; seed Campagnes avec « Avancement dans le temps »', async () => {
  const { localPath } = s.project
  await s.openView('Suivi')
  await expect(s.page.getByText('Campagnes', { exact: true }).last()).toBeVisible({ timeout: 15_000 })
  for (const f of ['dashboards/lib/campaign.js', 'dashboards/lib/polenta.d.ts', 'dashboards/jsconfig.json']) {
    expect(fs.existsSync(path.join(localPath, f)), f).toBe(true)
  }
  const dashboards = await s.invoke<Dashboard[]>('dashboards:list', localPath, username)
  const campaigns = dashboards.find(d => d.title === 'Campagnes')!
  expect(campaigns.widgets.map(w => w.title)).toContain('Avancement dans le temps')
})

test('T6 / R4 / R6 — vues natives KPI et table ; marque sans identifiants ; erreur de script avec fichier et ligne', async () => {
  const rowsQ = await addQuery('GH74 lignes sans ids', `export default () => [{ lettre: 'a', n: 2 }, { lettre: 'b', n: 5 }]`)
  const brokenQ = await addQuery('GH74 en erreur', `export default (data) => {\n  const x = data.campagnes\n  return x.map((c) => c)\n}`)
  await addWidget('GH74 KPI', rowsQ, { template: { id: 'kpi', params: { measure: 'sum', measureColumn: 'n' } } })
  await addWidget('GH74 table', rowsQ, { template: { id: 'table', params: { columns: ['lettre', 'n'] } } })
  await addWidget('GH74 barres sans ids', rowsQ, { template: { id: 'bar', params: { category: 'lettre', measure: 'sum', measureColumn: 'n' } } })
  await addWidget('GH74 erreur', brokenQ, { template: { id: 'table', params: {} } })
  await openDashboard(dashboardId)

  await expect(widget('GH74 KPI').locator('[data-drilldown="kpi"]')).toContainText('7')
  await expect(widget('GH74 table').locator('tbody tr')).toHaveCount(2)
  await expect(widget('GH74 table').getByTestId('vega-view')).toHaveCount(0)

  await widget('GH74 barres sans ids').locator('[aria-roledescription="bar"]').first().click({ force: true })
  await expect(dialog()).toContainText('Détail non disponible')
  await s.page.keyboard.press('Escape')

  await expect(widget('GH74 erreur').getByTestId('widget-error')).toContainText(/TypeError.*\(script\.js:3\)/)
  await s.shot('gh74-t6-r6-widgets')
})

test('T7 — code modifié : widget personnalisé ; « Revenir au modèle » (confirmé) régénère le code', async () => {
  const { localPath } = s.project
  const q = await addQuery('GH74 statuts', `export default (data) => data.requirements.map((r) => ({ status: r.status, _ids: [r.id] }))`)
  const w = await addWidget('GH74 détaché', q, { template: { id: 'bar', params: { category: 'status' } } })
  expect(w.state.customized).toBe(false)
  const d = await s.invoke<Dashboard>('dashboards:get', localPath, username, dashboardId)
  const current = d.widgets.find(x => x.id === w.id)!
  const edited = await s.invoke<Dashboard>('dashboards:update-widget', localPath, username, dashboardId, w.id, {
    transform: current.transform, spec: current.spec.replace('"bar"', '"point"'),
  })
  expect(edited.widgets.find(x => x.id === w.id)!.state.customized).toBe(true)

  await openDashboard(dashboardId)
  await widget('GH74 détaché').getByTitle('Modifier le widget').click()
  await dialog().getByRole('button', { name: 'Revenir au modèle' }).click()
  await expect(dialog().getByTestId('revert-confirm')).toContainText('Le code modifié sera perdu.')
  await dialog().getByTestId('revert-confirm').getByRole('button', { name: 'Revenir au modèle' }).click()
  await expect(dialog().getByTestId('template-form')).toBeVisible()
  await dialog().getByRole('button', { name: 'Sauvegarder' }).click()
  await expect(dialog()).toHaveCount(0)
  const after = await s.invoke<Dashboard>('dashboards:get', localPath, username, dashboardId)
  expect(after.widgets.find(x => x.id === w.id)).toMatchObject({ template: { id: 'bar' }, state: { customized: false } })
})

test('R8 — résultat saisi ailleurs : le widget se met à jour sans action', async () => {
  const { localPath, workspaceDir } = s.project
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  const campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH74 rafraîchissement', testCaseIds: tests.slice(0, 2).map(t => t.id) }, workspaceDir)
  const q = await addQuery('GH74 PASS de la campagne',
    `export default (data) => {\n  const c = data.campaigns.find((x) => x.id === '${campaign.id}')\n  return [{ pass: c.entries.filter((e) => e.status === 'PASS').length }]\n}`)
  await addWidget('GH74 PASS', q, { template: { id: 'kpi', params: { measure: 'sum', measureColumn: 'pass' } } })
  await openDashboard(dashboardId)
  await expect(widget('GH74 PASS')).toContainText('0')
  await recordResult(s, campaign.id, campaign.runs[0].entryId, 'PASS')
  await expect(widget('GH74 PASS')).toContainText('1', { timeout: 15_000 })
})

test('R1 — couleurs par jeton : suivent le thème clair / sombre', async () => {
  const q = await addQuery('GH74 thème', `export default () => [{ a: 'x', n: 1 }]`)
  await addWidget('GH74 thème', q, {
    transform: null,
    spec: JSON.stringify({ data: { name: 'rows' }, mark: { type: 'bar', color: 'var(--chart-series-1)' }, encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } }),
  })
  await openDashboard(dashboardId)
  const bar = widget('GH74 thème').locator('[aria-roledescription="bar"]').first()
  await expect(bar).toHaveAttribute('fill', /rgb/)
  const before = await bar.getAttribute('fill')
  await s.openView('Compte')
  const toggle = s.page.getByTitle(/Passer en mode (sombre|clair)/)
  await toggle.click()
  await openDashboard(dashboardId)
  await expect(widget('GH74 thème').locator('[aria-roledescription="bar"]').first()).not.toHaveAttribute('fill', before!)
})

test('F4 / F6 — requête SQL d\'avant GH74 dans un widget ; dashboard d\'un format plus récent en lecture seule', async () => {
  const { localPath } = s.project
  fs.writeFileSync(path.join(localPath, 'queries', 'QUERY-9101.yaml'), yaml.dump({
    id: 'QUERY-9101', title: 'GH74 ancienne SQL', mode: 'sql', sqlText: 'SELECT [id] FROM [requirements]', scope: 'shared', createdBy: 'e2e', createdAt: '2026-01-01T00:00:00Z',
  }))
  fs.writeFileSync(path.join(localPath, 'dashboards', 'DASHBOARD-9101.yaml'), yaml.dump({
    id: 'DASHBOARD-9101', title: 'GH74 ancien dashboard', scope: 'shared', createdBy: 'e2e', createdAt: '2026-01-01T00:00:00Z', widgetOrder: ['w1'],
    widgets: [{ id: 'w1', title: 'Ancienne table', queryId: 'QUERY-9101', type: 'table', size: 'lg', fieldMapping: { columns: ['id'] } }],
  }))
  const newer = path.join(localPath, 'dashboards', 'DASHBOARD-9102', 'dashboard.yaml')
  fs.mkdirSync(path.dirname(newer), { recursive: true })
  fs.writeFileSync(newer, yaml.dump({ id: 'DASHBOARD-9102', title: 'GH74 format futur', formatVersion: 2, widgetOrder: [], widgets: [], createdBy: 'e2e', createdAt: '2026-01-01T00:00:00Z', futureField: { x: 1 } }))
  const newerBefore = fs.readFileSync(newer, 'utf8')

  // F4 — le widget affiche le refus ; la requête est refusée en écriture.
  await openDashboard('DASHBOARD-9101')
  await expect(widget('Ancienne table')).toContainText('Requête SQL non prise en charge')
  await expect(s.invoke('queries:update', localPath, username, 'QUERY-9101', { script: 'export default () => []' })).rejects.toThrow(/SUIVI_READ_ONLY/)
  await s.openView('Suivi')
  await expect(s.page.getByTestId('readonly-badge').first()).toBeVisible()

  // F6 — lecture seule : avis, aucune action d'écriture, fichier jamais réécrit.
  await openDashboard('DASHBOARD-9102')
  await expect(s.page.getByTestId('dashboard-readonly')).toContainText('version plus récente')
  await expect(s.page.getByRole('button', { name: 'Ajouter un widget' })).toHaveCount(0)
  await expect(s.invoke('dashboards:update', localPath, username, 'DASHBOARD-9102', { title: 'Renommé' })).rejects.toThrow(/SUIVI_READ_ONLY/)
  expect(fs.readFileSync(newer, 'utf8')).toBe(newerBefore)
  await s.shot('gh74-f6-lecture-seule')
})

test('D4 — seed Campagnes existant sans « Avancement dans le temps » : proposé dans le bandeau, ajouté sur Appliquer', async () => {
  const { localPath } = s.project
  // Seed d'avant ce widget : on retire le widget et sa trace du marqueur (`.{utilisateur}.pref`).
  const prefPath = path.join(localPath, `.${username}.pref`)
  const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8')) as { campaignsSeed: { dashboardId: string; queries: Record<string, string> } }
  const campaignsId = pref.campaignsSeed.dashboardId
  const d = await s.invoke<Dashboard>('dashboards:get', localPath, username, campaignsId)
  await s.invoke('dashboards:delete-widget', localPath, username, campaignsId, d.widgets.find(w => w.title === 'Avancement dans le temps')!.id)
  const fresh = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
  delete fresh.campaignsSeed.queries.timeline
  fs.writeFileSync(prefPath, JSON.stringify(fresh))

  await s.page.reload()
  await s.openView('Suivi')
  const banner = s.page.getByTestId('suivi-updates')
  await expect(banner).toContainText('Mise à jour disponible (1)', { timeout: 15_000 })
  await banner.getByRole('button', { name: /Mise à jour disponible/ }).click()
  await expect(banner.getByTestId('suivi-update')).toContainText('Widget pour « Campagnes »')
  await banner.getByRole('button', { name: 'Appliquer' }).click()
  await expect(banner).toHaveCount(0)
  const after = await s.invoke<Dashboard>('dashboards:get', localPath, username, campaignsId)
  expect(after.widgets.map(w => w.title)).toContain('Avancement dans le temps')
})
