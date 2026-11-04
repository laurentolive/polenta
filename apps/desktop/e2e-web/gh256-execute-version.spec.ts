import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH256 — client web, repo avec une version : l'exécution demande la version testée et l'enregistre,
 * et un échec propose une issue créée depuis le navigateur. La version est écrite dans le repo (les
 * channels `versions:*` restent masqués sur le web, #252) ; le schéma n'est modifié que dans le clone
 * de ce fichier.
 */
const s = setupSession()

interface StatusLike { name: string; isApproval?: boolean }
interface TypeLike { name: string; category: string; statuses?: StatusLike[] }
interface NodeLike { name: string; objectTypes?: TypeLike[] }
interface SchemaLike { nodes: NodeLike[] }
interface TestLike { id: string; objectTypeRef: string; status: string }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }
interface RunLike { id: string; result: string; testedConfig?: { ref?: string }; campaignEntry?: { campaignId: string; entryId: string } }
interface IssueLike { id: string; title: string; origin?: { runs?: string[] } }

const VERSION_ID = 'WVR-0001'
const statuses = (...names: StatusLike[]) => names.map(st => ({ ...st, label: st.name }))

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
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestLike[]>('tests:list', localPath)
  const approved = tests.find(t => schema.nodes.some(n => (n.objectTypes ?? []).some(type =>
    type.category === 'test' && t.objectTypeRef === `${n.name}::${type.name}`
    && type.statuses?.some(st => st.isApproval && st.name === t.status))))
  expect(approved, 'la démo doit avoir un test approuvé').toBeTruthy()

  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [
    ...(root.objectTypes ?? []),
    { name: 'web-version', label: 'Version', prefix: 'WVR', category: 'version', fields: [], statuses: statuses({ name: 'en_cours' }, { name: 'released', isApproval: true }) } as TypeLike,
    { name: 'web-issue', label: 'Issue', prefix: 'WIS', category: 'issue', fields: [], statuses: statuses({ name: 'ouverte' }) } as TypeLike,
  ]
  await s.invoke('schema:save', localPath, schema)
  fs.mkdirSync(path.join(localPath, 'versions'), { recursive: true })
  fs.writeFileSync(path.join(localPath, 'versions', `${VERSION_ID}.yaml`), [
    `id: ${VERSION_ID}`, 'objectTypeRef: root::web-version', 'title: "1.0"', 'status: en_cours', 'version: 1', 'fields: {}', '',
  ].join('\n'))

  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH256 e2e', testCaseIds: [approved!.id] }, workspaceDir)
})

test('E1 — version testée exigée, enregistrée, et issue proposée sur échec', async () => {
  const p = s.page
  const { localPath } = s.project
  const entry = campaign.runs[0]!
  const submit = p.getByRole('button', { name: 'Soumettre le résultat' })
  // Le test de la démo a déjà des runs : seuls comptent ceux de cette entrée.
  const entryRuns = async () => (await s.invoke<RunLike[]>('tests:runs', localPath, entry.testCaseId))
    .filter(r => r.campaignEntry?.campaignId === campaign.id && r.campaignEntry.entryId === entry.entryId)

  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))

  // Le web présente le champ : sans lui, le serveur refuserait la saisie sans recours (#256).
  const select = p.getByTestId('tested-version-select')
  await expect(select).toBeVisible()
  await submit.click()
  await expect(p.getByTestId('tested-version-missing')).toBeVisible()
  expect(await entryRuns()).toHaveLength(0)

  await select.selectOption(VERSION_ID)
  await p.locator('select').filter({ has: p.locator('option[value="FAIL"]') }).last().selectOption('FAIL')
  await submit.click()

  await expect.poll(async () => (await entryRuns()).length).toBe(1)
  const runs = await entryRuns()
  expect(runs[0]!.testedConfig?.ref).toBe(VERSION_ID)

  // La popup lit et crée les issues depuis le navigateur.
  await p.getByTestId('issue-proposal-title').fill('Issue GH256')
  await p.getByTestId('issue-proposal-submit').click()
  await p.waitForURL(url => !url.pathname.includes('/execute/'))
  const issues = await s.invoke<IssueLike[]>('issues:list', localPath)
  expect(issues.find(i => i.title === 'Issue GH256')?.origin?.runs).toEqual([runs[0]!.id])
})
