import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH222 sprint 5 — édition depuis la vue de diff d'une modification locale (specs/GH222.md §12,
 * critères 15–19) : « ← Rétablir » en Raw et en Rendu, édition en place, « + Ajouter »,
 * « Enregistrer » (fichier écrit, exigence par son service), refus d'un fichier changé sur le
 * disque, pas d'édition sur le diff d'un commit.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
const DIR = 'gh222e'
const base = { titre: 'avant', seuil: 10, liste: ['a', 'b'] }
let commitSha = ''
let reqId = ''
let reqFile = ''

const full = (rel: string) => path.join(s.project.localPath, rel)
const write = async (rel: string, content: string) => {
  await fs.promises.mkdir(path.dirname(full(rel)), { recursive: true })
  await fs.promises.writeFile(full(rel), content)
}
const read = (rel: string) => fs.promises.readFile(full(rel), 'utf8')

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<{ nodes: Array<{ objectTypes?: Array<{ name: string; category: string }> }> }>('schema:get', localPath)
  const type = schema.nodes.flatMap(n => n.objectTypes ?? []).find(t => t.category === 'requirement')!
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: 'GH222 édition' }, workspaceDir)).id
  await write(`${DIR}/config.yaml`, dump(base))
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, 'GH222 édition base')
  commitSha = await s.invoke<string>('git:head-sha', localPath)
  const files = await s.invoke<Array<{ path: string }>>('sync:commit-files', localPath, commitSha)
  reqFile = files.find(f => f.path.endsWith(`${reqId}.yaml`))!.path
})

async function openLocalDiff(rel: string, mode: 'Raw' | 'Rendu', sha?: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/diff', { repoPath: s.project.localPath, filepath: rel, ...(sha ? { commitSha: sha } : {}) }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: mode }).click()
}
const editBar = () => s.page.getByTestId('diff-edit-bar')
const saveButton = () => editBar().getByRole('button', { name: 'Enregistrer' })

test('15/16 — Raw : « ← Rétablir » un bloc puis Enregistrer écrit le fichier', async () => {
  await write(`${DIR}/config.yaml`, dump({ ...base, titre: 'après', seuil: 99 }))
  await openLocalDiff(`${DIR}/config.yaml`, 'Raw')
  await expect(editBar()).toBeVisible()
  await expect(s.page.locator('.cm-diff-restore')).not.toHaveCount(0)
  await s.page.locator('.cm-diff-restore').first().click()
  await expect(editBar()).toContainText('Modifications non enregistrées')
  await saveButton().click()
  await expect(editBar()).toContainText('Enregistré')
  expect(yaml.load(await read(`${DIR}/config.yaml`))).toMatchObject({ titre: 'avant' })
})

test('15/16 — Rendu : modifier une valeur, ajouter un élément, rétablir une rangée', async () => {
  await write(`${DIR}/config.yaml`, dump({ ...base, seuil: 99 }))
  await openLocalDiff(`${DIR}/config.yaml`, 'Rendu')
  const view = s.page.getByTestId('tree-diff')
  await view.locator('[data-restore="/seuil"]').click()
  await view.locator('[data-node="/titre"] input').fill('nouveau')
  await view.locator('[data-node="/liste"] [data-add]').click()
  await saveButton().click()
  await expect(editBar()).toContainText('Enregistré')
  expect(yaml.load(await read(`${DIR}/config.yaml`))).toEqual({ titre: 'nouveau', seuil: 10, liste: ['a', 'b', ''] })
})

test('17 — une exigence modifiée depuis le diff passe par son service', async () => {
  const text = await read(reqFile)
  await write(reqFile, text.replace('title: GH222 édition', 'title: GH222 édition locale'))
  await openLocalDiff(reqFile, 'Rendu')
  await s.page.getByTestId('object-diff').locator('[data-node="/title"] input').fill('GH222 depuis le diff')
  await saveButton().click()
  await expect(editBar()).toContainText('Enregistré')
  const req = await s.invoke<{ title: string }>('requirements:get', s.project.localPath, reqId)
  expect(req.title).toBe('GH222 depuis le diff')
})

test('changement sur le disque pendant l\'édition : enregistrement refusé, « Recharger »', async () => {
  await write(`${DIR}/config.yaml`, dump({ ...base, seuil: 5 }))
  await openLocalDiff(`${DIR}/config.yaml`, 'Rendu')
  await s.page.getByTestId('tree-diff').locator('[data-node="/titre"] input').fill('mien')
  await write(`${DIR}/config.yaml`, dump({ ...base, seuil: 6 }))
  await saveButton().click()
  await expect(s.page.getByTestId('diff-save-error')).toContainText('a changé sur le disque')
  await editBar().getByRole('button', { name: 'Recharger' }).click()
  await expect(s.page.getByTestId('diff-save-error')).toHaveCount(0)
  expect(yaml.load(await read(`${DIR}/config.yaml`))).toMatchObject({ seuil: 6, titre: 'avant' })
})

test('18 — le diff d\'un commit n\'est pas modifiable', async () => {
  await openLocalDiff(`${DIR}/config.yaml`, 'Rendu', commitSha)
  await expect(editBar()).toHaveCount(0)
  await expect(s.page.locator('[data-restore]')).toHaveCount(0)
})
