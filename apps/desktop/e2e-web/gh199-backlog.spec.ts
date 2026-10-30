import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH199 §8bis — backlog et assignation des éléments (specs/GH199-tests.md, scénarios 17 à 20) :
 * backlog d'un composant, « Assigner à… », « Déplacer vers… », dialogue à l'approbation d'un
 * élément non assigné, « Passer en changé » depuis l'analyse.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string }> }
interface ChangeLike { id: string; toModify: Array<{ id: string; state: string }> }
interface BacklogLike { component: string; repoPath: string; items: Array<{ id: string }> }

let reqA = ''
let reqB = ''
let testId = ''
let changeA = ''
let changeB = ''
let entry = ''

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const getChange = (id: string) => s.invoke<ChangeLike>('changes:get', s.project.localPath, id)

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh199_bl', label: 'GH199 BL', prefix: 'GHB', category: 'change', fields: [],
      statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }] },
    { name: 'gh199_req', label: 'GH199 Req', prefix: 'GHR', category: 'requirement', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }] },
  ]
  await s.invoke('schema:save', localPath, schema)
  const testType = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'test').map(t => `${n.name}::${t.name}`))[0]
  reqA = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: 'root::gh199_req', title: 'GH199 A' })).id
  reqB = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: 'root::gh199_req', title: 'GH199 B' })).id
  testId = (await s.invoke<{ id: string }>('tests:create', localPath, { title: 'GH199 BT', objectTypeRef: testType, fields: {}, steps: [] }, workspaceDir)).id
  const linkType = schema.linkTypes?.find(l => l.name === 'verification')?.name ?? schema.linkTypes?.[0]?.name ?? 'verification'
  await s.invoke('requirements:link-create', localPath, { type: linkType, sourceId: testId, targetId: reqA })
  changeA = (await s.invoke<{ id: string }>('changes:create', localPath, { objectTypeRef: 'root::gh199_bl', title: 'GH199 A', component: 'root' })).id
  changeB = (await s.invoke<{ id: string }>('changes:create', localPath, { objectTypeRef: 'root::gh199_bl', title: 'GH199 B', component: 'root' })).id
  const backlogs = await s.invoke<BacklogLike[]>('changes:backlog', localPath, workspaceDir)
  const own = backlogs.find(b => b.items.some(i => i.id === reqA))!
  entry = `changes-backlog-entry-${own.repoPath.split(/[\\/]/).filter(Boolean).pop()}-${own.component}`
})

test('GH199-B1/B2 — backlog du composant, « Assigner à… » un change ouvert', async () => {
  const p = s.page
  await s.openView('Changements')
  await p.getByTestId(entry).click()
  await expect(p.getByTestId('backlog-page')).toBeVisible()
  const row = p.getByTestId(`backlog-row-${reqA}`)
  await expect(row).toBeVisible()
  await row.getByRole('checkbox').check()
  await p.getByTestId('backlog-assign').click()
  await p.getByTestId(`assign-change-${changeA}`).click()
  await expect(row).toHaveCount(0)
  expect((await getChange(changeA)).toModify).toEqual([{ id: reqA, state: 'planned' }])
})

test('GH199-B3 — « Déplacer vers… » un autre change', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/change/${changeA}`, { repoPath: localPath }))
  await p.getByTestId(`change-to-modify-${reqA}`).getByRole('checkbox').check()
  await p.getByTestId('change-to-modify-move').click()
  await p.getByTestId(`assign-change-${changeB}`).click()
  await expect(p.getByTestId(`change-to-modify-${reqA}`)).toHaveCount(0)
  expect((await getChange(changeB)).toModify).toEqual([{ id: reqA, state: 'planned' }])
})

test('GH199-B6 — élément à traiter atteint par l\'analyse : « Passer en changé »', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/change/${changeB}`, { repoPath: localPath }))
  await expect(p.getByTestId(`change-impacted-to-process-${testId}`)).toBeVisible()
  await p.getByTestId(`change-impacted-promote-${testId}`).click()
  await expect(p.getByTestId(`change-to-modify-${testId}`)).toBeVisible()
  expect((await getChange(changeB)).toModify.map(t => t.id)).toEqual([reqA, testId])
})

test('GH199-B5 — approuver un élément non assigné : dialogue ; Annuler, puis assigner', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/req/${reqB}`, { repoPath: localPath }))
  const approve = p.getByRole('button', { name: /Approuver/ })
  await approve.click()
  const dialog = p.getByTestId('assign-change-dialog')
  await expect(dialog).toBeVisible()
  await p.getByTestId('assign-change-cancel').click()
  await expect(dialog).toHaveCount(0)
  expect((await s.invoke<{ status: string }>('requirements:get', localPath, reqB)).status).toBe('draft')

  await approve.click()
  await p.getByTestId(`assign-change-${changeA}`).click()
  await expect.poll(async () => (await s.invoke<{ status: string }>('requirements:get', localPath, reqB)).status).toBe('approved')
  expect((await getChange(changeA)).toModify).toEqual([{ id: reqB, state: 'planned' }])
})
