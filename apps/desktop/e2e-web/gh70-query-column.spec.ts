import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH70 sprint 1 — déclaration de colonne calculée dans la vue Requêtes : modèle « Dernier résultat
 * de campagne » (colonne générée, lecture seule), saisie sur une requête script partagée, requête
 * privée (indisponible), déclaration modifiée à la main invalide (specs/GH70-tests.md N1, N2, C1, C3).
 */
const s = setupSession()

let username: string
const queryYaml = (id: string) => path.join(s.project.localPath, 'queries', id, 'query.yaml')

test.beforeAll(async () => {
  username = await s.invoke<string>('auth:project-username', s.project.localPath)
})

async function openQuery(title: string) {
  await s.openView('Suivi')
  await s.page.getByText(title, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const editor = () => s.page.getByTestId('column-decl-editor')

test('N1 — modèle « Dernier résultat de campagne » : colonne générée, affichée en lecture seule', async () => {
  const q = await s.invoke<{ id: string; column: unknown; state: { customized: boolean } }>('queries:create', s.project.localPath, username, {
    title: 'GH70 dernier résultat', scope: 'shared', createdBy: username, template: { id: 'campaign-last-result', params: {} },
  })
  expect(q.state.customized).toBe(false)
  expect(yaml.load(fs.readFileSync(queryYaml(q.id), 'utf8'))).toMatchObject({
    column: { label: { fr: 'Dernier résultat', en: 'Last result' }, appliesTo: { categories: ['test'] }, type: 'enum' },
  })
  await openQuery('GH70 dernier résultat')
  await expect(editor().getByTestId('column-decl-enable')).toBeChecked()
  await expect(editor().getByTestId('column-decl-enable')).toBeDisabled()
  await expect(editor().getByTestId('column-decl-label')).toHaveValue('Dernier résultat')
  await expect(editor().getByTestId('column-decl-type')).toHaveValue('enum')
  await expect(s.page.getByTestId('script-error')).toHaveCount(0, { timeout: 15_000 })
  await s.shot('gh70-template-column')
})

test('N2 — requête script partagée : déclaration saisie, enregistrée, relue', async () => {
  const q = await s.invoke<{ id: string }>('queries:create', s.project.localPath, username, {
    title: 'GH70 score', scope: 'shared', createdBy: username,
    script: "export default (data) => data.requirements.map((r) => ({ id: r.id, value: r.title.length }))\n",
  })
  await openQuery('GH70 score')
  await editor().getByTestId('column-decl-enable').check()
  await editor().getByTestId('column-decl-label').fill('Longueur du titre')
  await editor().getByTestId('column-decl-category-test').uncheck()
  await editor().getByTestId('column-decl-category-requirement').check()
  await editor().getByTestId('column-decl-type').selectOption('enum')
  // Enum sans valeur : erreur affichée, enregistrement impossible.
  await expect(editor().getByTestId('column-decl-errors')).toContainText('valeurs manquantes')
  await expect(s.page.getByRole('button', { name: 'Sauvegarder', exact: true })).toBeDisabled()
  await editor().getByTestId('column-decl-type').selectOption('number')
  await expect(editor().getByTestId('column-decl-errors')).toHaveCount(0)
  await s.page.getByRole('button', { name: 'Sauvegarder', exact: true }).click()
  await expect.poll(() => (yaml.load(fs.readFileSync(queryYaml(q.id), 'utf8')) as { column?: unknown }).column).toEqual({
    label: 'Longueur du titre', appliesTo: { categories: ['requirement'], objectTypes: [] }, type: 'number',
  })
  await s.page.reload()
  await openQuery('GH70 score')
  await expect(editor().getByTestId('column-decl-label')).toHaveValue('Longueur du titre')
  await expect(editor().getByTestId('column-decl-type')).toHaveValue('number')
  await s.shot('gh70-script-column')
})

test('C1 — requête privée : déclaration indisponible ; « Enregistrer sous » en privé refusé', async () => {
  await s.invoke('queries:create', s.project.localPath, username, {
    title: 'GH70 privée', scope: 'private', createdBy: username, script: 'export default () => []\n',
  })
  await openQuery('GH70 privée')
  await expect(editor().getByTestId('column-decl-enable')).toBeDisabled()
  await expect(editor()).toContainText('réservé aux requêtes partagées')

  // Requête partagée avec colonne, enregistrée sous une copie privée : refus explicite.
  await openQuery('GH70 score')
  await s.page.getByRole('button', { name: 'Enregistrer sous…', exact: true }).click()
  await s.page.getByRole('radio', { name: 'Privée' }).check()
  await expect(s.page.getByTestId('save-column-private')).toBeVisible()
  await s.page.getByRole('button', { name: 'Annuler', exact: true }).click()
})

test('C3 — déclaration modifiée à la main invalide : erreur affichée, requête toujours exécutable', async () => {
  const q = await s.invoke<{ id: string }>('queries:create', s.project.localPath, username, {
    title: 'GH70 cassée', scope: 'shared', createdBy: username, script: 'export default () => []\n',
    column: { label: 'X', appliesTo: { categories: ['test'], objectTypes: [] }, type: 'text' },
  })
  fs.writeFileSync(queryYaml(q.id), fs.readFileSync(queryYaml(q.id), 'utf8').replace('type: text', 'type: drawio'))
  await openQuery('GH70 cassée')
  await expect(s.page.getByTestId('column-error')).toContainText('drawio')
  await expect(s.page.getByTestId('script-error')).toHaveCount(0)
})
