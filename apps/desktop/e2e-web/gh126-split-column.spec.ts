import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH126 sprint 1 — colonne calculée éclatée (`splitColumn`) : une sous-colonne par campagne dans la
 * Vue Système des tests (groupe dans ⚙️, une case par sous-colonne, ordre du script, pref par
 * sous-colonne, valeurs, infobulle d'en-tête, nouvelle campagne, campagne supprimée, erreur, Vue
 * Document) et saisie dans la vue Requêtes (specs/GH126-tests.md T21–T39).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string }> }
interface SchemaNode { objectTypes?: Array<{ label: string; prefix: string; category: string }>; children?: SchemaNode[] }

const GROUP = 'GH126 par campagne'
// Une ligne par entrée des campagnes « GH126 … » (ordre de création) : statut de l'entrée.
const SCRIPT = `export default (data) => {
  const rows = []
  const cs = data.campaigns.filter((c) => c.title.startsWith('GH126 ')).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  for (const c of cs) for (const e of c.entries) rows.push({ id: e.testCaseId, value: e.status, campaignId: c.id, campaignTitle: c.title, tooltip: c.id + ' — ' + c.title, _ids: [c.id + '/' + e.entryId] })
  return rows
}
`
let username = ''
let testId = ''
let otherTestId = ''
let typeLabel = ''
let queryId = ''
let a: Campaign
let b: Campaign

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  testId = tests[0].id
  otherTestId = tests[1].id
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', localPath)
  const types = (nodes: SchemaNode[]): Array<{ label: string; prefix: string }> => nodes.flatMap((n) => [...(n.objectTypes ?? []), ...types(n.children ?? [])])
  typeLabel = types(schema.nodes).find((t) => t.prefix === testId.replace(/-\d+$/, ''))!.label

  a = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH126 Alpha', testCaseIds: [testId, otherTestId] }, workspaceDir)
  await s.invoke('campaigns:update', localPath, a.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, a.id, a.runs.find((r) => r.testCaseId === testId)!.entryId, 'FAIL')
  b = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH126 Beta', testCaseIds: [otherTestId] }, workspaceDir)

  const q = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH126 éclatée', scope: 'shared', createdBy: username, script: SCRIPT,
    column: {
      label: GROUP, appliesTo: { categories: ['test'], objectTypes: [] }, type: 'enum',
      values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending'], splitColumn: 'campaignId', splitLabelColumn: 'campaignTitle',
    },
  })
  queryId = q.id
})

const row = (id = testId) => s.page.locator('tr').filter({ hasText: id }).first()
const header = (label: string) => s.page.locator('th').filter({ hasText: label })
const modal = () => s.page.locator('.fixed.inset-0.z-50')
const group = () => modal().getByTestId('field-config-computed-group')

async function openTests(mode: 'Vue tableau' | 'Vue document') {
  await s.openView('Tests')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel)
  await combo.press('Enter')
  await s.page.getByTitle(mode).click()
  await s.page.waitForLoadState('networkidle')
}

async function toggleSub(tab: 'Tableau' | 'Document', label: string) {
  await s.page.getByTitle('Configurer les colonnes').click()
  await modal().getByRole('button', { name: tab, exact: true }).click()
  await group().getByRole('checkbox', { name: label }).click()
  await modal().click({ position: { x: 5, y: 5 } })
}

/** Cellule d'une sous-colonne (clé `query::<ID>::<campagne>`) sur la ligne d'un test. */
async function cell(label: string, id = testId) {
  const campaignId = ({ 'GH126 Alpha': a.id, 'GH126 Beta': b.id } as Record<string, string>)[label]
  return row(id).locator(`[data-computed-cell="query::${queryId}::${campaignId}"]`)
}

const pref = () => JSON.parse(fs.readFileSync(path.join(s.project.localPath, `.${username}.pref`), 'utf8')) as { fieldVisibility: Record<string, { excel?: string[] }> }

test('T21 — ⚙️ : groupe et une case par campagne, dans l\'ordre du script, décochées', async () => {
  await openTests('Vue tableau')
  await s.page.getByTitle('Configurer les colonnes').click()
  await expect(group()).toContainText(GROUP)
  const boxes = group().getByRole('checkbox')
  await expect(boxes).toHaveCount(2, { timeout: 15_000 })
  await expect(group().locator('label')).toHaveText(['GH126 Alpha', 'GH126 Beta'])
  for (const box of await boxes.all()) await expect(box).not.toBeChecked()
  await s.shot('gh126-field-config-group')
  await modal().click({ position: { x: 5, y: 5 } })
})

test('T23 / T25 / T26 — deux sous-colonnes cochées : en-têtes, valeurs, pref par sous-colonne, infobulle', async () => {
  await openTests('Vue tableau')
  await toggleSub('Tableau', 'GH126 Alpha')
  await toggleSub('Tableau', 'GH126 Beta')
  await expect(header('GH126 Alpha')).toBeVisible()
  await expect(header('GH126 Beta')).toBeVisible()
  await expect(await cell('GH126 Alpha')).toHaveText('FAIL', { timeout: 15_000 })
  // Test absent de Beta : cellule vide ; test présent non exécuté : pending.
  await expect(await cell('GH126 Beta')).toHaveText('')
  await expect(await cell('GH126 Beta', otherTestId)).toHaveText('pending')
  await expect(header('GH126 Alpha').locator('[title]').filter({ hasText: '(calc)' })).toHaveAttribute('title', `${GROUP} — GH126 Alpha`)
  const excel = Object.values(pref().fieldVisibility).flatMap((v) => v.excel ?? [])
  expect(excel).toEqual(expect.arrayContaining([`query::${queryId}::${a.id}`, `query::${queryId}::${b.id}`]))
  await s.shot('gh126-excel-split')
})

test('T24 — rechargement : les sous-colonnes restent affichées', async () => {
  await s.page.reload()
  await openTests('Vue tableau')
  await expect(header('GH126 Alpha')).toBeVisible()
  await expect(await cell('GH126 Alpha')).toHaveText('FAIL', { timeout: 15_000 })
})

test('T27 / T29 — double-clic : entrée de campagne ; cellule en lecture seule', async () => {
  await openTests('Vue tableau')
  const c = await cell('GH126 Alpha')
  await expect(c).toHaveText('FAIL', { timeout: 15_000 })
  await c.click()
  await s.page.keyboard.press('F2')
  await expect(c.locator('textarea, select, input')).toHaveCount(0)
  await c.dblclick()
  await expect(s.page.getByText('Retour à la campagne')).toBeVisible({ timeout: 15_000 })
})

test('T28 — filtre de colonne propre à la sous-colonne', async () => {
  await openTests('Vue tableau')
  await header('GH126 Alpha').getByTitle('Filtrer cette colonne').click()
  const input = s.page.locator('[data-column-filter-popover]').getByPlaceholder('Filtrer…')
  await input.fill('FAIL')
  await expect(row()).toBeVisible()
  await expect(s.page.locator('tr').filter({ hasText: otherTestId })).toHaveCount(0)
  await input.fill('')
  await s.page.keyboard.press('Escape')
})

test('T30 / T31 — résultat saisi et nouvelle campagne : mis à jour sans recharger', async () => {
  const { localPath, workspaceDir } = s.project
  await openTests('Vue tableau')
  await expect(await cell('GH126 Beta', otherTestId)).toHaveText('pending', { timeout: 15_000 })
  await s.invoke('campaigns:update', localPath, b.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, b.id, b.runs[0].entryId, 'PASS')
  await expect(await cell('GH126 Beta', otherTestId)).toHaveText('PASS', { timeout: 20_000 })

  await s.invoke('campaigns:create', localPath, { title: 'GH126 Gamma', testCaseIds: [testId] }, workspaceDir)
  await s.page.getByTitle('Configurer les colonnes').click()
  await expect(group().locator('label')).toHaveText(['GH126 Alpha', 'GH126 Beta', 'GH126 Gamma'], { timeout: 20_000 })
  await expect(group().getByRole('checkbox', { name: 'GH126 Gamma' })).not.toBeChecked()
  await modal().click({ position: { x: 5, y: 5 } })
})

test('T34 — Vue Document : sous-colonne cochée dans l\'onglet Document', async () => {
  await openTests('Vue document')
  await toggleSub('Document', 'GH126 Alpha')
  await expect(s.page.locator('[data-computed-field]').filter({ hasText: 'GH126 Alpha' }).filter({ hasText: 'FAIL' }).first()).toBeVisible({ timeout: 15_000 })
  await s.shot('gh126-word-split')
})

test('T32 — campagne supprimée : sa sous-colonne disparaît, préférence conservée', async () => {
  await openTests('Vue tableau')
  await expect(header('GH126 Beta')).toBeVisible()
  await s.invoke('campaigns:delete', s.project.localPath, b.id)
  await expect(header('GH126 Beta')).toHaveCount(0, { timeout: 20_000 })
  await expect(header('GH126 Alpha')).toBeVisible()
  const excel = Object.values(pref().fieldVisibility).flatMap((v) => v.excel ?? [])
  expect(excel).toContain(`query::${queryId}::${b.id}`)
})

test('T33 — script en erreur : ⚠ dans l\'en-tête et dans le groupe, vue utilisable', async () => {
  const { localPath } = s.project
  await s.invoke('queries:update', localPath, username, queryId, { script: "export default () => { throw new Error('boom GH126') }\n" })
  await openTests('Vue tableau')
  // Pas de résultat : colonne de substitution (libellé du dernier résultat valide, sinon l'ID de la
  // campagne), ⚠ dans l'en-tête.
  const alpha = s.page.locator('th').filter({ hasText: new RegExp(`GH126 Alpha|${a.id}`) })
  await expect(alpha.getByTestId('computed-column-error')).toHaveAttribute('title', /boom GH126/, { timeout: 20_000 })
  await expect(row()).toBeVisible()
  await s.page.getByTitle('Configurer les colonnes').click()
  await expect(group().getByTestId('field-config-computed-group-error')).toHaveAttribute('title', /boom GH126/)
  // Toujours décochable dans ⚙️ ; la campagne supprimée (Beta) n'est pas ressuscitée.
  await expect(group().getByRole('checkbox', { name: new RegExp(`GH126 Alpha|${a.id}`) })).toBeChecked()
  await expect(group().getByRole('checkbox', { name: new RegExp(`GH126 Beta|${b.id}`) })).toHaveCount(0)
  await modal().click({ position: { x: 5, y: 5 } })
  await s.invoke('queries:update', localPath, username, queryId, { script: SCRIPT })
})

test('T47 — modèle « Résultat par campagne » : une sous-colonne par campagne, valeurs', async () => {
  const { localPath } = s.project
  const q = await s.invoke<{ id: string; column: { splitColumn?: string } }>('queries:create', localPath, username, {
    title: 'GH126 modèle', scope: 'shared', createdBy: username, template: { id: 'campaign-results', params: {} },
  })
  expect(q.column.splitColumn).toBe('campaignId')
  const groupOf = () => modal().locator(`[data-testid="field-config-computed-group"][data-query-id="${q.id}"]`)
  // Bibliothèque livrée v4 (copiée au premier accès, ou mise à jour proposée par le bandeau).
  expect(fs.readFileSync(path.join(localPath, 'dashboards', 'lib', 'campaign.js'), 'utf8')).toMatch(/^\/\/ @polenta-lib campaign 4/)

  await openTests('Vue tableau')
  await s.page.getByTitle('Configurer les colonnes').click()
  await expect(groupOf()).toContainText('Résultat par campagne')
  await expect(groupOf().getByTestId('field-config-computed-group-error')).toHaveCount(0, { timeout: 20_000 })
  await expect(groupOf().getByRole('checkbox', { name: 'GH126 Alpha' })).toBeVisible()
  expect(await groupOf().getByRole('checkbox').count()).toBeGreaterThan(1)
  await groupOf().getByRole('checkbox', { name: 'GH126 Alpha' }).click()
  await modal().click({ position: { x: 5, y: 5 } })
  await expect(row().locator(`[data-computed-cell="query::${q.id}::${a.id}"]`)).toHaveText('FAIL', { timeout: 15_000 })
  await s.shot('gh126-template-split')
})

test('T38 / T39 — vue Requêtes : « Une colonne par valeur de », enregistrée puis retirée', async () => {
  const q = await s.invoke<{ id: string }>('queries:create', s.project.localPath, username, {
    title: 'GH126 entrées', scope: 'shared', createdBy: username, template: { id: 'campaign-entries', params: {} },
  })
  const file = path.join(s.project.localPath, 'queries', q.id, 'query.yaml')
  const column = () => (yaml.load(fs.readFileSync(file, 'utf8')) as { column?: Record<string, unknown> }).column
  await s.openView('Suivi')
  await s.page.getByText('GH126 entrées', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
  const editor = s.page.getByTestId('column-decl-editor')
  await editor.getByTestId('column-decl-enable').check()
  await expect(editor.getByTestId('column-decl-idColumn').locator('option', { hasText: 'testCaseId' })).toHaveCount(1, { timeout: 15_000 })
  await editor.getByTestId('column-decl-idColumn').selectOption('testCaseId')
  await editor.getByTestId('column-decl-valueColumn').selectOption('status')
  await editor.getByTestId('column-decl-split-enable').check()
  await editor.getByTestId('column-decl-splitColumn').selectOption('campaignId')
  await editor.getByTestId('column-decl-splitLabelColumn').selectOption('campaignTitle')
  await expect(editor.getByTestId('column-decl-errors')).toHaveCount(0)
  await s.page.getByRole('button', { name: 'Sauvegarder', exact: true }).click()
  await expect.poll(column).toMatchObject({ splitColumn: 'campaignId', splitLabelColumn: 'campaignTitle' })
  await s.shot('gh126-query-editor')

  await editor.getByTestId('column-decl-split-enable').uncheck()
  await s.page.getByRole('button', { name: 'Sauvegarder', exact: true }).click()
  await expect.poll(() => column()?.splitColumn ?? null).toBeNull()
  expect(column()).not.toHaveProperty('splitLabelColumn')
})
