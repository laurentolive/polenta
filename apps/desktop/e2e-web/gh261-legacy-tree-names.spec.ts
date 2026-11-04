import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH261 — ancien fichier d'arbre (avant GH180) : le libellé d'un objet resté « Sans titre » n'existe
 * que dans le `name` de l'élément. Il reste affiché, puis est recopié dans le titre à la première
 * sauvegarde de l'arbre, avant d'être retiré du fichier.
 */
const s = setupSession()

const TYPE = 'gh261_req'
const REF = `root::${TYPE}`
const LABEL = 'Piloter les UARTs'
let reqId = ''

interface Tree { nodeId: string; typeId: string; root: Array<{ id: string; children: Array<{ name: string; objectId?: string }> }> }
const treeFile = () => path.join(s.project.localPath, '.polenta', 'trees', 'root', `${TYPE}.yaml`)

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }> }>('schema:get', localPath)
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push({
    name: TYPE, label: 'GH261 Exigence', prefix: 'GH261', category: 'requirement', fields: [],
    statuses: [{ name: 'draft', label: 'Brouillon' }],
  })
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: 'Sans titre', fields: {} })).id

  await fs.promises.mkdir(path.dirname(treeFile()), { recursive: true })
  await fs.promises.writeFile(treeFile(), yaml.dump({
    nodeId: 'root', typeId: TYPE,
    root: [{ id: 'f1', kind: 'folder', name: 'Interface', children: [{ id: 'n1', kind: 'item', name: LABEL, objectId: reqId, children: [] }] }],
  }))
})

test('le libellé de l’ancien fichier est affiché, puis recopié dans le titre à la sauvegarde', async () => {
  const { localPath } = s.project
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill('GH261 Exigence')
  await combo.press('Enter')
  await expect(s.page.getByText(LABEL).first()).toBeVisible()
  await s.shot('gh261-legacy-label')

  const tree = await s.invoke<Tree>('tree:get', localPath, 'root', TYPE)
  expect(tree.root[0].children[0].name).toBe(LABEL)
  // Sans sauvegarde, rien n'a été écrit dans l'objet.
  expect((await s.invoke<{ title: string }>('requirements:get', localPath, reqId)).title).toBe('Sans titre')

  await s.invoke('tree:save', localPath, tree)

  expect((await s.invoke<{ title: string }>('requirements:get', localPath, reqId)).title).toBe(LABEL)
  expect(await fs.promises.readFile(treeFile(), 'utf-8')).not.toContain(LABEL)
  const reread = await s.invoke<Tree>('tree:get', localPath, 'root', TYPE)
  expect(reread.root[0].children[0].name).toBe(LABEL)
})
