import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH265 — liste Composant / Élément : deux types d'un même composant portant le même libellé
 * affichent leur nom technique ; un type de libellé unique garde le sien.
 */
const s = setupSession()

const NODE = 'gh265_node'
const NODE_LABEL = 'GH265 Composant'
const statuses = [{ name: 'draft', label: 'Brouillon' }]

type SchemaLike = { nodes: unknown[] }

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const type = (name: string, label: string, prefix: string) =>
    ({ name, label, prefix, category: 'requirement', fields: [], statuses })
  schema.nodes = [...schema.nodes, {
    name: NODE, label: NODE_LABEL, objectTypes: [
      type('GH265_HMI', 'GH265 Exigence', 'GHH'),
      type('GH265_SW', 'GH265 Exigence', 'GHS'),
      type('GH265_SAFE', 'GH265 Sécurité', 'GHF'),
    ],
  }]
  await s.invoke('schema:save', localPath, schema)
})

test('les types de même libellé se distinguent, les autres gardent leur libellé', async () => {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(NODE_LABEL)

  const rows = s.page.locator('button').filter({ hasText: NODE_LABEL })
  await expect(rows).toHaveText([
    `${NODE_LABEL} / GH265_HMI`,
    `${NODE_LABEL} / GH265_SW`,
    `${NODE_LABEL} / GH265 Sécurité`,
  ])
})
