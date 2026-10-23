import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH136 — le libellé d'un statut (`statuses[].label`) est affiché dans la vue tableau (cellule,
 * liste déroulante d'édition) et dans le formulaire d'édition ; le nom technique reste la valeur
 * stockée. Un type dédié (préfixe GHS) est créé par le test (IPC).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string; label?: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const TYPE_NAME = 'gh136_statuts'
const TYPE_LABEL = 'GH136 Statuts'
const REF = `root::${TYPE_NAME}`
let reqId = ''

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHS', category: 'requirement', fields: [],
    statuses: [{ name: 'brouillon', label: 'Brouillon GH136' }, { name: 'valide', label: 'Validé Allo Médic', isApproval: true }],
  }]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH136 A', status: 'valide' })).id
})

const row = () => s.page.locator('tr').filter({ hasText: reqId }).first()

async function openTable() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

test('GH136-1 — vue tableau : cellule et liste déroulante affichent le libellé', async () => {
  await openTable()
  const cell = row().locator('td').filter({ hasText: 'Validé Allo Médic' })
  await expect(cell).toHaveCount(1)
  await expect(row().locator('td').filter({ hasText: /^valide$/ })).toHaveCount(0)

  await cell.dblclick()
  const select = row().locator('select')
  await expect(select.locator('option')).toHaveText(['Brouillon GH136', 'Validé Allo Médic'])
  await expect(select).toHaveValue('valide')
  await s.shot('gh136-excel')
  await select.press('Escape')
})

test('GH136-2 — formulaire d\'édition : le champ Statut affiche le libellé', async () => {
  await openTable()
  await row().getByTitle(/Éditer|Modifier/).first().click()
  const select = s.page.locator('select').filter({ has: s.page.locator('option[value="valide"]') }).first()
  await expect(select).toHaveValue('valide')
  await expect(select.locator('option:checked')).toHaveText('Validé Allo Médic')
  await s.shot('gh136-form')
})
