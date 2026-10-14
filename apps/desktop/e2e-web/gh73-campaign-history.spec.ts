import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH73 — faits bruts de l'historique daté des campagnes, par le vrai client web : run rattaché à
 * l'entrée exécutée depuis la page d'exécution, entrée retirée conservée dans `removedRuns`,
 * saisie sans run refusée. Scénarios 1.5, 1.6, 3.11, 3.12, 4.4 de specs/GH73-tests.md. La campagne
 * est créée par le test, sur deux tests approuvés de la démo (pas de confirmation GH68).
 */
const s = setupSession()

interface Entry { entryId: string; testCaseId: string; status: string; runId?: string; addedAt?: string; removedAt?: string }
interface Campaign { id: string; createdAt: string; runs: Entry[]; removedRuns?: Entry[] }
interface TestCaseLike { id: string; objectTypeRef: string; status: string }
interface TypeLike { name: string; category: string; statuses?: Array<{ name: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface RunLike { id: string; campaignEntry?: { campaignId: string; entryId: string }; campaignRunId?: unknown }

let campaign: Campaign

const getCampaign = () => s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  const approved = tests.filter(t => schema.nodes.some(n => (n.objectTypes ?? []).some(type =>
    type.category === 'test' && t.objectTypeRef === `${n.name}::${type.name}`
    && type.statuses?.some(st => st.isApproval && st.name === t.status))))
  test.skip(approved.length < 2, 'la démo doit avoir deux tests approuvés')
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, {
    title: 'GH73 e2e', testCaseIds: approved.slice(0, 2).map(t => t.id),
  }, workspaceDir)
})

test('1.5 / 1.6 — exécution depuis l\'UI : run rattaché à l\'entrée, retest = nouveau run rattaché', async () => {
  const p = s.page
  const { localPath } = s.project
  const entry = campaign.runs[0]!
  expect(entry.addedAt).toBe(campaign.createdAt)

  for (let i = 0; i < 2; i++) {
    await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))
    await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
    await p.waitForURL(url => !url.pathname.includes('/execute/'))
  }

  const runs = await s.invoke<RunLike[]>('tests:runs', localPath, entry.testCaseId)
  const attached = runs.filter(r => r.campaignEntry?.campaignId === campaign.id && r.campaignEntry.entryId === entry.entryId)
  expect(attached).toHaveLength(2)
  expect(attached.every(r => r.campaignRunId === undefined)).toBe(true)
  const after = (await getCampaign()).runs.find(r => r.entryId === entry.entryId)!
  expect(attached.map(r => r.id)).toContain(after.runId)
  expect(after.runId).toBe(attached.map(r => r.id).sort().at(-1))
  await s.shot('gh73-execution')
})

test('3.11 / 3.12 — retrait depuis la page campagne : entrée conservée dans removedRuns, absente de la vue', async () => {
  const p = s.page
  const { localPath, workspaceDir } = s.project
  const removed = campaign.runs[1]!
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: localPath }))
  const removeButtons = p.getByTitle('Retirer ce test de la campagne')
  await expect(removeButtons).toHaveCount(2)
  await removeButtons.nth(1).click()
  await expect(removeButtons).toHaveCount(1)

  const after = await getCampaign()
  expect(after.runs.map(r => r.entryId)).toEqual([campaign.runs[0]!.entryId])
  expect(after.removedRuns?.map(r => r.entryId)).toEqual([removed.entryId])
  expect(after.removedRuns?.[0]?.removedAt).toBeTruthy()

  // GH74 — entrées actives vues par un script de données (les retirées sont dans `removedEntries`).
  const username = await s.invoke<string>('auth:project-username', localPath)
  const rows = await s.invoke<{ rows: Array<{ entryId: string }> }>('suivi:run', localPath, workspaceDir, username, {
    script: `export default (data) => data.campaigns.find((c) => c.id === '${campaign.id}').entries.map((e) => ({ entryId: e.entryId }))`,
  }, { locale: 'fr', timezone: 'UTC' })
  expect(rows.rows.map(r => r.entryId)).toEqual([campaign.runs[0]!.entryId])
  await s.shot('gh73-retrait')
})

test('4.4 — campaigns:update-run sans run : refusé', async () => {
  const { localPath } = s.project
  s.allowConsoleErrors(/test run is required|campaigns:update-run/)
  await expect(s.invoke('campaigns:update-run', localPath, campaign.id, campaign.runs[0]!.entryId, 'PASS')).rejects.toThrow()
})
