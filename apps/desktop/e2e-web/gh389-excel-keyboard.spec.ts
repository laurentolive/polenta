import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH389 — clavier de la Vue Excel (specs/GH389-tests.md E5 côté Excel, spec §1.7 et §3) : flèches,
 * Tab / Maj+Tab, Maj+↓, ←/→ sur un dossier, Entrée (= F2) puis Échap sans écriture, Tab dans un
 * éditeur, cellule hors écran ramenée visible, Entrée de la boîte de suppression ; Espace dans le
 * sélecteur de tests d'une campagne (mode sélection). Type, éléments et arbre créés par IPC / fixture.
 */
const s = setupSession()

const TYPE = 'gh389k_req'
const REF = `root::${TYPE}`
const LABEL = 'GH389K Exigence'
const COLS = ['section', 'name', 'id', 'status', 'note']
let ids: string[] = []
let username = ''

const treeFile = () => path.join(s.project.localPath, '.polenta', 'trees', 'root', `${TYPE}.yaml`)
const grid = () => s.page.locator('[data-excel-grid]')
const row = (n: number) => grid().locator(`tr[data-node-id="n${n}"]`)
const cell = (n: number, col: string) => row(n).locator(`td[data-col="${col}"]`)
const active = () => grid().locator('td[data-active]')
const press = (key: string) => s.page.keyboard.press(key)
const note = async (n: number) => (await s.invoke<{ fields: Record<string, unknown> }>('requirements:get', s.project.localPath, ids[n - 1])).fields.note

async function expectActive(n: number, col: string) {
  await expect(active()).toHaveCount(1)
  await expect(active()).toHaveAttribute('data-col', col)
  await expect(row(n).locator('td[data-active]')).toHaveCount(1)
}

async function openTable() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await expect(row(1)).toBeVisible()
}

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }> }>('schema:get', localPath)
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push({
    name: TYPE, label: LABEL, prefix: 'GH389K', category: 'requirement',
    fields: [{ name: 'note', label: 'Note', type: 'text' }],
    statuses: [{ name: 'draft', label: 'Brouillon' }],
  })
  await s.invoke('schema:save', localPath, schema)
  ids = []
  for (let i = 1; i <= 40; i++) {
    ids.push((await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REF, title: `K${i}`, fields: { note: `note ${i}` } })).id)
  }
  const item = (i: number) => ({ id: `n${i}`, kind: 'item', name: `K${i}`, objectId: ids[i - 1], children: [] })
  await fs.promises.mkdir(path.dirname(treeFile()), { recursive: true })
  await fs.promises.writeFile(treeFile(), yaml.dump({
    nodeId: 'root', typeId: TYPE,
    root: [
      { id: 'f1', kind: 'folder', name: 'Premier', children: [1, 2, 3].map(item) },
      { id: 'f2', kind: 'folder', name: 'Second', children: Array.from({ length: 37 }, (_, i) => item(i + 4)) },
    ],
  }))
  username = await s.invoke<string>('auth:project-username', localPath)
  // Colonne Note très large : la cellule active doit être ramenée à l'écran horizontalement aussi.
  await s.invoke('pref:set-field-visibility', localPath, username, REF, { excel: COLS, colWidthsExcel: { note: 2400 } })
})

test('E5 — flèches, Tab, Maj+↓, dossier, Entrée / Échap, Tab dans l’éditeur, cellule ramenée à l’écran', async () => {
  await openTable()

  // ↓ ×3 puis → ×2 : la ligne de dossier « Second » n'a qu'une cellule (nom), la colonne est reprise ensuite.
  await cell(1, 'name').click()
  await expectActive(1, 'name')
  for (let i = 0; i < 3; i++) await press('ArrowDown')
  await expect(grid().locator('tr[data-node-id="f2"] td[data-active]')).toHaveAttribute('data-col', 'name')
  await press('ArrowDown')
  await expectActive(4, 'name')
  await press('ArrowRight')
  await press('ArrowRight')
  await expectActive(4, 'status')
  // ↑↓ : la ligne devient la sélection.
  await expect(row(4)).toHaveAttribute('data-selected', '')
  await expect(grid().locator('tr[data-selected]')).toHaveCount(1)

  // ←/→ sur une ligne de dossier : replier / déplier.
  await press('ArrowUp')
  await expect(grid().locator('tr[data-node-id="f2"] td[data-active]')).toHaveCount(1)
  await press('ArrowLeft')
  await expect(row(4)).toHaveCount(0)
  await press('ArrowRight')
  await expect(row(4)).toBeVisible()
  await press('ArrowDown')
  await expectActive(4, 'name')

  // Tab en bout de ligne → première cellule de la ligne suivante ; Maj+Tab revient.
  for (let i = 0; i < 3; i++) await press('ArrowRight')
  await expectActive(4, 'note')
  // Cellule hors écran (colonne de 2 400 px) ramenée dans la zone visible.
  const box = await grid().boundingBox()
  const noteBox = await active().boundingBox()
  expect(noteBox!.x).toBeLessThan(box!.x + box!.width)
  expect(noteBox!.x + noteBox!.width).toBeGreaterThan(box!.x)
  await press('Tab')
  await expectActive(5, 'section')
  await press('Shift+Tab')
  await expectActive(4, 'note')

  // Maj+↓ : plage de lignes.
  await press('Shift+ArrowDown')
  await expectActive(5, 'note')
  await expect(row(4)).toHaveAttribute('data-selected', '')
  await expect(row(5)).toHaveAttribute('data-selected', '')

  // Entrée ouvre l'éditeur de la cellule ; Échap le referme sans écrire.
  await press('ArrowUp')
  await press('Enter')
  const editor = cell(4, 'note').locator('textarea, input')
  await expect(editor).toBeFocused()
  await s.page.keyboard.type(' modifiée')
  await press('Escape')
  await expect(editor).toHaveCount(0)
  expect(await note(4)).toBe('note 4')
  await expectActive(4, 'note')

  // Tab dans l'éditeur : valide puis passe à la cellule suivante.
  await press('Enter')
  await expect(editor).toBeFocused()
  await s.page.keyboard.type(' bis')
  await press('Tab')
  await expect(editor).toHaveCount(0)
  await expectActive(5, 'section')
  await expect.poll(() => note(4)).toBe('note 4 bis')

  // Cellule active ramenée à l'écran verticalement (↓ jusqu'au bas du tableau).
  for (let i = 0; i < 35; i++) await press('ArrowDown')
  await expectActive(40, 'section')
  const g = (await grid().boundingBox())!
  const last = (await active().boundingBox())!
  expect(last.y).toBeGreaterThanOrEqual(g.y)
  expect(last.y + last.height).toBeLessThanOrEqual(g.y + g.height + 1)

  // Boîte de suppression ouverte : Entrée la confirme (pas d'éditeur).
  await press('Delete')
  await expect(s.page.getByText('Supprimer', { exact: true }).first()).toBeVisible()
  await press('Enter')
  await expect(row(40)).toHaveCount(0)
  await expect(grid().locator('textarea')).toHaveCount(0)
  await s.shot('gh389-excel-keyboard')
})

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test('E5 — sélecteur de tests (mode sélection) : flèches et Espace', async () => {
  const { localPath, workspaceDir } = s.project
  const p = s.page
  const tests = await s.invoke<Array<{ id: string; objectTypeRef: string }>>('tests:list', localPath)
  const typeRef = tests[0]?.objectTypeRef
  test.skip(!typeRef, 'la démo doit avoir des tests')
  await s.invoke('pref:set-field-visibility', localPath, username, typeRef, { picker: ['section', 'name', 'id'], showFoldersPicker: false })
  const campaign = await s.invoke<{ id: string }>('campaigns:create', localPath, { title: 'GH389 clavier', testCaseIds: [] }, workspaceDir)
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: localPath }))
  await p.getByText('Ajouter des tests').click()
  await p.locator(`select:has(option[value="${typeRef}"])`).selectOption(typeRef!)
  const rows = grid().locator('tbody tr[data-node-id]')
  await expect(rows.first()).toBeVisible()
  const box = (i: number) => rows.nth(i).locator('input[type="checkbox"]').first()

  // Clic : la ligne est cochée et sa cellule active.
  await rows.nth(0).locator('td[data-col="id"]').click()
  await expect(box(0)).toBeChecked()
  // ↓ : la cellule descend, la sélection ne change pas (mode cases).
  await press('ArrowDown')
  await expect(rows.nth(1).locator('td[data-active]')).toHaveAttribute('data-col', 'id')
  await expect(box(1)).not.toBeChecked()
  // Espace coche / décoche la ligne active.
  await press(' ')
  await expect(box(1)).toBeChecked()
  await press(' ')
  await expect(box(1)).not.toBeChecked()
  await press('ArrowUp')
  await press(' ')
  await expect(box(0)).not.toBeChecked()
  // Lecture seule : Entrée n'ouvre aucun éditeur.
  await press('Enter')
  await expect(grid().locator('textarea, select')).toHaveCount(0)
  // Échap ferme toujours la modale (cellule active ou non).
  await p.keyboard.press('Escape')
  const abandon = p.locator('button.btn-danger', { hasText: 'Abandonner' })
  if (await abandon.isVisible().catch(() => false)) await abandon.click()
  await expect(p.getByTestId('picker-columns-button')).toHaveCount(0)
})
