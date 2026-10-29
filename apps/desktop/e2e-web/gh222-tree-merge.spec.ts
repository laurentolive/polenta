import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH222 sprint 4 — vue générique en merge, mode Rendu (specs/GH222-tests.md R1–R4, R6, R8) :
 * colonne Structure en haut et dans la sortie, mêmes nœuds, actions dans les panneaux, cartes de
 * conflit, édition en place, pages `.drawio` au choix, finalisation.
 *
 * Fixture : quatre fichiers en conflit entre une branche et la branche courante — `links.yaml`,
 * un YAML générique, une exigence (énoncé modifié des deux côtés) et un `.drawio`.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
const DIR = 'gh222m'
let sessionId = ''
let reqId = ''
let reqFile = ''

interface TypeLike { name: string; category: string; fields?: Array<{ name: string; type: string; label?: string }> }
interface NodeLike { name: string; objectTypes?: TypeLike[] }

async function write(rel: string, content: string) {
  const full = path.join(s.project.localPath, rel)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, content)
}

async function commit(message: string) {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, message)
}

const link = (id: string, target: string) => ({ id, type: 'verification', sourceId: 'TEST-0001', targetId: target })
const page = (id: string, label: string) =>
  `  <diagram id="${id}" name="${id}">\n    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c" value="${label}" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel>\n  </diagram>`
const drawio = (label: string) => `<mxfile host="e2e">\n${page('p1', label)}\n</mxfile>\n`

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<{ nodes: NodeLike[] }>('schema:get', localPath)
  const type = schema.nodes.flatMap(n => n.objectTypes ?? []).find(t => t.category === 'requirement' && t.fields?.some(f => f.type === 'richtext'))!
  const rich = type.fields!.find(f => f.type === 'richtext')!.name
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: 'GH222 merge', fields: { [rich]: 'THE system SHALL start' } }, workspaceDir)).id

  const base = { title: 'base', note: 'commun', seuil: 10 }
  await write(`${DIR}/links/links.yaml`, dump({ links: [link('L1', 'SYS-0001'), link('L2', 'SYS-0002')] }))
  await write(`${DIR}/config.yaml`, dump(base))
  await write(`${DIR}/schema.drawio`, drawio('base'))
  await commit('GH222 merge base')
  const files = await s.invoke<Array<{ path: string }>>('sync:commit-files', localPath, await s.invoke<string>('git:head-sha', localPath))
  reqFile = files.find(f => f.path.endsWith(`${reqId}.yaml`))?.path ?? ''

  const branches = await s.invoke<Array<{ name: string; isCurrent: boolean }>>('sync:branches', localPath)
  const current = branches.find(b => b.isCurrent)!.name
  await s.invoke('sync:create-branch', localPath, 'gh222m-gauche')
  await write(`${DIR}/links/links.yaml`, dump({ links: [link('L1', 'SYS-0001'), link('L2', 'SYS-0008')] }))
  await write(`${DIR}/config.yaml`, dump({ ...base, title: 'gauche' }))
  await write(`${DIR}/schema.drawio`, drawio('gauche'))
  await s.invoke('requirements:update', localPath, reqId, { fields: { [rich]: 'THE system SHALL start in 1 s' } }, workspaceDir)
  await commit('GH222 merge gauche')
  await s.invoke('sync:checkout-branch', localPath, current)
  await write(`${DIR}/links/links.yaml`, dump({ links: [link('L1', 'SYS-0001'), link('L2', 'SYS-0009')] }))
  await write(`${DIR}/config.yaml`, dump({ ...base, title: 'droite' }))
  await write(`${DIR}/schema.drawio`, drawio('droite'))
  await s.invoke('requirements:update', localPath, reqId, { fields: { [rich]: 'THE system SHALL start in 500 ms' } }, workspaceDir)
  await commit('GH222 merge droite')
  sessionId = (await s.invoke<{ id: string }>('merge-resolution:open', localPath, 'gh222m-gauche', current,
    { kind: 'merge', from: 'gh222m-gauche', into: current })).id
})

async function openFile(name: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/merge-resolve', { id: sessionId }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByRole('button', { name: new RegExp(name) }).first().click()
  const rendered = s.page.getByRole('button', { name: 'Rendu', exact: true })
  if ((await rendered.getAttribute('aria-pressed')) !== 'true') await rendered.click()
}

const top = () => s.page.getByTestId('merge-tree-top')
const output = () => s.page.getByTestId('merge-tree-output')
const counter = () => s.page.getByTestId('diff-nav-counter')

test('R1/R4 — liens : même arbre en haut et dans la sortie, repli partagé ; « Prendre droite » dans le panneau de droite', async () => {
  await openFile('links.yaml')
  await expect(top().locator('[data-row-key="/links/@L2"]')).toBeVisible()
  await expect(output().locator('[data-row-key="/links/@L2"]')).toBeVisible()
  await expect(output().locator('[data-conflict-card="link:L2"]')).toBeVisible()
  await expect(top()).toContainText('SYS-0008')
  await expect(top()).toContainText('SYS-0009')
  // R4 — folding is shared: collapsing the link at the top hides its fields in the output too.
  await expect(output().locator('[data-row-key="/links/@L2/targetId"]')).toBeVisible()
  await top().locator('[data-row-key="/links/@L2"]').getByRole('button', { name: 'Replier' }).click()
  await expect(output().locator('[data-row-key="/links/@L2/targetId"]')).toHaveCount(0)
  await top().locator('[data-row-key="/links/@L2"]').getByRole('button', { name: 'Déplier' }).click()
  await top().getByRole('button', { name: 'Prendre droite →' }).click()
  await expect(counter()).toHaveText('Aucun conflit restant')
  await expect(output().locator('[data-resolved="link:L2"]')).toBeVisible()
  await s.shot('gh222-tree-merge-links')
  // Changing one's mind in Rendu: the other side from the output, Ctrl+Z back.
  await output().locator('[data-resolved="link:L2"]').getByRole('button', { name: '← Prendre gauche' }).click()
  await expect(output().locator('[data-resolved="link:L2"]')).toContainText('gauche')
  await s.page.keyboard.press('Control+z')
  await expect(output().locator('[data-resolved="link:L2"]')).toContainText('droite')

})

test('R2 — YAML générique : carte de conflit, édition en place reflétée en Raw', async () => {
  await openFile('config.yaml')
  await output().locator('[data-conflict-card="/title"]').getByRole('button', { name: '← Prendre gauche' }).click()
  const seuil = output().locator('[data-row-key="/seuil"]').locator('xpath=following-sibling::div[1]').locator('input')
  await seuil.fill('42')
  await s.page.getByRole('button', { name: 'Raw', exact: true }).click()
  await expect(s.page.locator('.cm-editor').last()).toContainText('seuil: 42')
  await expect(s.page.locator('.cm-editor').last()).toContainText('title: gauche')
  await s.page.getByRole('button', { name: 'Rendu', exact: true }).click()
})

test('R3 — exigence : libellés du schéma, carte de conflit sur l\'énoncé', async () => {
  test.skip(!reqFile, 'exigence non trouvée dans le commit de base')
  await openFile(reqId)
  const card = output().locator('[data-conflict-card^="fields."]')
  await expect(card).toBeVisible()
  await expect(top()).toContainText('1 s')
  await expect(top()).toContainText('500 ms')
  await expect(top().locator('[data-row-key="/history"]')).toHaveCount(0)
  await card.getByRole('button', { name: 'Prendre droite →' }).click()
  await expect(counter()).toHaveText('Aucun conflit restant')
})

test('R6 — .drawio : choix gauche / droite par page', async () => {
  await openFile('schema.drawio')
  await expect(s.page.getByTestId('drawio-merge').locator('[data-unit="page:p1"]')).toBeVisible()
  await s.page.getByTestId('drawio-merge').getByRole('button', { name: '← Prendre gauche' }).click()
  await expect(counter()).toHaveText('Aucun conflit restant')
})

test('R8 — finaliser après une résolution en Rendu', async () => {
  for (const name of ['links.yaml', 'config.yaml', reqId, 'schema.drawio']) {
    if (!name) continue
    await openFile(name)
    const all = s.page.getByRole('button', { name: 'Tout prendre à droite' })
    if (await all.isEnabled()) await all.click()
    await s.page.getByRole('button', { name: 'Merger', exact: true }).click()
  }
  await s.page.getByRole('button', { name: 'Finaliser le merge' }).click()
  await expect(s.page.getByText('Merge finalisé')).toBeVisible()
  const config = yaml.load(await fs.promises.readFile(path.join(s.project.localPath, DIR, 'config.yaml'), 'utf8')) as { title: string; seuil: number }
  expect(config).toMatchObject({ title: 'gauche', seuil: 42 })
})
