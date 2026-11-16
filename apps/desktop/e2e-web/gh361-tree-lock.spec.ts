import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'
import { readAppLock, withTreeWriteLock } from '../src/main/services/tree-lock.util'

/**
 * GH361 — verrou du rangement : tant que l'application affiche l'arbre d'un type en édition, une
 * écriture de l'agent MCP (même protocole que `tree.tools.ts` : verrou court puis contrôle du verrou
 * long) est refusée ; l'utilisateur change d'onglet → elle passe ; il revient → il voit le rangement
 * de l'agent, et sa prochaine action ne l'écrase pas.
 */
const s = setupSession()

const TYPE = 'gh361_req'
const REF = `root::${TYPE}`
const LABEL = 'GH361 Exigence'
let reqId = ''

const treeFile = () => path.join(s.project.localPath, '.polenta', 'trees', 'root', `${TYPE}.yaml`)

/** Écriture « agent » : rangement de l'exigence dans le dossier `name`, sous verrou. */
const agentWrite = (name: string) => withTreeWriteLock(s.project.localPath, 'root', TYPE, async () => {
  await fs.promises.mkdir(path.dirname(treeFile()), { recursive: true })
  await fs.promises.writeFile(treeFile(), yaml.dump({
    nodeId: 'root', typeId: TYPE,
    root: [{ id: `f-${name}`, kind: 'folder', name, children: [{ id: `i-${name}`, kind: 'item', objectId: reqId, children: [] }] }],
  }))
})

async function showType(): Promise<void> {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(LABEL)
  await combo.press('Enter')
}

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }> }>('schema:get', localPath)
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push({
    name: TYPE, label: LABEL, prefix: 'GH361', category: 'requirement', fields: [],
    statuses: [{ name: 'draft', label: 'Brouillon' }],
  })
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: 'Rangée par l’agent', fields: {} })).id
})

test('arbre affiché : écriture de l’agent refusée ; autre onglet : acceptée ; retour : rangement affiché', async () => {
  const { localPath } = s.project
  await showType()
  await expect(s.page.getByText('Rangée par l’agent').first()).toBeVisible()
  await expect.poll(() => readAppLock(localPath, 'root', TYPE)).not.toBeNull()

  await expect(agentWrite('Refusé')).rejects.toMatchObject({ code: 'TREE_LOCKED' })
  expect(fs.existsSync(treeFile())).toBe(false)

  // Onglet Tests : le panneau affiche un autre type, le verrou de l'exigence est rendu.
  await s.openView('Tests')
  await expect.poll(() => readAppLock(localPath, 'root', TYPE)).toBeNull()
  await agentWrite('Agent')

  // Retour : l'arbre affiché est relu à la prise du verrou.
  await showType()
  await expect.poll(() => readAppLock(localPath, 'root', TYPE)).not.toBeNull()
  await expect(s.page.getByText('Agent', { exact: true }).first()).toBeVisible()
  await s.shot('gh361-agent-folder')
  await expect(agentWrite('Encore')).rejects.toMatchObject({ code: 'TREE_LOCKED' })
  expect(await fs.promises.readFile(treeFile(), 'utf-8')).toContain('name: Agent')
})

test('aller-retour par Suivi (même type gardé en mémoire) : l’arbre affiché est rechargé, pas l’ancien', async () => {
  const { localPath } = s.project
  await showType()
  await expect(s.page.getByText('Agent', { exact: true }).first()).toBeVisible()

  await s.openView('Suivi')
  await expect.poll(() => readAppLock(localPath, 'root', TYPE)).toBeNull()
  await agentWrite('Depuis Suivi')

  await s.openView('Exigences')
  await expect.poll(() => readAppLock(localPath, 'root', TYPE)).not.toBeNull()
  const sidebar = s.page.getByTestId('sidebar')
  await expect(sidebar.getByText('Depuis Suivi', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('Agent', { exact: true })).toHaveCount(0)
  await s.shot('gh361-reload-after-suivi')
})
