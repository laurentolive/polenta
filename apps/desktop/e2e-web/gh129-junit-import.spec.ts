import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { testedVersionArg } from './support/demo-types'

/**
 * GH129 — run importé d'un rapport JUnit (specs/GH129-tests.md, scénario 25) : badge « Importé depuis
 * JUnit » sur la page du run, verdict affiché sans étape, colonne Origine de la section Exécutions.
 * Le run est écrit comme l'écrit l'import (`origin: junit-import`, sans étape), par le même service.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

let testId = ''
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
    name: 'gh129_auto', label: 'GH129 Auto', prefix: 'GHJ', category: 'test',
    fields: [{ name: 'automationId', label: 'Automation ID', type: 'text' }],
    statuses: [{ name: 'valide', isApproval: true }],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  testId = (await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH129 T', objectTypeRef: 'root::gh129_auto', fields: { automationId: 'tests.test_fan.test_gh129' },
    steps: [{ order: 1, action: 'Démarrer', expectedResult: 'Tourne', notes: '' }],
  }, workspaceDir)).id
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH129 e2e', testCaseIds: [testId] }, workspaceDir)
  const entry = campaign.runs[0]
  const run = await s.invoke<{ id: string }>('tests:execute', localPath, testId, {
    result: 'FAIL', stepResults: [], origin: 'junit-import', duration: 5,
    executedAt: '2026-11-07T10:00:00.000Z', executedBy: 'ci',
    notes: 'JUnit import\n\nsim32.xml · tests.test\\_fan.test\\_gh129 · FAIL · boom',
    campaignEntry: { campaignId: campaign.id, entryId: entry.entryId },
    ...await testedVersionArg(s),
  }, workspaceDir)
  await s.invoke('campaigns:update-run', localPath, campaign.id, entry.entryId, 'FAIL', run.id)
})

test('GH129-1 — page du run : badge « Importé depuis JUnit », verdict sans étape', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/run/${campaign.runs[0].entryId}`, { repoPath: s.project.localPath }))
  await expect(p.getByTestId('run-origin-badge')).toHaveText('Importé depuis JUnit')
  await expect(p.getByText('Échoué').first()).toBeVisible()
  await expect(p.getByText('sim32.xml', { exact: false }).first()).toBeVisible()
  await s.shot('gh129-run-page')
})

test('GH129-2 — section Exécutions du test : origine « import JUnit »', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/test/${testId}`, { repoPath: s.project.localPath }))
  const section = p.getByTestId('executions-section')
  await section.locator('summary').click()
  const row = section.getByTestId('execution-row')
  await expect(row).toHaveCount(1)
  await section.getByTestId('execution-columns-button').click()
  for (const key of ['origin', 'duration']) {
    const column = section.getByTestId(`execution-column-${key}`)
    if (!(await column.isChecked())) await column.click()
    await expect(column).toBeChecked()
  }
  await expect(row).toContainText('import JUnit')
  await expect(row).toContainText('5 s')
})
