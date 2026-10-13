import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH80 — page d'exécution réutilisée d'une entrée à l'autre : passer de `/execute/<A>` à
 * `/execute/<B>` sans démontage doit resynchroniser la copie de B et afficher B, pas la version
 * figée de A. Deux tests brouillons et la campagne sont créés par IPC ; la navigation passe par
 * l'historique (même route, seul le paramètre change).
 */
const s = setupSession()

interface Step { order: number; action: string; expectedResult: string; notes: null }
interface TestCaseLike { id: string; objectTypeRef: string; status: string; fields: Record<string, unknown>; steps?: Step[] }
interface Run { entryId: string; testCaseId: string; status: string; testSnapshot?: TestCaseLike }
interface Campaign { id: string; runs: Run[] }
interface TypeLike { name: string; category: string; statuses?: Array<{ name: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let testA: TestCaseLike
let testB: TestCaseLike
let campaign: Campaign

const steps = (name: string, v: number): Step[] => [{ order: 1, action: `Action GH80 ${name} v${v}`, expectedResult: 'OK', notes: null }]

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const entryOf = async (testCaseId: string) =>
  (await s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)).runs.find(r => r.testCaseId === testCaseId)!

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  // Un test approuvé d'un type à statut d'approbation sert de modèle (type et champs requis).
  let model: TestCaseLike | undefined
  for (const node of schema.nodes) {
    for (const type of node.objectTypes ?? []) {
      const approval = type.statuses?.find(st => st.isApproval)?.name
      if (type.category !== 'test' || !approval) continue
      model = tests.find(t => t.objectTypeRef === `${node.name}::${type.name}` && t.status === approval)
      if (model) break
    }
    if (model) break
  }
  test.skip(!model, 'la démo doit avoir un test approuvé dans un type à statut d\'approbation')

  const create = (name: string) => s.invoke<TestCaseLike>('tests:create', localPath, {
    title: `GH80 test ${name}`, objectTypeRef: model!.objectTypeRef, steps: steps(name, 1), fields: model!.fields,
  }, workspaceDir)
  testA = await create('A')
  testB = await create('B')
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH80 exécution', testCaseIds: [] }, workspaceDir)
  campaign = await s.invoke<Campaign>('campaigns:add-tests', localPath, campaign.id, [testA.id, testB.id], {}, workspaceDir)
})

test('X1 — de l\'entrée A à l\'entrée B : B resynchronisée et affichée', async () => {
  const p = s.page
  const { localPath, workspaceDir } = s.project
  await s.invoke('tests:update', localPath, testA.id, { steps: steps('A', 2) }, workspaceDir)
  await s.invoke('tests:update', localPath, testB.id, { steps: steps('B', 2) }, workspaceDir)
  const entryA = await entryOf(testA.id)
  const entryB = await entryOf(testB.id)
  expect(entryB.testSnapshot?.steps?.[0]?.action).toBe('Action GH80 B v1')

  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entryA.entryId}`, { repoPath: localPath }))
  await expect(p.getByText('Action GH80 A v2')).toBeVisible()

  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entryB.entryId}`, { repoPath: localPath }))
  await expect(p.getByText('Action GH80 B v2')).toBeVisible()
  await expect(p.getByText(/Action GH80 A/)).toHaveCount(0)
  await expect(p.getByTestId('execute-test-changed')).toHaveCount(0)
  expect((await entryOf(testB.id)).testSnapshot?.steps?.[0]?.action).toBe('Action GH80 B v2')
  await s.shot('gh80-x1-entree-b')
})
