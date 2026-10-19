import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH70 sprint 2 — colonne calculée « Dernier résultat » dans la Vue Système des tests : proposée dans
 * ⚙️, valeur et infobulle, ouverture de l'entrée, mise à jour sans rechargement, filtre de colonne,
 * lecture seule, Vue Document, erreur du script (specs/GH70-tests.md N4–N11, C6, C12, C14).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string }> }
interface SchemaNode { objectTypes?: Array<{ label: string; prefix: string; category: string }>; children?: SchemaNode[] }

const CAMPAIGN_TITLE = 'GH70 campagne'
let username = ''
let testId = ''
let typeLabel = ''
let queryId = ''
let campaign: Campaign

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  testId = tests[0].id
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', localPath)
  const types = (nodes: SchemaNode[]): Array<{ label: string; prefix: string }> => nodes.flatMap((n) => [...(n.objectTypes ?? []), ...types(n.children ?? [])])
  typeLabel = types(schema.nodes).find((t) => t.prefix === testId.replace(/-\d+$/, ''))!.label

  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: CAMPAIGN_TITLE, testCaseIds: [testId] }, workspaceDir)
  await s.invoke('campaigns:update', localPath, campaign.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, campaign.id, campaign.runs[0].entryId, 'FAIL')

  const q = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH70 dernier résultat', scope: 'shared', createdBy: username, template: { id: 'campaign-last-result', params: {} },
  })
  queryId = q.id
})

const row = () => s.page.locator('tr').filter({ hasText: testId }).first()
const computedCell = () => row().locator('[data-computed-cell]')

async function openTests(mode: 'Vue tableau' | 'Vue document') {
  await s.openView('Tests')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel)
  await combo.press('Enter')
  await s.page.getByTitle(mode).click()
  await s.page.waitForLoadState('networkidle')
}

async function toggleColumn(tab: 'Tableau' | 'Document', label: string) {
  await s.page.getByTitle('Configurer les colonnes').click()
  const modal = s.page.locator('.fixed.inset-0.z-50')
  await modal.getByRole('button', { name: tab, exact: true }).click()
  await modal.getByTestId('field-config-computed').getByRole('checkbox', { name: new RegExp(label) }).click()
  await modal.click({ position: { x: 5, y: 5 } })
}

test('N4 / N5 / N6 / N7 — proposée dans ⚙️, décochée ; cochée : valeur et infobulle ; pref par type', async () => {
  await openTests('Vue tableau')
  await s.page.getByTitle('Configurer les colonnes').click()
  const section = s.page.getByTestId('field-config-computed')
  await expect(section).toBeVisible()
  await expect(section.getByRole('checkbox', { name: /Dernier résultat/ })).not.toBeChecked()
  await s.page.locator('.fixed.inset-0.z-50').click({ position: { x: 5, y: 5 } })

  await toggleColumn('Tableau', 'Dernier résultat')
  await expect(s.page.locator('th').filter({ hasText: 'Dernier résultat' })).toBeVisible()
  await expect(computedCell()).toHaveText('FAIL', { timeout: 15_000 })
  await expect(computedCell()).toHaveAttribute('title', new RegExp(`${campaign.id} — ${CAMPAIGN_TITLE}`))
  const pref = JSON.parse(fs.readFileSync(path.join(s.project.localPath, `.${username}.pref`), 'utf8')) as { fieldVisibility: Record<string, { excel?: string[] }> }
  expect(Object.values(pref.fieldVisibility).some((v) => v.excel?.includes(`query::${queryId}`))).toBe(true)
  await s.shot('gh70-excel-column')
})

test('C14 — cellule calculée en lecture seule (F2 sans éditeur)', async () => {
  await openTests('Vue tableau')
  await computedCell().click()
  await s.page.keyboard.press('F2')
  await expect(computedCell().locator('textarea, select, input')).toHaveCount(0)
})

test('N10 — filtre de colonne (T51) sur la valeur affichée', async () => {
  await openTests('Vue tableau')
  const header = s.page.locator('th').filter({ hasText: 'Dernier résultat' })
  await header.getByTitle('Filtrer cette colonne').click()
  const input = s.page.locator('[data-column-filter-popover]').getByPlaceholder('Filtrer…')
  await expect(input).toBeVisible()
  await input.fill('PASS')
  await expect(s.page.locator('tr').filter({ hasText: testId })).toHaveCount(0)
  await input.fill('FAIL')
  await expect(row()).toBeVisible()
  await s.page.keyboard.press('Escape')
})

test('N9 — résultat saisi dans une autre campagne : cellule mise à jour sans rechargement', async () => {
  await openTests('Vue tableau')
  await expect(computedCell()).toHaveText('FAIL', { timeout: 15_000 })
  const { localPath, workspaceDir } = s.project
  const second = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH70 seconde', testCaseIds: [testId] }, workspaceDir)
  await s.invoke('campaigns:update', localPath, second.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, second.id, second.runs[0].entryId, 'PASS')
  await expect(computedCell()).toHaveText('PASS', { timeout: 20_000 })
  await expect(computedCell()).toHaveAttribute('title', new RegExp(second.id))
})

test('N8 — double-clic : ouverture de la campagne de l\'entrée', async () => {
  await openTests('Vue tableau')
  await expect(computedCell()).toHaveText('PASS', { timeout: 15_000 })
  await computedCell().dblclick()
  // Entrée ouverte sur son statut brut (même navigation que le drill-down des widgets).
  await expect(s.page.getByText('Retour à la campagne')).toBeVisible({ timeout: 15_000 })
  await expect(s.page.getByText(testId, { exact: true }).first()).toBeVisible()
  await expect(s.page.getByText('Passé', { exact: true }).first()).toBeVisible()
})

test('N11 — Vue Document : valeur dans la carte si cochée dans l\'onglet Document', async () => {
  await openTests('Vue document')
  await toggleColumn('Document', 'Dernier résultat')
  const field = s.page.locator('[data-computed-field]').filter({ hasText: 'Dernier résultat' }).first()
  await expect(field).toBeVisible()
  await expect(s.page.locator('[data-computed-field]').filter({ hasText: 'PASS' }).first()).toBeVisible({ timeout: 15_000 })
  await s.shot('gh70-word-column')
})

test('C6 / C12 — script en erreur : vue utilisable, ⚠ dans l\'en-tête ; requête supprimée : colonne retirée', async () => {
  const { localPath } = s.project
  const broken = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH70 cassée', scope: 'shared', createdBy: username, script: "export default () => { throw new Error('boom GH70') }\n",
    column: { label: 'Colonne cassée', appliesTo: { categories: ['test'], objectTypes: [] }, type: 'text' },
  })
  await openTests('Vue tableau')
  await toggleColumn('Tableau', 'Colonne cassée')
  const header = s.page.locator('th').filter({ hasText: 'Colonne cassée' })
  await expect(header.getByTestId('computed-column-error')).toHaveAttribute('title', /boom GH70/, { timeout: 15_000 })
  await expect(row()).toBeVisible()

  await s.invoke('queries:delete', localPath, username, broken.id)
  await expect(s.page.locator('th').filter({ hasText: 'Colonne cassée' })).toHaveCount(0, { timeout: 20_000 })
})
