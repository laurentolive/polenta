import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH65 sprint 1 — avancement des campagnes dans la vue Suivi : table `campaign_entries`, dashboard
 * « Campagnes » privé seedé, rafraîchissement sans action. Scénarios 1.1, 1.7, 1.10 de
 * specs/GH65-tests.md. La campagne est créée par le test (indépendant du contenu de la démo).
 */
const s = setupSession()

interface Campaign { id: string; runs: Array<{ entryId: string; status: string }> }
interface Dashboard { id: string; title: string; scope: string; widgets: Array<{ title: string; type: string }> }

let campaign: Campaign
let username: string

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  expect(tests.length).toBeGreaterThanOrEqual(4)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, {
    title: 'GH65 e2e',
    testCaseIds: tests.slice(0, 4).map(t => t.id),
  }, workspaceDir)
  const [e1, e2, e3] = campaign.runs.map(r => r.entryId)
  await s.invoke('campaigns:update-run', localPath, campaign.id, e1, 'PASS')
  await s.invoke('campaigns:update-run', localPath, campaign.id, e2, 'PASS')
  await s.invoke('campaigns:update-run', localPath, campaign.id, e3, 'FAIL')
  username = await s.invoke<string>('auth:project-username', localPath)
})

test('1.1 — campaign_entries : décompte par statut d\'une campagne', async () => {
  const { localPath, workspaceDir } = s.project
  const result = await s.invoke<{ rows: Array<{ status: string; n: number }> }>('queries:execute', localPath, {
    mode: 'sql',
    sqlText: `SELECT status, COUNT(*) AS n FROM campaign_entries WHERE campaignId = '${campaign.id}' GROUP BY status`,
  }, workspaceDir)
  expect(Object.fromEntries(result.rows.map(r => [r.status, r.n]))).toEqual({ PASS: 2, FAIL: 1, pending: 1 })
})

test('1.7 — dashboard « Campagnes » privé créé à l\'ouverture de Suivi', async () => {
  await s.openView('Suivi')
  const dashboards = await s.invoke<Dashboard[]>('dashboards:list', s.project.localPath, username, 'fr')
  const seeded = dashboards.filter(d => d.title === 'Campagnes')
  expect(seeded).toHaveLength(1)
  expect(seeded[0].scope).toBe('private')
  expect(seeded[0].widgets.map(w => w.type)).toEqual(['bar', 'kpi', 'kpi', 'line', 'table'])
  // Rien d'écrit dans le repo : ni dashboard ni requête partagés « Campagnes ».
  expect(dashboards.filter(d => d.scope === 'shared').map(d => d.title)).not.toContain('Campagnes')
})

test('1.10 — un résultat saisi met à jour le dashboard ouvert sans action', async () => {
  const { localPath } = s.project
  await s.openView('Suivi')
  await s.page.getByText('Campagnes', { exact: true }).click()
  await s.page.waitForLoadState('networkidle')

  const failures = s.page.locator('div.h-64').filter({ hasText: 'Entrées en échec' })
  const rowsOfCampaign = failures.locator('tbody tr').filter({ hasText: campaign.id })
  await expect(rowsOfCampaign).toHaveCount(1)

  const pending = campaign.runs[3].entryId
  await s.invoke('campaigns:update-run', localPath, campaign.id, pending, 'BLOCKED')
  await expect(rowsOfCampaign).toHaveCount(2, { timeout: 15_000 })
  await expect(rowsOfCampaign.filter({ hasText: pending })).toContainText('BLOCKED')
})
