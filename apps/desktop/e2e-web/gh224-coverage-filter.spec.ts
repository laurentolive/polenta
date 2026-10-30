import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH224 — la colonne Couverture de la vue tableau est filtrable (filtre de colonne T51) sur le
 * libellé affiché par le badge. Un composant local dédié (types exigence / test, lien de
 * vérification) est créé par le test (IPC) : une exigence couverte, une non couverte.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string }> }
interface NodeLike { name: string; label?: string; objectTypes?: TypeLike[] }
interface SchemaLike { nodes: NodeLike[]; linkTypes?: Array<{ name: string; sourceRefs?: string[]; targetRefs?: string[] }> }
interface Obj { id: string }

const NODE = 'gh224comp'
const REQ_TYPE = 'gh224_req'
const REQ_LABEL = 'GH224 Exigences'
const TEST_TYPE = 'gh224_test'
const REQ_REF = `${NODE}::${REQ_TYPE}`
const statuses = [{ name: 'draft' }]
let coveredId = ''
let uncoveredId = ''

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  schema.nodes = [...schema.nodes, {
    name: NODE, label: 'GH224 Composant', objectTypes: [
      { name: REQ_TYPE, label: REQ_LABEL, prefix: 'GHC', category: 'requirement', fields: [], statuses },
      { name: TEST_TYPE, label: 'GH224 Tests', prefix: 'GHU', category: 'test', fields: [], statuses },
    ],
  }]
  schema.linkTypes = [...(schema.linkTypes ?? []), { name: 'gh224_verifies', sourceRefs: [`${NODE}::${TEST_TYPE}`], targetRefs: [REQ_REF] }]
  await s.invoke('schema:save', localPath, schema)

  coveredId = (await s.invoke<Obj>('requirements:create', localPath, { objectTypeRef: REQ_REF, title: 'GH224 couverte', fields: {} })).id
  uncoveredId = (await s.invoke<Obj>('requirements:create', localPath, { objectTypeRef: REQ_REF, title: 'GH224 non couverte', fields: {} })).id
  const testId = (await s.invoke<Obj>('tests:create', localPath, { objectTypeRef: `${NODE}::${TEST_TYPE}`, title: 'GH224 T', fields: {}, steps: [] })).id
  await s.invoke('requirements:link-create', localPath, { type: 'gh224_verifies', sourceId: testId, targetId: coveredId })

  // Colonne Couverture visible (désactivée par défaut dans la vue tableau, T138).
  const username = await s.invoke<string>('auth:project-username', localPath)
  await s.invoke('pref:set-field-visibility', localPath, username, REQ_REF, { excel: ['section', 'name', 'id', 'coverageStatus'] })
})

const row = (id: string) => s.page.locator('tr').filter({ hasText: id })

async function openTable() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(REQ_LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

test('GH224-1 — filtre de colonne Couverture sur le libellé du badge', async () => {
  await openTable()
  await expect(row(coveredId).getByText('Couvert', { exact: true })).toBeVisible()
  await expect(row(uncoveredId).getByText('Non couvert', { exact: true })).toBeVisible()

  const header = s.page.locator('th').filter({ hasText: 'Couverture' })
  const icon = header.getByTitle('Filtrer cette colonne')
  await icon.click()
  const input = s.page.locator('[data-column-filter-popover]').getByPlaceholder('Filtrer…')
  await expect(input).toBeVisible()

  await input.fill('non')
  await expect(row(uncoveredId)).toBeVisible()
  await expect(row(coveredId)).toHaveCount(0)

  // « contient » : « couvert » garde les deux lignes ; la regex isole « Couvert ».
  await input.fill('couvert')
  await expect(row(coveredId)).toBeVisible()
  await expect(row(uncoveredId)).toBeVisible()
  await s.page.locator('[data-column-filter-popover]').getByTitle(/expression régulière/i).click()
  await input.fill('^couvert')
  await expect(row(coveredId)).toBeVisible()
  await expect(row(uncoveredId)).toHaveCount(0)
  await expect(icon).toHaveClass(/text-status-info/)
  await s.shot('gh224-coverage-filter')

  await input.press('Escape')
  await expect(row(uncoveredId)).toBeVisible()
  await expect(row(coveredId)).toBeVisible()
})
