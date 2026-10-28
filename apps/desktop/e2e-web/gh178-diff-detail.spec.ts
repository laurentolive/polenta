import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH178 sprint 2 — finesse du mode Rendu (specs/GH178-tests.md) : diff mot à mot d'un richtext (G4),
 * étapes alignées (G5), fichier `.drawio` par page (G8), diagramme référencé modifié alors que le
 * YAML de l'exigence est identique (G9).
 *
 * Fixture écrite directement dans le repo (deux commits c3 → c4) : la vue de diff ne dépend que du
 * contenu des fichiers et de `objectTypeRef`.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface FieldLike { name: string; type: string }
interface TypeLike { name: string; category: string; fields?: FieldLike[] }
interface NodeLike { name: string; objectTypes?: TypeLike[]; children?: NodeLike[] }

const DIR = 'gh178-fixture'
const DRAWIO = `${DIR}/a.drawio`
const REQ = `${DIR}/REQ-W.yaml`
const REQ_MEDIA = `${DIR}/REQ-M.yaml`
const TEST = `${DIR}/TEST-W.yaml`
let c4 = ''

const cell = (id: string, value: string) =>
  `<mxCell id="${id}" value="${value}" style="rounded=0;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>`
const page = (id: string, name: string, value: string) =>
  `<diagram id="${id}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell(`${id}-c`, value)}</root></mxGraphModel></diagram>`
const drawioFence = (p: string, nodeId: string) => '```drawio\n' + JSON.stringify({ path: p, nodeId }) + '\n```'
const step = (action: string) => ({ order: 0, action, expectedResult: 'OK', notes: null })

function refsOf(nodes: NodeLike[], category: string): { ref: string; type: TypeLike }[] {
  return nodes.flatMap(n => [
    ...(n.objectTypes ?? []).filter(t => t.category === category).map(t => ({ ref: `${n.name}::${t.name}`, type: t })),
    ...refsOf(n.children ?? [], category),
  ])
}

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: NodeLike[] }>('schema:get', localPath)
  const req = refsOf(schema.nodes, 'requirement').find(r => r.type.fields?.some(f => f.type === 'richtext'))!
  const richField = req.type.fields!.find(f => f.type === 'richtext')!.name
  const testRef = refsOf(schema.nodes, 'test')[0].ref

  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(localPath, rel)), { recursive: true })
    fs.writeFileSync(path.join(localPath, rel), content)
  }
  const reqYaml = (id: string, statement: string) => yaml.dump({
    id, objectTypeRef: req.ref, title: `GH178 ${id}`, status: 'draft', version: 1, fields: { [richField]: statement }, jiraLinks: [],
  })
  const testYaml = (steps: unknown[]) => yaml.dump({ id: 'TEST-W', objectTypeRef: testRef, title: 'GH178 test', status: 'draft', version: 1, steps })
  const commit = async (message: string) => {
    await s.invoke('sync:stage-all', localPath)
    await s.invoke('sync:commit', localPath, message)
    return s.invoke<string>('git:head-sha', localPath)
  }

  write(DRAWIO, `<mxfile>${page('p1', 'Vue', 'Vue')}${page('p2', 'Détail', 'Détail v1')}</mxfile>`)
  write(REQ, reqYaml('REQ-W', 'WHEN the user presses the button\nTHE system SHALL start within 500 ms'))
  write(REQ_MEDIA, reqYaml('REQ-M', `Schéma :\n\n${drawioFence(DRAWIO, 'p2')}\n`))
  write(TEST, testYaml([step('A'), step('B'), step('C')]))
  await commit('GH178 c3')

  write(DRAWIO, `<mxfile>${page('p1', 'Vue', 'Vue')}${page('p2', 'Détail', 'Détail v2')}${page('p3', 'Annexe', 'Annexe')}</mxfile>`)
  write(REQ, reqYaml('REQ-W', 'WHEN the user presses the button\nTHE system SHALL start within 300 ms'))
  write(TEST, testYaml([step('A'), step('N'), step('B'), step('C bis')]))
  c4 = await commit('GH178 c4')
})

async function openCommitDiff(filepath: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/diff', { repoPath: s.project.localPath, filepath, commitSha: c4 }))
  await s.page.waitForLoadState('networkidle')
  const rendered = s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: 'Rendu' })
  if ((await rendered.getAttribute('aria-pressed')) !== 'true') await rendered.click()
}

test('G4 — richtext : seuls les mots changés sont marqués', async () => {
  await openCommitDiff(REQ)
  const grid = s.page.getByTestId('object-diff')
  await expect(grid.locator('del.diff-del')).toHaveText(['500'])
  await expect(grid.locator('ins.diff-ins')).toHaveText(['300'])
  await s.shot('gh178-word-diff')
})

test('G5 — étapes : insertion alignée, étapes suivantes non décalées, modification en place', async () => {
  await openCommitDiff(TEST)
  const rows = s.page.getByTestId('steps-diff').locator('[data-step-row]')
  await expect(rows).toHaveCount(4)
  const attrs = await rows.evaluateAll(els => els.map(e => `${e.getAttribute('data-step-row')}${e.hasAttribute('data-changed') ? '*' : ''}`))
  expect(attrs).toEqual(['0:0', '-:1*', '1:2', '2:3*'])
  await expect(s.page.getByTestId('steps-diff').locator('del.diff-del')).toHaveCount(0)
  await expect(s.page.getByTestId('steps-diff').locator('ins.diff-ins')).toHaveText(['bis'])
  await s.shot('gh178-steps')
})

test('G8 — fichier .drawio : pages alignées par nom, page modifiée et page ajoutée encadrées', async () => {
  await openCommitDiff(DRAWIO)
  const view = s.page.getByTestId('drawio-diff')
  const pages = await view.locator('[data-page]').evaluateAll(els => els.map(e => `${e.getAttribute('data-page')}${e.hasAttribute('data-changed') ? '*' : ''}`))
  expect(pages).toEqual(['Vue', 'Détail*', 'Annexe*'])
  await expect(view.locator('.static-drawio')).toHaveCount(5)
  await expect(view.locator('.static-drawio.diff-media-del')).toHaveCount(1)
  await expect(view.locator('.static-drawio.diff-media-ins')).toHaveCount(2)
  await expect(view.locator('.static-drawio svg').first()).toBeVisible()
  await s.shot('gh178-drawio')
})

test('G9 — diagramme référencé modifié, YAML identique : chaque colonne à sa version, bloc encadré', async () => {
  await openCommitDiff(REQ_MEDIA)
  const grid = s.page.getByTestId('object-diff')
  await expect(grid.locator('.static-drawio.diff-media-del')).toHaveCount(1)
  await expect(grid.locator('.static-drawio.diff-media-ins')).toHaveCount(1)
  await expect(grid.locator('[data-unit^="fields."][data-changed]')).toHaveCount(1)
  await expect(grid.locator('.static-drawio.diff-media-del')).toContainText('Détail v1')
  await expect(grid.locator('.static-drawio.diff-media-ins')).toContainText('Détail v2')
  await s.shot('gh178-media')
})
