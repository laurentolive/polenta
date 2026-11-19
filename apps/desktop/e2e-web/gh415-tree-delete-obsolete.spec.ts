import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH415 — « Supprimer » d'une exigence dans l'arbre : l'exigence passe au statut terminal
 * (obsolète), quitte l'arbre, et ne réapparaît pas au changement de vue. Le fichier de l'objet
 * reste sur disque. Type et exigences créés par IPC.
 */
const s = setupSession()

const TYPE = 'gh415_req'
const LABEL = 'GH415 Exigence'
const REF = `root::${TYPE}`
const KEEP = 'GH415 garde'
const DROP = 'GH415 toto'
let dropId = ''

// L'arbre est la sidebar ; le tableau de la vue Excel affiche les mêmes titres.
const tree = () => s.page.getByTestId('sidebar').getByText(DROP, { exact: true })
const treeFile = () => path.join(s.project.localPath, '.polenta', 'trees', 'root', `${TYPE}.yaml`)

async function selectType() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(LABEL)
  await combo.press('Enter')
  await expect(s.page.getByTestId('sidebar').getByText(KEEP, { exact: true })).toBeVisible()
}

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }> }>('schema:get', localPath)
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push({
    name: TYPE, label: LABEL, prefix: 'GH415', category: 'requirement', fields: [],
    statuses: [
      { name: 'draft', label: 'Brouillon' },
      { name: 'obsolete', label: 'Obsolète', isTerminal: true },
    ],
  })
  await s.invoke('schema:save', localPath, schema)
  await s.invoke('requirements:create', localPath, { objectTypeRef: REF, title: KEEP, fields: {} })
  dropId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: DROP, fields: {} })).id
  await fs.promises.rm(treeFile(), { force: true })
})

test('GH415 — Supprimer dans l’arbre : obsolète, hors de l’arbre, et pas de retour au changement de vue', async () => {
  await selectType()
  await tree().click()
  await s.page.keyboard.press('Delete')
  await s.page.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(tree()).toHaveCount(0)

  // Changement de vue, puis retour : l'objet ne doit pas réapparaître « non classé ».
  await s.openView('Tests')
  await selectType()
  await expect(s.page.getByTestId('sidebar').getByText(KEEP, { exact: true })).toBeVisible()
  await expect(tree()).toHaveCount(0)

  // Le fichier de l'objet n'est pas supprimé : seul son statut change.
  const req = await s.invoke<{ status: string }>('requirements:get', s.project.localPath, dropId)
  expect(req.status).toBe('obsolete')
})
