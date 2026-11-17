import * as fs from 'fs'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH389 E9 (spec §1.10, critère 9) — export Tableau de la Vue Excel : ce qui est affiché. Filtre de
 * colonne + filtre global en mode regex : le classeur ne contient que les lignes affichées (titre de
 * dossier compris), les colonnes visibles dans l'ordre avec leur titre, la colonne de lien avec ses ID,
 * la Vérification et le statut en libellés. Types, éléments, lien et arbre créés par IPC / fixture.
 */
const s = setupSession()

const REQ = 'gh389x_req'
const TST = 'gh389x_test'
const REF = `root::${REQ}`
const LABEL = 'GH389X Exigence'
const LINK = 'gh389x_verif'
let ids: string[] = []
let testIds: string[] = []

const treeFile = () => path.join(s.project.localPath, '.polenta', 'trees', 'root', `${REQ}.yaml`)
const grid = () => s.page.locator('[data-excel-grid]')

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }>; linkTypes?: unknown[] }>('schema:get', localPath)
  const statuses = [{ name: 'draft', label: 'Brouillon' }]
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push(
    {
      name: REQ, label: LABEL, prefix: 'GH389X', category: 'requirement', statuses,
      fields: [{ name: 'prio', label: 'Priorité', type: 'enum', values: ['h', 'b'], valueLabels: { h: 'Haute', b: 'Basse' } }],
    },
    { name: TST, label: 'GH389X Test', prefix: 'GH389T', category: 'test', fields: [], statuses },
  )
  schema.linkTypes = [...(schema.linkTypes ?? []), {
    name: LINK, labelSourceToTarget: 'vérifie', labelTargetToSource: 'vérifiée par', sourceRefs: [`root::${TST}`], targetRefs: [REF],
  }]
  await s.invoke('schema:save', localPath, schema)
  ids = []
  for (const [title, prio] of [['Alpha', 'h'], ['Bravo', 'b'], ['Charlie', 'h'], ['Delta', 'h']]) {
    ids.push((await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title, fields: { prio } })).id)
  }
  testIds = []
  for (const title of ['Essai 1', 'Essai 2']) {
    testIds.push((await s.invoke<{ id: string }>('tests:create', localPath, { objectTypeRef: `root::${TST}`, title, fields: {}, steps: [] })).id)
  }
  for (const t of testIds) await s.invoke('requirements:link-create', localPath, { type: LINK, sourceId: t, targetId: ids[0] })
  await fs.promises.mkdir(path.dirname(treeFile()), { recursive: true })
  await fs.promises.writeFile(treeFile(), yaml.dump({
    nodeId: 'root', typeId: REQ,
    root: [{ id: 'f1', kind: 'folder', name: 'Groupe', children: ids.map((id, i) => ({ id: `n${i}`, kind: 'item', name: ['Alpha', 'Bravo', 'Charlie', 'Delta'][i], objectId: id, children: [] })) }],
  }))
  const username = await s.invoke<string>('auth:project-username', localPath)
  await s.invoke('pref:set-field-visibility', localPath, username, REF, {
    excel: ['section', 'name', 'id', 'status', 'prio', `link::${LINK}`, 'coverageStatus'],
  })
})

test('E9 — export Tableau filtré : lignes, colonnes et textes affichés', async () => {
  const p = s.page
  await s.openView('Exigences')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(LABEL)
  await combo.press('Enter')
  await p.getByTitle('Vue tableau').click()
  await expect(grid().locator('tr[data-node-id="n0"]')).toBeVisible()

  // Filtre global en regex (Alpha, Bravo, Charlie) + filtre de colonne Priorité « Haute » : Alpha, Charlie.
  const sidebarFilter = p.getByPlaceholder('Filtrer…').first()
  await p.getByTitle(/expression régulière/i).first().click()
  await sidebarFilter.fill('^(Alpha|Bravo|Charlie)$')
  await p.getByTestId('excel-header-prio').locator('[data-column-filter-icon]').click()
  await p.locator('[data-column-filter-popover]').getByTestId('column-filter-input').fill('Haute')
  await p.getByTestId('excel-header-id').click()
  await expect(p.locator('[data-column-filter-popover]')).toHaveCount(0)
  const shown = await grid().locator('tbody tr[data-node-id]').evaluateAll(trs => trs.map(tr => (tr as HTMLElement).dataset.nodeId))
  expect(shown).toEqual(['f1', 'n0', 'n2'])
  const headers = await grid().locator('thead th[data-col]').evaluateAll(ths => ths.map(th => (th.firstChild?.textContent ?? '').trim()))

  await p.getByRole('button', { name: 'Exporter' }).first().click()
  const download = p.waitForEvent('download')
  await p.getByRole('button', { name: 'Excel' }).click()
  const file = path.join(E2E.downloadsDir, 'gh389-excel-export.xlsx')
  await (await download).saveAs(file)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets[0]
  const values = (r: number) => (sheet.getRow(r).values as unknown[]).slice(1).map(v => (v ?? '') as string)
  expect(values(1)).toEqual(headers)
  expect(sheet.rowCount).toBe(1 + 3)
  // Dossier : numéro de section et titre.
  expect(values(2).slice(0, 2)).toEqual(['1', 'Groupe'])
  // Lignes affichées, texte affiché : statut et priorité en libellés, ID des tests liés, couverture.
  expect(values(3).slice(1, 6)).toEqual(['Alpha', ids[0], 'Brouillon', 'Haute', testIds.join(', ')])
  expect(values(3)[6]).not.toBe('')
  expect(values(4).slice(1, 5)).toEqual(['Charlie', ids[2], 'Brouillon', 'Haute'])
})
