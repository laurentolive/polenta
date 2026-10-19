import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH104 — supprimer un composant local ou un type depuis l'onglet Structure : aperçu dans la
 * confirmation (comptes d'objets, de liens, types de lien vidés), Annuler sans effet, suppression
 * en cascade (objets, liens, refs de liens, schéma). Scénarios D11, D12, D14, D15 de
 * specs/GH104-tests.md. Un composant local dédié (types exigence / test) et ses objets sont créés
 * par le test (IPC).
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string }> }
interface NodeLike { name: string; label?: string; objectTypes?: TypeLike[]; children?: NodeLike[] }
interface SchemaLike { nodes: NodeLike[]; linkTypes?: Array<{ name: string; sourceRefs?: string[]; targetRefs?: string[] }> }
interface Obj { id: string }
interface LinkLike { id: string; sourceId: string; targetId: string }

const NODE = 'gh104comp'
const NODE_LABEL = 'GH104 Composant'
const REQ_TYPE = 'gh104_req'
const TEST_TYPE = 'gh104_test'
const TEST_LABEL = 'GH104 Tests'
const LINK_TYPE = 'gh104_verifies'
const statuses = [{ name: 'draft' }]
let reqIds: string[]
let testId: string
let rootReqId: string

const schema = () => s.invoke<SchemaLike>('schema:get', s.project.localPath)
const ids = async (channel: 'requirements:list' | 'tests:list') => (await s.invoke<Obj[]>(channel, s.project.localPath)).map(o => o.id)
const links = async (id: string) => s.invoke<LinkLike[]>('requirements:links', s.project.localPath, id)

async function openStructure() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.getByText(NODE_LABEL, { exact: true })).toBeVisible()
}

/** Corbeille de la ligne qui porte `label` (composant local : `group/local` ; type : ligne d'élément). */
const trashOf = (label: string, row: 'component' | 'type') => s.page
  .getByText(label, { exact: row === 'component' })
  .locator(`xpath=ancestor::*[contains(@class, '${row === 'component' ? 'group/local' : 'cursor-grab'}')][1]`)
  .getByTitle('Supprimer')

const dialog = (name: RegExp) => s.page.getByRole('dialog', { name })

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await schema()
  const rootType = current.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.category === 'requirement')!
  current.nodes = [...current.nodes, {
    name: NODE, label: NODE_LABEL, objectTypes: [
      { name: REQ_TYPE, label: 'GH104 Exigences', prefix: 'GHD', category: 'requirement', fields: [], statuses },
      { name: TEST_TYPE, label: TEST_LABEL, prefix: 'GHT', category: 'test', fields: [], statuses },
    ],
  }]
  current.linkTypes = [...(current.linkTypes ?? []), { name: LINK_TYPE, sourceRefs: [`${NODE}::${TEST_TYPE}`], targetRefs: [`${NODE}::${REQ_TYPE}`] }]
  await s.invoke('schema:save', localPath, current)

  const ref = `${NODE}::${REQ_TYPE}`
  reqIds = []
  for (const title of ['GH104 A', 'GH104 B']) {
    reqIds.push((await s.invoke<Obj>('requirements:create', localPath, { objectTypeRef: ref, title, fields: {} })).id)
  }
  testId = (await s.invoke<Obj>('tests:create', localPath, { objectTypeRef: `${NODE}::${TEST_TYPE}`, title: 'GH104 T', fields: {}, steps: [] })).id
  rootReqId = (await s.invoke<Obj[]>('requirements:list', localPath)).find(r => r.id.startsWith(`${rootType.prefix}-`))!.id
  await s.invoke('requirements:link-create', localPath, { type: LINK_TYPE, sourceId: testId, targetId: reqIds[0] })
  const anyLinkType = current.linkTypes.find(l => l.name !== LINK_TYPE)
  if (anyLinkType) await s.invoke('requirements:link-create', localPath, { type: anyLinkType.name, sourceId: reqIds[1], targetId: rootReqId })
})

test('D11 / D12 — corbeille du composant : aperçu avec les comptes, Annuler ne modifie rien', async () => {
  await openStructure()
  const before = await schema()
  await trashOf(NODE_LABEL, 'component').click()
  const d = dialog(/Supprimer le composant/)
  await expect(d).toBeVisible()
  await expect(d).toContainText('2 exigences supprimées')
  await expect(d).toContainText(reqIds[0])
  await expect(d).toContainText('1 test supprimé')
  await expect(d).toContainText('lien')
  await expect(d).toContainText(`Deviennent invalides`)
  await expect(d).toContainText(LINK_TYPE)
  await d.getByRole('button', { name: 'Annuler' }).click()
  await expect(d).toBeHidden()
  expect(await schema()).toEqual(before)
  expect(await ids('requirements:list')).toEqual(expect.arrayContaining(reqIds))
})

test('D14 — corbeille d\'un type : même flux, seul ce type est visé', async () => {
  await openStructure()
  await trashOf(TEST_LABEL, 'type').click()
  const d = dialog(/Supprimer le type/)
  await expect(d).toContainText('1 test supprimé')
  await expect(d).not.toContainText('exigence')
  await d.getByRole('button', { name: 'Annuler' }).click()
  await expect(d).toBeHidden()
  expect(await ids('tests:list')).toContain(testId)
})

test('D15 — supprimer le composant : objets, liens, refs et nœud supprimés, compte rendu', async () => {
  await openStructure()
  await trashOf(NODE_LABEL, 'component').click()
  const d = dialog(/Supprimer le composant/)
  await d.getByRole('button', { name: 'Supprimer' }).click()
  await expect(d).toBeHidden()
  await expect(s.page.getByRole('status').filter({ hasText: 'Suppression effectuée' })).toContainText('3 objet(s)')
  await expect(s.page.getByText(NODE_LABEL, { exact: true })).toBeHidden()

  const remaining = await ids('requirements:list')
  for (const id of reqIds) expect(remaining).not.toContain(id)
  expect(await ids('tests:list')).not.toContain(testId)
  // Le lien de l'exigence du composant vers l'exigence produit a suivi.
  expect((await links(rootReqId)).filter(l => reqIds.includes(l.sourceId) || reqIds.includes(l.targetId))).toEqual([])
  const after = await schema()
  expect(after.nodes.map(n => n.name)).not.toContain(NODE)
  expect(after.linkTypes?.find(l => l.name === LINK_TYPE)).toEqual(expect.objectContaining({ sourceRefs: [], targetRefs: [] }))
})
