import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH198 — objet change (specs/GH198-tests.md, scénarios 8–9) : « Nouveau change », listes « à
 * modifier » et « impactés », statut ; « Créer un change » depuis une exigence. Type de change
 * dédié (préfixe GHC) et exigence créés par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ChangeLike { id: string; status: string; toModify: Array<{ id: string; state: string }>; impacted: Array<{ id: string; status: string; comment?: string }> }

let reqId = ''

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const changeIdFromUrl = (p: Page) => decodeURIComponent(new URL(p.url()).pathname.split('/change/')[1] ?? '')

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh198_nc', label: 'GH198 NC', prefix: 'GHC', category: 'change', fields: [],
    statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'analyse', label: 'Analysé' }, { name: 'clos', label: 'Clos', isTerminal: true }],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  const reqTypes = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'requirement').map(t => `${n.name}::${t.name}`))
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: reqTypes[0], title: 'GH198 R' })).id
})

test('GH198-1 — nouveau change, listes, statut', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl('/change/new', {}))
  const form = p.getByTestId('change-new-form')
  // Plusieurs types de change possibles dans le projet de démo : choisir le nôtre s'il y a un sélecteur.
  const typeSelect = form.getByTestId('change-new-type')
  if (await typeSelect.count()) await typeSelect.selectOption('root::gh198_nc')
  await form.getByTestId('change-new-title').fill('GH198 surcharge')
  const componentSelect = form.getByTestId('change-new-component')
  if (await componentSelect.count() && !(await componentSelect.inputValue())) await componentSelect.selectOption('root')
  await form.getByTestId('change-new-submit').click()
  await expect(p.getByTestId('change-page')).toBeVisible()
  const id = changeIdFromUrl(p)
  expect(id).toMatch(/^GHC-\d+$/)

  // À modifier : sélecteur d'éléments.
  await p.getByTestId('change-to-modify-add').click()
  await p.getByTestId(`change-pick-${reqId}`).click()
  await p.getByTestId('change-pick-confirm').click()
  await expect(p.getByTestId(`change-to-modify-${reqId}`)).toContainText('GH198 R')

  // Impactés : statut d'impact et commentaire.
  await p.getByTestId('change-impacted-add').click()
  await p.getByTestId(`change-pick-${reqId}`).click()
  await p.getByTestId('change-pick-confirm').click()
  const impacted = p.getByTestId(`change-impacted-${reqId}`)
  await expect(impacted).toBeVisible()
  await impacted.locator('select').selectOption('impact_a_tester')
  await expect(impacted.locator('select')).toHaveValue('impact_a_tester')
  await impacted.locator('input').fill('à rejouer')
  await impacted.locator('input').press('Enter')

  // Statut du change.
  await p.getByTestId('change-status').selectOption('analyse')
  await expect(p.getByTestId('change-status')).toHaveValue('analyse')

  await expect.poll(async () => {
    const c = await s.invoke<ChangeLike>('changes:get', localPath, id)
    return { status: c.status, toModify: c.toModify, impacted: c.impacted }
  }).toEqual({
    status: 'analyse',
    toModify: [{ id: reqId, state: 'planned' }],
    impacted: [{ id: reqId, status: 'impact_a_tester', comment: 'à rejouer', source: 'declared' }],
  })
  // Panneau : la ligne du change est listée.
  await expect(p.getByTestId(`change-row-${id}`)).toBeVisible()
  await s.shot('gh198-change')
})

test('GH198-2 — « Créer un change » depuis une exigence : élément pré-rempli', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl(`/req/${reqId}`, { repoPath: localPath }))
  await p.getByTestId('create-change').click()
  const form = p.getByTestId('change-new-form')
  await expect(form).toContainText(reqId)
  const typeSelect = form.getByTestId('change-new-type')
  if (await typeSelect.count()) await typeSelect.selectOption('root::gh198_nc')
  await form.getByTestId('change-new-title').fill('GH198 depuis exigence')
  await form.getByTestId('change-new-submit').click()
  await expect(p.getByTestId('change-page')).toBeVisible()
  await expect(p.getByTestId(`change-to-modify-${reqId}`)).toBeVisible()
  const c = await s.invoke<ChangeLike>('changes:get', localPath, changeIdFromUrl(p))
  expect(c.toModify).toEqual([{ id: reqId, state: 'planned' }])
})
