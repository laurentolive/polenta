import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH139 — colonnes par défaut portées par le schéma (`defaultVisible` sur les champs) ; « Réinitialiser »
 * retire le choix personnel et revient à ce défaut. Un type dédié (préfixe GHV) est créé par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const TYPE_NAME = 'gh139_visible'
const TYPE_LABEL = 'GH139 Visible'
const REF = `root::${TYPE_NAME}`
let reqId = ''

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHV', category: 'requirement',
    fields: [
      { name: 'premier', label: 'Premier GH139', type: 'text' },
      { name: 'cache', label: 'Caché GH139', type: 'text' },
      { name: 'marque', label: 'Marqué GH139', type: 'text', defaultVisible: true },
    ],
  }]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH139 A' })).id
})

const header = (label: string) => s.page.locator('th').filter({ hasText: label })
const modal = () => s.page.locator('.fixed.inset-0.z-50')

async function openTable() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

test('GH139-1 — défaut du schéma, choix personnel, Réinitialiser revient au défaut du schéma', async () => {
  await openTable()
  await expect(s.page.locator('tr').filter({ hasText: reqId }).first()).toBeVisible()
  await expect(header('Marqué GH139')).toHaveCount(1)
  await expect(header('Premier GH139')).toHaveCount(0)   // un champ marqué : plus de « 3 premiers »

  await s.page.getByTitle('Configurer les colonnes').click()
  await modal().getByTestId('field-config-field-marque').click()
  await modal().getByTestId('field-config-field-cache').click()
  await expect(header('Marqué GH139')).toHaveCount(0)
  await expect(header('Caché GH139')).toHaveCount(1)

  await modal().getByTestId('field-config-reset').click()
  await expect(header('Marqué GH139')).toHaveCount(1)
  await expect(header('Caché GH139')).toHaveCount(0)
  await s.shot('gh139-reset')
})
