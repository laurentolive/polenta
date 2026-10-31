import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH197 — grille d'historique des exécutions (specs/GH197-tests.md, scénarios 7–8) : section
 * « Exécutions » d'un test et d'une exigence, colonne d'un champ d'exécution, dépliage des étapes.
 * Type de test dédié (préfixe GHH), exigence, lien et campagne créés par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

let testId = ''
let reqId = ''
let campaign: Campaign

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh197_essai', label: 'GH197 Essai', prefix: 'GHH', category: 'test', fields: [],
    statuses: [{ name: 'valide', isApproval: true }],
    runFields: [{ name: 'gh197Temp', label: 'Température GH197', type: 'number' }],
    stepFields: [{ name: 'gh197Mesure', label: 'Mesure GH197', type: 'number' }],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  testId = (await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH197 T', objectTypeRef: 'root::gh197_essai', fields: {},
    steps: [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }],
  }, workspaceDir)).id
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH197 e2e', testCaseIds: [testId] }, workspaceDir)
  const entry = campaign.runs[0]
  const run = await s.invoke<{ id: string }>('tests:execute', localPath, testId, {
    result: 'FAIL', fields: { gh197Temp: '23,5' },
    stepResults: [{ order: 1, result: 'FAIL', comment: 'trop bas', fields: { gh197Mesure: '11.2' } }],
    campaignEntry: { campaignId: campaign.id, entryId: entry.entryId },
  }, workspaceDir)
  await s.invoke('campaigns:update-run', localPath, campaign.id, entry.entryId, 'FAIL', run.id)
  // Exigence couverte par le test (premier type de lien du schéma, sens test → exigence).
  const reqTypes = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'requirement').map(t => `${n.name}::${t.name}`))
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: reqTypes[0], title: 'GH197 R' })).id
  await s.invoke('requirements:link-create', localPath, { type: schema.linkTypes?.[0]?.name ?? 'verification', sourceId: testId, targetId: reqId })
})

test('GH197-1 — test : section Exécutions, colonne d\'un champ d\'exécution, étapes', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/test/${testId}`, { repoPath: s.project.localPath }))
  const section = p.getByTestId('executions-section')
  await section.locator('summary').click()
  await expect(section.locator('summary')).toContainText('(1)')
  const row = section.getByTestId('execution-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(campaign.id)

  await section.getByTestId('execution-columns-button').click()
  // React Query notifie ses abonnés en différé : clic, puis attente de l'état coché.
  const tempColumn = section.getByTestId('execution-column-run:gh197Temp')
  await tempColumn.click()
  await expect(tempColumn).toBeChecked()
  await expect(section.locator('th', { hasText: 'Température GH197' })).toBeVisible()
  await expect(row).toContainText('23.5')

  await row.getByRole('button', { name: 'Afficher les étapes' }).click()
  const step = section.getByTestId('execution-step-row')
  await expect(step).toContainText('trop bas')
  await expect(step).toContainText('11.2')
  await s.shot('gh197-test-history')
})

test('GH197-2 — exigence : exécutions du test qui la couvre', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/req/${reqId}`, { repoPath: s.project.localPath }))
  const section = p.getByTestId('executions-section')
  await section.locator('summary').click()
  await expect(section.getByTestId('execution-row')).toHaveCount(1)
  await expect(section.getByTestId('execution-row')).toContainText(testId)
})
