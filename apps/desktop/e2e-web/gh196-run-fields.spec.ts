import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH196 — champs d'exécution et d'étape (specs/GH196-tests.md, scénario 14) : saisie sur la page
 * d'exécution, astérisque selon le verdict, refus du main puis enregistrement, consultation du run.
 * Un type de test dédié (préfixe GHR, statut approuvé d'emblée) et une campagne sont créés par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/, /status of 500/, /obligatoire quand/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }
interface RunLike { id: string; result: string; fields?: Record<string, unknown>; stepResults: Array<{ order: number; fields?: Record<string, unknown> }> }

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
    name: 'gh196_essai', label: 'GH196 Essai', prefix: 'GHR', category: 'test', fields: [],
    statuses: [{ name: 'valide', isApproval: true }],
    runFields: [{ name: 'gh196Report', label: 'Rapport GH196', type: 'text', requiredWhen: { result: ['FAIL'] } }],
    stepFields: [{ name: 'gh196Measure', label: 'Mesure GH196', type: 'number' }],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  const tc = await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH196 T', objectTypeRef: 'root::gh196_essai', fields: {},
    steps: [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }],
  }, workspaceDir)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH196 e2e', testCaseIds: [tc.id] }, workspaceDir)
})

test('GH196-1 — page d\'exécution : champ requis sur FAIL, refus, puis run écrit avec ses champs', async () => {
  const p = s.page
  const { localPath } = s.project
  const entry = campaign.runs[0]!
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))

  const runFields = p.getByTestId('run-fields')
  await expect(runFields).toContainText('Rapport GH196')
  await expect(p.getByTestId('step-fields-1')).toHaveCount(0)        // étape non exécutée (Q3)

  await p.getByRole('combobox').first().selectOption({ label: 'Échoué' })   // verdict de l'étape 1
  await expect(p.getByTestId('step-fields-1')).toBeVisible()
  await expect(runFields.locator('label', { hasText: 'Rapport GH196' })).toContainText('*')

  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect(p.getByText('« Rapport GH196 » est obligatoire quand Verdict = Échoué')).toBeVisible()

  await runFields.locator('input').first().fill('RE-196')
  await p.getByTestId('step-fields-1').locator('input').first().fill('13.1')
  await s.shot('gh196-execute')
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await p.waitForURL(url => !url.pathname.includes('/execute/'))

  const runs = await s.invoke<RunLike[]>('tests:runs', localPath, entry.testCaseId)
  expect(runs).toHaveLength(1)
  expect(runs[0].result).toBe('FAIL')
  expect(runs[0].fields).toEqual({ gh196Report: 'RE-196' })
  expect(runs[0].stepResults[0].fields).toEqual({ gh196Measure: 13.1 })

  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/run/${entry.entryId}`, { repoPath: localPath }))
  await expect(p.getByTestId('run-field-values').filter({ hasText: 'Mesure GH196' })).toContainText('13.1')
  await expect(p.getByTestId('run-field-values').filter({ hasText: 'Rapport GH196' })).toContainText('RE-196')
})
