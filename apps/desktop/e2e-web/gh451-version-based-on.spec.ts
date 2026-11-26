import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH451 — « Basée sur » accepte une version en cours (specs/GH451-tests.md E1 à E4). Le projet de démo porte ses
 * propres versions : les assertions visent les deux versions créées ici, jamais un total.
 */
const s = setupSession()

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }> }

let aId = ''
let bId = ''
const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const openVersion = (id: string) => navigate(s.page, s.projectUrl(`/version/${id}`, { repoPath: repo() }))
const IN_PROGRESS = /— (En cours|In progress)/

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  typeOfCategory(root as never, 'version', {
    name: 'gh451_version', label: 'Version', prefix: 'GH451P', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  } as never)
  await s.invoke('schema:save', repo(), schema)
  // `basedOn: null` : sans quoi la création reprend la dernière released de la démo.
  aId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH451 Proto A', basedOn: null }, ws())).id
  bId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH451 Proto B', basedOn: null }, ws())).id
})

test('E1 — une version en cours se choisit comme base, mention « en cours », retrouvée au rechargement', async () => {
  const p = s.page
  await openVersion(bId)
  const select = p.getByTestId('version-based-on')
  const optionA = select.locator(`option[value="${aId}"]`)
  await expect(optionA).toHaveText(new RegExp(`GH451 Proto A \\(${aId}\\) ${IN_PROGRESS.source}`))
  const saved = p.waitForResponse(r => /\/rpc\/versions(?:%3A|:)update/.test(r.url()))
  await select.selectOption(aId)
  await saved
  await p.reload()
  await p.waitForLoadState('networkidle')
  await expect(p.getByTestId('version-based-on')).toHaveValue(aId)
  expect((await s.invoke<{ basedOn: { id: string } | null }>('versions:get', repo(), bId)).basedOn?.id).toBe(aId)
})

test('E2 — la descendante n\'est pas proposée comme base', async () => {
  await openVersion(aId)
  const select = s.page.getByTestId('version-based-on')
  await expect(select).toBeVisible()
  await expect(select.locator(`option[value="${bId}"]`)).toHaveCount(0)
  await expect(select.locator(`option[value="${aId}"]`)).toHaveCount(0)
})

test('E3 — boîte « Nouvelle version » : les versions en cours sont proposées', async () => {
  const p = s.page
  await s.openView('Version')
  await p.getByTestId('version-product-button').click()
  await expect(p.getByTestId('product-versions-panel')).toBeVisible()
  await p.getByTestId('new-version').click()
  const select = p.getByTestId('new-version-based-on')
  await expect(select.locator(`option[value="${aId}"]`)).toHaveText(IN_PROGRESS)
  await expect(select.locator(`option[value="${bId}"]`)).toHaveText(IN_PROGRESS)
  await p.keyboard.press('Escape')
})

test('E4 — passage released refusé tant que la base est en cours', async () => {
  const p = s.page
  await openVersion(bId)
  await p.getByTestId('version-release').click()
  await expect(p.getByTestId('release-problems')).toContainText(/La version de base n'est pas encore released|Base version not released yet/)
  await expect(p.getByTestId('release-problems')).toContainText(`${aId} GH451 Proto A`)
  await expect(p.getByTestId('release-confirm')).toBeDisabled()
  await p.keyboard.press('Escape')
})
