import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH81 — plus d'écriture du fichier de campagne sur une consultation : l'ouverture de la page
 * d'exécution et l'export du classeur affichent l'état actuel d'un test non approuvé sans toucher
 * la copie ; la saisie fige la version affichée, même si le test a changé entre-temps (scénarios
 * E1, E2, E6, E7 de specs/GH81-tests.md). Tests brouillons et campagne créés par IPC.
 */
const s = setupSession()

interface Step { order: number; action: string; expectedResult: string; notes: null }
interface TestCaseLike { id: string; objectTypeRef: string; status: string; fields: Record<string, unknown>; steps?: Step[] }
interface Run { entryId: string; testCaseId: string; status: string; testSnapshot?: TestCaseLike }
interface Campaign { id: string; runs: Run[] }
interface TypeLike { name: string; category: string; statuses?: Array<{ name: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let executed: TestCaseLike
let exported: TestCaseLike
let campaign: Campaign

const steps = (name: string, v: number): Step[] => [{ order: 1, action: `Action GH81 ${name} v${v}`, expectedResult: 'OK', notes: null }]

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const entryOf = async (testCaseId: string) =>
  (await s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)).runs.find(r => r.testCaseId === testCaseId)!
const actionOf = async (testCaseId: string) => (await entryOf(testCaseId)).testSnapshot?.steps?.[0]?.action

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
    title: `GH81 test ${name}`, objectTypeRef: model!.objectTypeRef, steps: steps(name, 1), fields: model!.fields,
  }, workspaceDir)
  executed = await create('exec')
  exported = await create('export')
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH81 consultation', testCaseIds: [] }, workspaceDir)
  campaign = await s.invoke<Campaign>('campaigns:add-tests', localPath, campaign.id, [executed.id, exported.id], {}, workspaceDir)
})

test('E1–E2 — ouverture sans écriture ; la saisie fige la version affichée malgré une modification', async () => {
  const p = s.page
  const { localPath, workspaceDir } = s.project
  await s.invoke('tests:update', localPath, executed.id, { steps: steps('exec', 2) }, workspaceDir)
  const entry = await entryOf(executed.id)

  // E1 — version actuelle affichée, copie inchangée.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))
  await expect(p.getByText('Action GH81 exec v2')).toBeVisible()
  expect(await actionOf(executed.id)).toBe('Action GH81 exec v1')

  // E2 — le test change pendant la saisie : c'est la version affichée (v2) qui est figée.
  await s.invoke('tests:update', localPath, executed.id, { steps: steps('exec', 3) }, workspaceDir)
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await p.getByRole('button', { name: 'Exécuter quand même' }).click()
  await p.waitForURL(new RegExp(`/campaign/${campaign.id}(\\?|$)`))
  const after = await entryOf(executed.id)
  expect(after.status).not.toBe('pending')
  expect(after.testSnapshot?.steps?.[0]?.action).toBe('Action GH81 exec v2')
  await s.shot('gh81-e2-version-affichee-figee')
})

test('E6 — téléchargement du classeur d\'exécution sans écriture de la campagne', async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('tests:update', localPath, exported.id, { steps: steps('export', 2) }, workspaceDir)
  const result = await s.invoke<{ status: string }>('web:execution-sheet-export', localPath, campaign.id, 'fr')
  expect(result.status).toBe('ok')
  expect(await actionOf(exported.id)).toBe('Action GH81 export v1')
})

test('E7 — la resynchronisation à la consultation n\'est plus exposée', async () => {
  // Channel hors liste blanche : le serveur répond 404, ce que le navigateur journalise.
  s.allowConsoleErrors(/status of 404 \(Not Found\)/)
  await expect(s.invoke('campaigns:refresh-entries', s.project.localPath, campaign.id, [])).rejects.toThrow()
})
