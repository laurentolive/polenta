import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH222 sprint 3 — vue générique d'un diff en mode Rendu (specs/GH222-tests.md T1–T4, T9–T11) :
 * colonne Structure à gauche (seule porteuse de la profondeur, compacte, redimensionnable), une
 * rangée par nœud, valeurs à la même position X, nœuds inchangés repliés, déplacements, navigation.
 * Fixtures écrites dans le repo du projet puis commitées (deux commits : base → modif).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
const DIR = 'gh222-tree'
let c2 = ''

async function write(rel: string, content: string) {
  const full = path.join(s.project.localPath, rel)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, content)
}

async function commit(message: string): Promise<string> {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, message)
  return s.invoke<string>('git:head-sha', localPath)
}

const link = (id: string, target: string) => ({ id, type: 'verification', sourceId: 'TEST-0001', targetId: target })
const deep = (leaf: string) => ({ a: { b: { c: { d: { e: { f: { g: { h: leaf } } } } } } }, top: 'x' })
const node = (id: string, children: unknown[] = []) => ({ id, kind: 'folder', children })

test.beforeAll(async () => {
  await write(`${DIR}/liens.yaml`, dump({ links: [link('L1', 'SYS-0001'), link('L2', 'SYS-0002'), link('L3', 'SYS-0003')] }))
  await write(`${DIR}/dashboard.yaml`, dump({ id: 'd', widgets: [{ id: 'w1', title: 'Avancement alpha' }, { id: 'w2', title: 'Autre' }] }))
  await write(`${DIR}/profond.yaml`, dump(deep('avant')))
  await write(`${DIR}/arbre.yaml`, dump({ nodeId: 'root', typeId: 't', root: [node('A', [node('N')]), node('B')] }))
  await write(`${DIR}/invalide.yaml`, dump({ ok: 1 }))
  await commit('GH222 tree base')
  await write(`${DIR}/liens.yaml`, dump({ links: [link('L1', 'SYS-0001'), link('L2', 'SYS-0009'), link('L3', 'SYS-0003')] }))
  await write(`${DIR}/dashboard.yaml`, dump({ id: 'd', widgets: [{ id: 'w1', title: 'Avancement beta' }, { id: 'w2', title: 'Autre' }] }))
  await write(`${DIR}/profond.yaml`, dump(deep('après')))
  await write(`${DIR}/arbre.yaml`, dump({ nodeId: 'root', typeId: 't', root: [node('A'), node('B', [node('N')])] }))
  await write(`${DIR}/invalide.yaml`, 'ok: [non fermé\n')
  c2 = await commit('GH222 tree modif')
})

async function openDiff(file: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/diff', { repoPath: s.project.localPath, filepath: `${DIR}/${file}`, commitSha: c2 }))
  await s.page.waitForLoadState('networkidle')
  const rendered = s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: 'Rendu' })
  if ((await rendered.getAttribute('aria-pressed')) !== 'true') await rendered.click()
}

const view = () => s.page.getByTestId('tree-diff')
const row = (key: string) => view().locator(`[data-row-key="${key}"]`)

test('T1 — liens : colonne Structure par id, lien modifié déplié, les autres repliés', async () => {
  await openDiff('liens.yaml')
  await expect(row('/links/@L2')).toHaveAttribute('data-changed', 'true')
  await expect(row('/links/@L2/targetId')).toBeVisible()
  await expect(row('/links/@L1/targetId')).toHaveCount(0)
  await expect(view()).toContainText('SYS-0009')
  await s.shot('gh222-tree-links')
})

test('T2 — dashboard : seul le widget modifié est déplié, titre mot à mot', async () => {
  await openDiff('dashboard.yaml')
  await expect(row('/widgets/@w1/title')).toBeVisible()
  await expect(row('/widgets/@w2/title')).toHaveCount(0)
  await expect(view().locator('del.diff-del')).toHaveText(['alpha'])
  await expect(view().locator('ins.diff-ins')).toHaveText(['beta'])
})

test('T3 — profondeur 8 : arbre dans 180 px, valeurs à la même position X', async () => {
  await openDiff('profond.yaml')
  const leaf = row('/a/b/c/d/e/f/g/h')
  await expect(leaf).toBeVisible()
  const tree = await leaf.boundingBox()
  expect(Math.round(tree!.width)).toBeLessThanOrEqual(181)
  expect(await leaf.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  // The value cells of a deep node and of a top-level one start at the same X.
  const valueX = async (key: string) => (await view().locator(`[data-node="${key}"] > div`).nth(2).boundingBox())!.x
  expect(await valueX('/a/b/c/d/e/f/g/h')).toBe(await valueX('/top'))
})

test('T4 — largeur de la colonne Structure réglable et mémorisée', async () => {
  await openDiff('profond.yaml')
  const handle = view().getByTestId('tree-resize')
  const box = (await handle.boundingBox())!
  await s.page.mouse.move(box.x + 2, box.y + 5)
  await s.page.mouse.down()
  await s.page.mouse.move(box.x + 62, box.y + 5, { steps: 4 })
  await s.page.mouse.up()
  await openDiff('liens.yaml')
  const width = (await row('/links/@L2').boundingBox())!.width
  expect(Math.round(width)).toBeGreaterThanOrEqual(235)
  // Back to the default for the other tests.
  await s.page.evaluate(() => localStorage.removeItem('polenta:diffTreeWidth'))
})

test('T9 — arbre d\'affichage : nœud déplacé montré à ses deux places', async () => {
  await openDiff('arbre.yaml')
  await expect(view().locator('[data-state="moved"]')).toHaveCount(2)
  await expect(view()).toContainText('déplacé vers sa nouvelle place')
})

test('T10 — nœud replié : résumé « n éléments, k modifié(s) » ; navigation F7', async () => {
  await openDiff('liens.yaml')
  await row('/links/@L2').getByRole('button', { name: 'Replier' }).click()
  await expect(view().locator('[data-node="/links/@L2"]')).toContainText('4 éléments, 1 modifié(s)')
  await s.page.keyboard.press('F7')
  await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Changement 1 / 1')
})

test('T11 — YAML invalide d\'un côté : Rendu indisponible, Raw fonctionne', async () => {
  await openDiff('invalide.yaml')
  await expect(s.page.getByText('Rendu indisponible')).toBeVisible()
  await s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: 'Raw' }).click()
  await expect(s.page.getByTestId('raw-diff')).toBeVisible()
  await s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: 'Rendu' }).click()
})
