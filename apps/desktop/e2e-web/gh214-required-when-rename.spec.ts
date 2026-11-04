import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH214 — renommer un statut, un champ ou une valeur d'enum dans l'onglet Structure réécrit les
 * `requiredWhen` qui les citent : la condition reste active. Un type dédié (préfixe GHW) est créé
 * par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 400/, /status of 422/, /status of 500/, /obligatoire quand/))

interface FieldLike { name: string; type: string; values?: string[]; requiredWhen?: Record<string, unknown[]> }
interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: FieldLike[]; statuses?: Array<{ name: string }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ReqLike { id: string; status: string }

const TYPE_NAME = 'gh214_cond'
const TYPE_LABEL = 'GH214 Conditions'
const REF = `root::${TYPE_NAME}`

const schema = () => s.invoke<SchemaLike>('schema:get', s.project.localPath)
const ourType = async () => (await schema()).nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === TYPE_NAME)!
const condition = async () => (await ourType()).fields.find(f => f.name === 'rationale')!.requiredWhen
const confirmDialog = () => s.page.getByRole('dialog', { name: 'Renommer des valeurs ?' })
const save = () => s.page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
const rowOf = (fieldName: string) => s.page.locator('tr').filter({ has: s.page.locator(`input[value="${fieldName}"]`) })

async function openElementModal() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByRole('button', { name: new RegExp(TYPE_LABEL) }).first().click()
  await expect(s.page.getByText('Historiser le statut')).toBeVisible()
}

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await schema()
  const root = current.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHW', category: 'requirement',
    fields: [
      { name: 'niveau', type: 'enum', values: ['bas', 'haut'] },
      { name: 'rationale', type: 'text', requiredWhen: { status: ['approved'], niveau: ['haut'] } },
    ],
    statuses: [{ name: 'draft' }, { name: 'approved' }],
  }]
  await s.invoke('schema:save', localPath, current)
})

test('statut renommé : la condition suit et bloque toujours l\'approbation', async () => {
  await openElementModal()
  await s.page.locator('input[value="approved"]').first().fill('validated')
  await save()
  await confirmDialog().getByRole('button', { name: 'Enregistrer et migrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  expect(await condition()).toEqual({ status: ['validated'], niveau: ['haut'] })

  // Le symptôme de l'issue : sans le correctif, la transition passe sans justification.
  const { localPath } = s.project
  const req = await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH214 A', fields: { niveau: 'bas' } })
  const refused = await s.invoke('requirements:transition', localPath, req.id, { toStatus: 'validated' }).then(() => null, (e: unknown) => String(e))
  expect(refused).toContain('obligatoire quand')
  expect((await s.invoke<ReqLike>('requirements:get', localPath, req.id)).status).toBe('draft')

  // Rouverte, l'édition ne signale aucune référence inconnue.
  await openElementModal()
  const input = rowOf('rationale').getByTestId('required-when-input')
  await expect(input).toHaveValue('status = validated; niveau = haut')
  await expect(rowOf('rationale').getByText('⚠')).toHaveCount(0)
  await s.page.keyboard.press('Escape')
})

test('champ et valeur d\'enum renommés dans la même édition : clé et valeur suivent', async () => {
  await openElementModal()
  const row = rowOf('niveau')
  await row.locator('input').nth(2).fill('bas, eleve')
  await row.locator('input').first().fill('criticite')
  await save()
  await expect(confirmDialog()).toContainText('haut → eleve')
  await confirmDialog().getByRole('button', { name: 'Enregistrer et migrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  expect(await condition()).toEqual({ status: ['validated'], criticite: ['eleve'] })
})

test('renommage décoché : la condition garde l\'ancienne valeur, l\'éditeur la signale', async () => {
  await openElementModal()
  await s.page.locator('input[value="validated"]').first().fill('accepted')
  await save()
  await confirmDialog().getByRole('checkbox').first().uncheck()
  await confirmDialog().getByRole('button', { name: 'Enregistrer et migrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  expect(await condition()).toEqual({ status: ['validated'], criticite: ['eleve'] })

  await openElementModal()
  await expect(rowOf('rationale').getByText('⚠')).toBeVisible()
  await s.page.keyboard.press('Escape')
})
