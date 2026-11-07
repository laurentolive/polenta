import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH125 — paramètres choisis par widget : sélecteurs dans l'en-tête de chaque widget, plus de barre
 * du dashboard, valeur propre au widget (specs/GH125-tests.md 1, 2, 3, 5, 6, 7, 20).
 */
const s = setupSession()

interface Campaign { id: string; title: string }

let username: string
let camp1: Campaign
let camp2: Campaign
let dashboardId: string
let widgetIds: string[]

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  camp1 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH125 lot A', testCaseIds: tests.slice(0, 1).map(t => t.id) }, workspaceDir)
  camp2 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH125 lot B', testCaseIds: tests.slice(1, 2).map(t => t.id) }, workspaceDir)
  // Une requête paramétrée, deux widgets sur le même dashboard.
  const query = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH125 campagne', scope: 'shared', createdBy: username,
    script: "export default (data, polenta) => [{ campagne: polenta.params.campaign || 'toutes' }]\n",
    parameters: [{ name: 'campaign', kind: 'campaign', label: 'Campagne' }],
  })
  const d = await s.invoke<{ id: string }>('dashboards:create', localPath, username, { title: 'GH125 widgets', scope: 'shared', createdBy: username })
  dashboardId = d.id
  await s.invoke('dashboards:add-widget', localPath, username, d.id, { title: 'Gauche', queryId: query.id, size: 'md', template: { id: 'table', params: {} } })
  const after = await s.invoke<{ widgets: Array<{ id: string }> }>('dashboards:add-widget', localPath, username, d.id, { title: 'Droite', queryId: query.id, size: 'md', template: { id: 'table', params: {} } })
  widgetIds = after.widgets.map(w => w.id)
})

async function openDashboard(title: string) {
  await s.openView('Suivi')
  await s.page.getByText(title, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })
/** Résultat rendu du widget (hors sélecteurs de l'en-tête, dont les options citent les campagnes). */
const body = (title: string) => widget(title).getByTestId('widget-body')

test('1 — seed Campagnes : pas de barre, un sélecteur Campagne dans chaque widget', async () => {
  await openDashboard('Campagnes')
  await expect(s.page.getByTestId('widget-card').first()).toBeVisible()
  await expect(s.page.getByTestId('param-bar')).toHaveCount(0)
  const cards = await s.page.getByTestId('widget-card').count()
  expect(cards).toBeGreaterThan(1)
  await expect(s.page.getByTestId('widget-params')).toHaveCount(cards)
  await expect(widget('Avancement par campagne').getByTestId('widget-params')).toContainText('Campagne :')
  await expect(widget('Avancement par campagne').getByTestId('param-campaign')).toHaveValue('')
  // Au défaut : pas de Réinitialiser.
  await expect(s.page.getByTestId('widget-param-reset')).toHaveCount(0)
})

test('2 / 3 / 5 / 6 — deux widgets de la même requête : valeurs indépendantes, mémorisées par widget', async () => {
  const { localPath } = s.project
  await openDashboard('GH125 widgets')
  const left = widget('Gauche')
  const right = widget('Droite')
  await expect(left.getByTestId('widget-body')).toContainText('toutes', { timeout: 15_000 })
  await expect(right.getByTestId('widget-body')).toContainText('toutes')

  await left.getByTestId('param-campaign').selectOption(camp1.id)
  await expect(left.getByTestId('widget-body')).toContainText(camp1.id, { timeout: 15_000 })
  await expect(right.getByTestId('widget-body')).toContainText('toutes')
  await expect(right.getByTestId('widget-body')).not.toContainText(camp1.id)
  await expect(right.getByTestId('param-campaign')).toHaveValue('')
  await expect(left.getByTestId('widget-param-reset')).toBeVisible()
  await expect(right.getByTestId('widget-param-reset')).toHaveCount(0)

  await right.getByTestId('param-campaign').selectOption(camp2.id)
  await expect(right.getByTestId('widget-body')).toContainText(camp2.id, { timeout: 15_000 })
  await expect(left.getByTestId('widget-body')).toContainText(camp1.id)
  await expect(left.getByTestId('widget-body')).not.toContainText(camp2.id)
  await s.shot('gh125-two-widgets')

  // Rechargement : chaque widget retrouve sa valeur ; .pref par dashboard + widget.
  await s.page.reload()
  await openDashboard('GH125 widgets')
  await expect(widget('Gauche').getByTestId('param-campaign')).toHaveValue(camp1.id)
  await expect(widget('Droite').getByTestId('param-campaign')).toHaveValue(camp2.id)
  const pref = JSON.parse(fs.readFileSync(path.join(localPath, `.${username}.pref`), 'utf8')) as { suiviWidgetParamValues?: Record<string, Record<string, unknown>>; suiviParamValues?: unknown }
  expect(pref.suiviWidgetParamValues?.[dashboardId]).toEqual({
    [widgetIds[0]]: { 'campaign:campaign': camp1.id },
    [widgetIds[1]]: { 'campaign:campaign': camp2.id },
  })
  expect(pref).not.toHaveProperty('suiviParamValues')
  // Rien d'écrit dans le dashboard partagé.
  expect(fs.readFileSync(path.join(localPath, `dashboards/${dashboardId}/dashboard.yaml`), 'utf8')).not.toContain('CAMP-')

  // Réinitialiser un widget : lui seul revient au défaut, l'icône disparaît.
  await widget('Gauche').getByTestId('widget-param-reset').click()
  await expect(body('Gauche')).toContainText('toutes', { timeout: 15_000 })
  await expect(widget('Gauche').getByTestId('widget-param-reset')).toHaveCount(0)
  await expect(body('Droite')).toContainText(camp2.id)
})

test('7 — valeur introuvable : signalée sur le seul widget concerné', async () => {
  const { localPath } = s.project
  await s.invoke('dashboards:param-values-set', localPath, username, dashboardId, widgetIds[0], { 'campaign:campaign': 'CAMP-9999' })
  await s.page.reload()
  await openDashboard('GH125 widgets')
  await expect(widget('Gauche').getByTestId('param-not-found')).toContainText('CAMP-9999')
  await expect(widget('Droite').getByTestId('param-not-found')).toHaveCount(0)
  await expect(body('Gauche')).toContainText('toutes', { timeout: 15_000 })
  await widget('Gauche').getByTestId('widget-param-reset').click()
  await expect(s.page.getByTestId('param-not-found')).toHaveCount(0)
})

test('20 — pointeur sur les sélecteurs : la carte ne se déplace pas', async () => {
  await openDashboard('GH125 widgets')
  const card = widget('Gauche')
  const draggable = card.locator('xpath=..')
  await expect(draggable).toHaveAttribute('draggable', 'true')
  await card.getByTestId('param-campaign').hover()
  await expect(draggable).toHaveAttribute('draggable', 'false')
  await card.getByText('Gauche', { exact: true }).hover()
  await expect(draggable).toHaveAttribute('draggable', 'true')
})
