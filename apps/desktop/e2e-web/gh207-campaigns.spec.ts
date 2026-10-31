import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH207 — campagnes issues d'un changeset (specs/GH207-tests.md) : tests à exécuter, « Créer la
 * campagne » (lien des deux côtés), « N tests à ajouter » vers le sélecteur pré-coché, campagne close.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string }> }
interface ChangeLike { id: string; campaigns: string[] }

let changeId = ''
let reqId = ''
let testA = ''
let testB = ''
let campaignId = ''

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
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh207_cs', label: 'GH207 CS', prefix: 'GSC', category: 'changeset', fields: [],
      statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }] },
    { name: 'gh207_req', label: 'GH207 Req', prefix: 'GSQ', category: 'requirement', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }] },
  ]
  await s.invoke('schema:save', localPath, schema)
  const testType = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'test').map(t => `${n.name}::${t.name}`))[0]
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: 'root::gh207_req', title: 'GH207 R' })).id
  testA = (await s.invoke<{ id: string }>('tests:create', localPath, { title: 'GH207 TA', objectTypeRef: testType, fields: {}, steps: [] }, workspaceDir)).id
  testB = (await s.invoke<{ id: string }>('tests:create', localPath, { title: 'GH207 TB', objectTypeRef: testType, fields: {}, steps: [] }, workspaceDir)).id
  const linkType = schema.linkTypes?.find(l => l.name === 'verification')?.name ?? schema.linkTypes?.[0]?.name ?? 'verification'
  await s.invoke('requirements:link-create', localPath, { type: linkType, sourceId: testA, targetId: reqId })
  changeId = (await s.invoke<{ id: string }>('changesets:create', localPath, {
    objectTypeRef: 'root::gh207_cs', title: 'GH207', component: 'root', toModify: [{ id: reqId, state: 'planned' }],
  })).id
})

test('GH207-C1/C2 — tests à exécuter, « Créer une campagne » : formulaire pré-rempli, lien des deux côtés', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/changeset/${changeId}`, { repoPath: localPath }))
  await expect(p.getByTestId('change-tests-to-run')).toContainText('1 test à exécuter')
  await p.getByTestId('change-campaign-create').click()
  await expect(p.getByPlaceholder('Ex : Campagne validation sprint 11')).toHaveValue(`${changeId} — GH207`)
  await p.getByRole('button', { name: 'Créer la campagne' }).click()
  await p.waitForURL(/\/campaign\/CAMP-/)
  campaignId = /\/campaign\/(CAMP-[^/?]+)/.exec(p.url())![1]
  await expect(p.getByTestId('campaign-changeset')).toContainText(changeId)
  const campaign = await s.invoke<{ changeset?: string; testCaseIds: string[] }>('campaigns:get', localPath, campaignId)
  expect(campaign.changeset).toBe(changeId)
  expect(campaign.testCaseIds).toEqual([testA])
  expect((await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).campaigns).toEqual([campaignId])
})

test('GH207-C4 — nouveau test « à tester » : « 1 test à ajouter », sélecteur pré-coché', async () => {
  const p = s.page
  const { localPath } = s.project
  await s.invoke('changesets:update', localPath, changeId, { impacted: [{ id: testB, status: 'impact_a_tester', source: 'declared' }] })
  await navigate(p, s.projectUrl(`/changeset/${changeId}`, { repoPath: localPath }))
  await expect(p.getByTestId('change-tests-to-add')).toContainText('1 test à ajouter')
  await expect(p.getByTestId(`change-campaign-${campaignId}`)).toBeVisible()
  await p.getByTestId('change-tests-add').click()
  await p.waitForURL(new RegExp(`/campaign/${campaignId}`))
  await expect(p.getByRole('button', { name: /Valider la sélection \(1\)|Ajouter/ }).first()).toBeVisible()
  expect((await s.invoke<{ testCaseIds: string[] }>('campaigns:get', localPath, campaignId)).testCaseIds).toEqual([testA])
})

test('GH207-C5 — campagne liée close : seul « Créer une campagne »', async () => {
  const p = s.page
  const { localPath } = s.project
  await s.invoke('campaigns:close', localPath, campaignId, 'completed')
  await navigate(p, s.projectUrl(`/changeset/${changeId}`, { repoPath: localPath }))
  await expect(p.getByTestId(`change-campaign-${campaignId}`)).toBeVisible()
  await expect(p.getByTestId('change-tests-to-add')).toHaveCount(0)
  await expect(p.getByTestId('change-campaign-create')).toBeEnabled()
})
