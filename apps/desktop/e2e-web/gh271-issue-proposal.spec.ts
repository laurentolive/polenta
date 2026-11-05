import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH271 — popup d'issue sur une exécution (specs/GH244.md, critères 8 et 9) : PASS ne propose rien, BLOCKED
 * propose, « Ignorer » n'écrit rien, « Lier » complète `origin.runs` d'une issue existante. La création est
 * couverte par gh256-execute-version. GH243 E2 : statut d'un test approuvé changé en vue Tableau.
 */
const s = setupSession()

interface StatusLike { name: string; label?: string; isApproval?: boolean }
interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields?: unknown[]; statuses?: StatusLike[] }
interface NodeLike { name: string; objectTypes?: TypeLike[] }
interface SchemaLike { nodes: NodeLike[] }
interface TestLike { id: string; objectTypeRef: string; status: string; version?: number }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }
interface RunLike { id: string; campaignEntry?: { campaignId: string; entryId: string } }
interface IssueLike { id: string; title: string; origin?: { runs?: string[] } }

const VERSION_ID = 'WVR-0001'
const statuses = (...names: StatusLike[]) => names.map(st => ({ ...st, label: st.label ?? st.name }))

let campaign: Campaign
let linkedIssue: IssueLike
let testId = ''

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
  testId = approved!.id

  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [
    ...(root.objectTypes ?? []),
    { name: 'web-version', label: 'Version', prefix: 'WVR', category: 'version', fields: [], statuses: statuses({ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true } as StatusLike) },
    { name: 'web-issue', label: 'Issue', prefix: 'WIS', category: 'issue', fields: [], statuses: statuses({ name: 'ouverte' }) },
  ]
  await s.invoke('schema:save', localPath, schema)
  fs.mkdirSync(path.join(localPath, 'versions'), { recursive: true })
  fs.writeFileSync(path.join(localPath, 'versions', `${VERSION_ID}.yaml`), [
    `id: ${VERSION_ID}`, 'objectTypeRef: root::web-version', 'title: "1.0"', 'status: en_cours', 'version: 1', 'fields: {}', '',
  ].join('\n'))
  linkedIssue = await s.invoke<IssueLike>('issues:create', localPath, { objectTypeRef: 'root::web-issue', title: 'Issue existante', fields: {} }, workspaceDir)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH271 e2e', testCaseIds: [testId] }, workspaceDir)
})

/** Saisit un résultat sur l'entrée de la campagne. */
async function execute(result: 'PASS' | 'BLOCKED') {
  const p = s.page
  const entry = campaign.runs[0]!
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: s.project.localPath }))
  await p.getByTestId('tested-version-select').selectOption(VERSION_ID)
  await p.locator('select').filter({ has: p.locator(`option[value="${result}"]`) }).last().selectOption(result)
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
}

const entryRuns = async () => (await s.invoke<RunLike[]>('tests:runs', s.project.localPath, testId))
  .filter(r => r.campaignEntry?.campaignId === campaign.id)
const issues = () => s.invoke<IssueLike[]>('issues:list', s.project.localPath)

test('GH244 critère 8 — PASS ne propose pas d\'issue', async () => {
  await execute('PASS')
  await expect.poll(async () => (await entryRuns()).length).toBe(1)
  await s.page.waitForURL(url => !url.pathname.includes('/execute/'))
  await expect(s.page.getByTestId('issue-proposal')).toHaveCount(0)
})

test('GH244 critères 8, 9 — BLOCKED propose ; « Ignorer » n\'écrit rien ; « Lier » complète `origin.runs`', async () => {
  const p = s.page
  const before = (await issues()).length
  await execute('BLOCKED')
  await expect(p.getByTestId('issue-proposal')).toBeVisible()
  await p.getByTestId('issue-proposal-ignore').click()
  await expect(p.getByTestId('issue-proposal')).toHaveCount(0)
  expect((await issues()).length).toBe(before)

  await expect.poll(async () => (await entryRuns()).length).toBe(2)
  await execute('BLOCKED')
  await expect(p.getByTestId('issue-proposal')).toBeVisible()
  await expect.poll(async () => (await entryRuns()).length).toBe(3)
  const runIds = (await entryRuns()).map(r => r.id)
  await p.getByTestId('issue-proposal-link-mode').check()
  await p.getByTestId('issue-proposal-existing').selectOption(linkedIssue.id)
  await p.getByTestId('issue-proposal-submit').click()
  await expect(p.getByTestId('issue-proposal')).toHaveCount(0)
  const after = (await issues()).find(i => i.id === linkedIssue.id)!
  expect(after.origin?.runs).toHaveLength(1)
  expect(runIds).toContain(after.origin!.runs![0])
  expect((await issues()).length).toBe(before)
})

test('GH243 E2 — vue Tableau, test approuvé : statut changé sans question, version + 1', async () => {
  const p = s.page
  const { localPath } = s.project
  const tc = (await s.invoke<TestLike[]>('tests:list', localPath)).find(t => t.id === testId)!
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const [node, typeName] = tc.objectTypeRef.split('::')
  const type = schema.nodes.find(n => n.name === node)!.objectTypes!.find(t => t.name === typeName)!
  const target = type.statuses!.find(st => !st.isApproval)!

  await s.openView('Tests')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(type.label ?? type.name)
  await combo.press('Enter')
  await p.getByTitle('Vue tableau').click()
  await p.waitForLoadState('networkidle')

  const row = p.locator('tr').filter({ hasText: testId })
  const approvedLabel = type.statuses!.find(st => st.name === tc.status)!.label ?? tc.status
  await row.getByRole('cell', { name: approvedLabel, exact: true }).dblclick()
  await row.locator('select').selectOption(target.name)
  await expect.poll(async () => (await s.invoke<TestLike>('tests:get', localPath, testId)).status).toBe(target.name)
  expect((await s.invoke<TestLike>('tests:get', localPath, testId)).version).toBe((tc.version ?? 1) + 1)
  await expect(p.getByRole('dialog')).toHaveCount(0)
})
