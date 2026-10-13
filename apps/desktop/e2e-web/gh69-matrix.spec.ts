import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH69 — widget « Matrice » de la vue Suivi : résultat de chaque test dans chaque campagne.
 * Scénarios N3, N4, N9–N12, L2, L6, L9 de specs/GH69-tests.md. Campagnes, requête et dashboard
 * (privés) sont créés par le test ; la requête ne lit que ces deux campagnes.
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
    mode: 'sql',
    sqlText: `SELECT testCaseId, testTitle, campaignId, campaignTitle, campaignCreatedAt, status, entryId FROM campaign_entries
      WHERE campaignId IN ('${first.id}', '${second.id}') ORDER BY campaignCreatedAt`,
    scope: 'private',
    createdBy: username,
  })
  const dashboard = await s.invoke<{ id: string }>('dashboards:create', localPath, username, { title: DASHBOARD, scope: 'private', createdBy: username })
  await s.invoke('dashboards:add-widget', localPath, username, dashboard.id, {
    title: WIDGET,
    queryId: query.id,
    type: 'matrix',
    fieldMapping: { category: 'testCaseId', label: 'testTitle', series: 'campaignId', measure: 'status' },
    size: 'lg',
  })
})

async function openDashboard() {
  await s.openView('Suivi')
  await s.page.getByText(DASHBOARD, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const widget = () => s.page.locator('div.h-64').filter({ has: s.page.getByText(WIDGET, { exact: true }) })
const cell = (testId: string, campaignId: string) => widget().locator(`td[data-cell="${testId}|${campaignId}"]`)
const dialog = () => s.page.getByRole('dialog')

test('N4 / N9 — tests en lignes, campagnes en colonnes dans l\'ordre de création, cellule vide distincte', async () => {
  await openDashboard()
  const matrix = widget().getByTestId('matrix-widget')
  await expect(matrix).toBeVisible()
  await expect(matrix.locator('thead th')).toHaveText(['', first.id, second.id])
  await expect(cell(testIds[0], first.id).locator('[data-status]')).toHaveAttribute('data-status', 'PASS')
  await expect(cell(testIds[1], first.id).locator('[data-status]')).toHaveAttribute('data-status', 'FAIL')
  await expect(cell(testIds[0], second.id).locator('[data-status]')).toHaveAttribute('data-status', 'BLOCKED')
  await expect(cell(testIds[2], second.id).locator('[data-status]')).toHaveAttribute('data-status', 'pending')
  await expect(cell(testIds[2], first.id)).toHaveText('·')
  await expect(cell(testIds[2], first.id).locator('[data-status]')).toHaveCount(0)
})

test('N10 — clic sur une cellule → détail de l\'entrée, puis résultat d\'exécution', async () => {
  await openDashboard()
  await cell(testIds[1], first.id).click()
  await expect(dialog()).toBeVisible()
  const rows = dialog().locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(first.runs[1].entryId)
  await rows.click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${first.id}/run/${first.runs[1].entryId}`))
})

test('N9 — une cellule vide n\'ouvre rien', async () => {
  await openDashboard()
  await cell(testIds[2], first.id).click()
  await expect(dialog()).toHaveCount(0)
})

test('N11 — clic sur l\'en-tête d\'une ligne → fiche du test', async () => {
  await openDashboard()
  await widget().locator('tbody th').getByRole('button', { name: testIds[2], exact: true }).click()
  await expect(s.page).toHaveURL(new RegExp(`/test/${testIds[2]}`))
})

test('N12 — clic sur l\'en-tête d\'une colonne → page campagne', async () => {
  await openDashboard()
  await widget().locator('thead').getByRole('button', { name: second.id, exact: true }).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${second.id}`))
})

test('N3 / L2 / L9 / L6 — popup : type Matrice, enregistrement bloqué tant que le mapping est incomplet', async () => {
  await openDashboard()
  await widget().getByTitle('Modifier le widget').click()
  const modal = s.page.locator('div.fixed').filter({ hasText: 'Modifier le widget' })
  await expect(modal.getByText('Lignes', { exact: true })).toBeVisible()
  // Aperçu : même rendu, rien de cliquable.
  await expect(modal.getByTestId('matrix-widget')).toBeVisible()
  await expect(modal.getByTestId('matrix-widget').getByRole('button')).toHaveCount(0)

  const columnsSelect = modal.locator('label', { hasText: /^Colonnes$/ }).locator('xpath=following-sibling::select')
  await columnsSelect.selectOption('')
  await expect(modal.getByText('Choisissez les lignes, les colonnes et la valeur.')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()

  // Colonne non-ID (titre) : en-têtes affichés mais pas cliquables.
  await columnsSelect.selectOption('campaignTitle')
  await modal.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(modal).toHaveCount(0)
  await expect(widget().locator('thead th').filter({ hasText: 'GH69 A' })).toBeVisible()
  await expect(widget().locator('thead').getByRole('button')).toHaveCount(0)
})
