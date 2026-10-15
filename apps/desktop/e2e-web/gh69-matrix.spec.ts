import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH69, adapté à GH74 — modèle de widget « Matrice » (heatmap Vega-Lite) : résultat de chaque test
 * dans chaque campagne, pire statut par cellule. Campagnes, requête (modèle « Entrées de campagne »)
 * et dashboard (privés) sont créés par le test. GH74 : les en-têtes (axes Vega) ne sont plus
 * cliquables ; seules les cellules ouvrent le détail (leurs `_ids`).
 */
const s = setupSession()

interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

const DASHBOARD = 'GH69 matrice'
const WIDGET = 'Tests × campagnes'
let first: Campaign
let second: Campaign
let testIds: string[]

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  expect(tests.length).toBeGreaterThanOrEqual(3)
  testIds = tests.slice(0, 3).map(t => t.id)
  // CAMP 1 : tests 0 et 1 ; CAMP 2 : tests 0, 1, 2 → test 2 absent de la 1re campagne.
  first = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH69 A', testCaseIds: testIds.slice(0, 2) }, workspaceDir)
  second = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH69 B', testCaseIds: testIds }, workspaceDir)
  await recordResult(s, first.id, first.runs[0].entryId, 'PASS')
  await recordResult(s, first.id, first.runs[1].entryId, 'FAIL')
  await recordResult(s, second.id, second.runs[0].entryId, 'BLOCKED')

  const username = await s.invoke<string>('auth:project-username', localPath)
  const query = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH69 tests × campagnes',
    template: { id: 'campaign-entries', params: { campaignIds: [first.id, second.id] } },
    scope: 'private',
    createdBy: username,
  })
  const dashboard = await s.invoke<{ id: string }>('dashboards:create', localPath, username, { title: DASHBOARD, scope: 'private', createdBy: username })
  await s.invoke('dashboards:add-widget', localPath, username, dashboard.id, {
    title: WIDGET,
    queryId: query.id,
    template: { id: 'matrix', params: { row: 'testCaseId', label: 'testTitle', column: 'campaignId', value: 'status', entryColors: true } },
    size: 'lg',
  })
})

async function openDashboard() {
  await s.openView('Suivi')
  await s.page.getByText(DASHBOARD, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const widget = () => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(WIDGET, { exact: true }) })
/** Cellule de la heatmap (rectangle Vega, rendu SVG) pour un test et une campagne. */
const cell = (testId: string, campaignId: string) =>
  widget().locator(`[aria-roledescription="rect mark"][aria-label*="campaignId: ${campaignId}"][aria-label*="testCaseId: ${testId}"]`)
const dialog = () => s.page.getByRole('dialog')

test('N4 / N9 — une cellule par couple présent, pire statut, cellule absente distincte', async () => {
  await openDashboard()
  await expect(cell(testIds[0], first.id)).toHaveCount(1, { timeout: 15_000 })
  await expect(cell(testIds[0], first.id)).toHaveAttribute('aria-label', /value: PASS/)
  await expect(cell(testIds[1], first.id)).toHaveAttribute('aria-label', /value: FAIL/)
  await expect(cell(testIds[0], second.id)).toHaveAttribute('aria-label', /value: BLOCKED/)
  await expect(cell(testIds[2], second.id)).toHaveAttribute('aria-label', /value: pending/)
  await expect(cell(testIds[2], first.id)).toHaveCount(0)
  await s.shot('gh69-matrice')
})

test('N10 — clic sur une cellule → détail de l\'entrée, puis résultat d\'exécution', async () => {
  await openDashboard()
  // Le libellé (couche texte, même datum) recouvre la cellule : clic forcé au centre.
  await cell(testIds[1], first.id).click({ force: true })
  await expect(dialog()).toBeVisible()
  const rows = dialog().locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`${first.id}/${first.runs[1].entryId}`)
  await rows.click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${first.id}/run/${first.runs[1].entryId}`))
})

test('N3 — popup : modèle Matrice, enregistrement bloqué tant qu\'un paramètre requis manque', async () => {
  await openDashboard()
  await widget().getByTitle('Modifier le widget').click()
  const modal = dialog()
  await expect(modal.getByTestId('template-form')).toBeVisible()
  await expect(modal.getByText('Lignes *', { exact: true })).toBeVisible()

  const columnsSelect = modal.getByTestId('template-form').locator('label', { hasText: /^Colonnes \*$/ }).locator('xpath=following-sibling::select')
  await columnsSelect.selectOption('')
  await expect(modal.getByRole('button', { name: 'Sauvegarder' })).toBeDisabled()

  await columnsSelect.selectOption('campaignTitle')
  await modal.getByRole('button', { name: 'Sauvegarder' }).click()
  await expect(modal).toHaveCount(0)
  await expect(widget().locator('[aria-roledescription="rect mark"][aria-label*="campaignTitle: GH69 A"]').first()).toBeVisible()
})
