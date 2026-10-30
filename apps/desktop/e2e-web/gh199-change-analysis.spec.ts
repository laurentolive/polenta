import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH199 — analyse d'impact dans le change (specs/GH199-tests.md, scénarios 9 à 11) : impactés
 * calculés, statut saisi écrit, analyse figée à la clôture puis rendue au live ; « Analyser
 * l'impact » sur l'élément ; entrées de l'ex-vue Analyse d'impact dans le panneau Changesets.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string }> }
interface ChangeLike { id: string; status: string; impacted: Array<{ id: string; status: string; source: string }>; analysis?: { frozen: boolean } }

let reqId = ''
let testId = ''
let changeId = ''

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
    name: 'gh199_nc', label: 'GH199 NC', prefix: 'GHI', category: 'changeset', fields: [],
    statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }],
  }]
  await s.invoke('schema:save', localPath, schema)
  const typesOf = (cat: string) => schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === cat).map(t => `${n.name}::${t.name}`))
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: typesOf('requirement')[0], title: 'GH199 R' })).id
  testId = (await s.invoke<{ id: string }>('tests:create', localPath, { title: 'GH199 T', objectTypeRef: typesOf('test')[0], fields: {}, steps: [] }, workspaceDir)).id
  await s.invoke('requirements:link-create', localPath, { type: schema.linkTypes?.[0]?.name ?? 'verification', sourceId: testId, targetId: reqId })
  changeId = (await s.invoke<{ id: string }>('changesets:create', localPath, { objectTypeRef: 'root::gh199_nc', title: 'GH199 change', component: 'root', toModify: [{ id: reqId, state: 'planned' }] })).id
})

test('GH199-1 — impacté calculé, statut saisi écrit', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/changeset/${changeId}`, { repoPath: localPath }))
  await expect(p.getByTestId(`change-analysis-root-${reqId}`)).toBeVisible()
  const row = p.getByTestId(`change-impacted-${testId}`)
  await expect(row).toContainText('calculé')
  // Calculé au statut par défaut : non écrit.
  expect((await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).impacted).toEqual([])

  await row.locator('select').selectOption('impact_a_tester')
  await expect.poll(async () => (await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).impacted)
    .toEqual([{ id: testId, status: 'impact_a_tester', source: 'computed' }])
  await expect(p.getByTestId('change-analysis-open')).toBeVisible()
  await s.shot('gh199-analysis')
})

test('GH199-2 — clôture : analyse figée ; réouverture : live', async () => {
  const p = s.page
  const { localPath } = s.project
  await p.getByTestId('change-status').selectOption('clos')
  await expect(p.getByTestId('change-analysis-state')).toContainText('figée')
  expect((await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).analysis?.frozen).toBe(true)
  await p.getByTestId('change-status').selectOption('ouvert')
  await expect(p.getByTestId('change-analysis-state')).toContainText('calculée')
  expect((await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).analysis).toBeUndefined()
})

test('GH199-3 — « Analyser l\'impact » : change ouvert qui liste l\'élément', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/req/${reqId}`, { repoPath: s.project.localPath }))
  await p.getByTestId('create-change').click()
  const menu = p.getByTestId('create-change-menu')
  await expect(menu).toContainText(changeId)
  await menu.getByRole('button', { name: new RegExp(changeId) }).click()
  await expect(p.getByTestId('change-page')).toBeVisible()
})

test('GH199-4 — panneau Changesets : Constellation, plus d\'entrée « Analyse d\'impact »', async () => {
  const p = s.page
  await s.openView('Changesets')
  await expect(p.getByTestId('changes-constellation')).toBeVisible()
  await expect(p.getByRole('button', { name: "Analyse d'impact", exact: true })).toHaveCount(0)
})
