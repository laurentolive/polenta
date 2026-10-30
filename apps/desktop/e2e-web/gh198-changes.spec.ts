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
let reqType = ''
// Exigence d'un repo composant (modifiable) et ce repo : change tracé dans le composant (#193 §4).
let compReq = { id: '', repoPath: '' }

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

/** Sélecteur d'éléments (grille Excel) : type, ligne de l'élément cochée, ajout. */
async function pick(p: Page, typeRef: string, id: string) {
  await p.getByTestId('change-pick-type').selectOption(typeRef)
  await p.getByTestId('change-pick-filter').fill(id)
  await p.locator('tr', { hasText: id }).getByRole('checkbox').click()
  await p.getByTestId('change-pick-confirm').click()
}

const changeIdFromUrl = (p: Page) => decodeURIComponent(new URL(p.url()).pathname.split('/changeset/')[1] ?? '')

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh198_nc', label: 'GH198 NC', prefix: 'GHC', category: 'changeset', fields: [],
    statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'analyse', label: 'Analysé' }, { name: 'clos', label: 'Clos', isTerminal: true }],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  const reqTypes = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'requirement').map(t => `${n.name}::${t.name}`))
  reqType = reqTypes[0]
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: reqType, title: 'GH198 R' })).id

  const norm = (x: string) => x.replace(/\\/g, '/').toLowerCase()
  const objs = await s.invoke<Array<{ id: string; category: string; repoPath: string; readonly: boolean }>>('links:objects', localPath, s.project.workspaceDir)
  compReq = objs.find(o => o.category === 'requirement' && norm(o.repoPath) !== norm(localPath) && !o.readonly)!
  await s.invoke('schema:invalidate', compReq.repoPath)
  const compSchema = await s.invoke<SchemaLike>('schema:get', compReq.repoPath)
  const compRoot = compSchema.nodes.find(n => n.objectTypes !== undefined)!
  compRoot.objectTypes = [...(compRoot.objectTypes ?? []), {
    name: 'gh198_evo', label: 'GH198 Évolution', prefix: 'GHD', category: 'changeset', fields: [],
    statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }],
  } as TypeLike]
  await s.invoke('schema:save', compReq.repoPath, compSchema)
})

test('GH198-1 — nouveau change, listes, statut', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl('/changeset/new', {}))
  const form = p.getByTestId('change-new-form')
  // Composant concerné : le nœud `root` du repo ouvert (valeur `<repo>\n<nœud>`), puis notre type.
  const componentSelect = form.getByTestId('change-new-component')
  const values = await componentSelect.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))
  await componentSelect.selectOption(values.find(v => v.endsWith('\nroot') && v.startsWith(localPath))!)
  const typeSelect = form.getByTestId('change-new-type')
  if (await typeSelect.count()) await typeSelect.selectOption('root::gh198_nc')
  await form.getByTestId('change-new-title').fill('GH198 surcharge')
  await form.getByTestId('change-new-submit').click()
  await expect(p.getByTestId('change-page')).toBeVisible()
  const id = changeIdFromUrl(p)
  expect(id).toMatch(/^GHC-\d+$/)

  // À modifier : sélecteur d'éléments.
  await p.getByTestId('change-to-modify-add').click()
  await pick(p, reqType, reqId)
  await expect(p.getByTestId(`change-to-modify-${reqId}`)).toContainText('GH198 R')

  // Impactés : statut d'impact et commentaire.
  await p.getByTestId('change-impacted-add').click()
  await pick(p, reqType, reqId)
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
    const c = await s.invoke<ChangeLike>('changesets:get', localPath, id)
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
  // GH199 — l'exigence figure déjà dans le change ouvert de GH198-1 : menu « Ouvrir … / Créer un change ».
  await p.getByTestId('create-change-menu').getByRole('button', { name: 'Créer un change' }).click()
  const form = p.getByTestId('change-new-form')
  await expect(form).toContainText(reqId)
  const typeSelect = form.getByTestId('change-new-type')
  if (await typeSelect.count()) await typeSelect.selectOption('root::gh198_nc')
  await form.getByTestId('change-new-title').fill('GH198 depuis exigence')
  await form.getByTestId('change-new-submit').click()
  await expect(p.getByTestId('change-page')).toBeVisible()
  await expect(p.getByTestId(`change-to-modify-${reqId}`)).toBeVisible()
  const c = await s.invoke<ChangeLike>('changesets:get', localPath, changeIdFromUrl(p))
  expect(c.toModify).toEqual([{ id: reqId, state: 'planned' }])
})

test('GH198-3 — change d\'un sous-composant : stocké dans son repo, avec ses types', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/req/${compReq.id}`, { repoPath: compReq.repoPath }))
  await p.getByTestId('create-change').click()
  const form = p.getByTestId('change-new-form')
  await expect(form).toContainText(compReq.id)
  await form.getByTestId('change-new-title').fill('GH198 dans le composant')
  await form.getByTestId('change-new-submit').click()
  await expect(p.getByTestId('change-page')).toBeVisible()
  const id = changeIdFromUrl(p)
  expect(id).toMatch(/^GHD-\d+$/)
  const c = await s.invoke<ChangeLike>('changesets:get', compReq.repoPath, id)
  expect(c.toModify).toEqual([{ id: compReq.id, state: 'planned' }])
  // Panneau : listé sous le repo du composant.
  await expect(p.getByTestId(`change-row-${id}`)).toBeVisible()
  await s.shot('gh198-component-change')
})
