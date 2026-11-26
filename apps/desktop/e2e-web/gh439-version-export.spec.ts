import * as fs from 'fs'
import * as path from 'path'
import ExcelJS from 'exceljs'
import * as yaml from 'js-yaml'
import { test, expect, type Page } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH439 — export global de la page d'une version (specs/GH439-tests.md X1 à X13) : fenêtre de choix des sections,
 * Excel (une feuille par section) et PDF (A4 paysage), parité entre les deux. Le PDF n'a pas de lecteur de texte
 * ici : sa structure est vérifiée sur le fichier (en-tête, pages, format) et son contenu sur la route imprimable
 * `/print/version`, la même que celle que le moteur imprime.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string; label?: string; isApproval?: boolean; isTerminal?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface VersionPageLike { typeDef: { statuses?: Array<{ name: string; isTerminal?: boolean }> } }

const COUNT = 300
const ALL_SECTIONS = ['info', 'changes', 'analysis', 'tests', 'requirements']
let frozenId = ''
let currentId = ''
let abandonedFrozenId = ''
let firstId = ''
let lastId = ''

const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
const commit = async (message: string) => {
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), message)
}
async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const openVersion = async (id: string) => {
  await navigate(s.page, s.projectUrl(`/version/${id}`, { repoPath: repo() }))
  await expect(s.page.getByTestId('version-page')).toBeVisible()
}

const openExport = async () => {
  await s.page.getByTestId('export-button').click()
  await expect(s.page.getByTestId('export-choices')).toBeVisible()
}
/** Coche exactement ces sections (clics souris sur les cases : leçon GH416). */
async function choose(keys: string[]) {
  const boxes = s.page.getByTestId('export-choices').locator('input[type="checkbox"]')
  for (let i = 0; i < await boxes.count(); i++) {
    const box = boxes.nth(i)
    const key = (await box.getAttribute('data-testid'))!.replace('export-choice-', '')
    await box.setChecked(keys.includes(key))
  }
}
async function exportAs(format: 'xlsx' | 'pdf', name: string): Promise<string> {
  const download = s.page.waitForEvent('download', { timeout: 120_000 })
  await s.page.getByTestId(`export-format-${format}`).click()
  const d = await download
  const target = path.join(E2E.downloadsDir, `gh439-${name}-${d.suggestedFilename()}`)
  await d.saveAs(target)
  await expect(s.page.getByText(/^Téléchargé :/)).toBeVisible()
  await s.page.getByRole('button', { name: 'Fermer' }).click()
  return target
}
async function exportSections(format: 'xlsx' | 'pdf', keys: string[], name: string): Promise<string> {
  await openExport()
  await choose(keys)
  return exportAs(format, name)
}

interface Sheet { name: string; header: string[]; rows: string[][] }
async function readSheets(file: string): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const cells = (ws: ExcelJS.Worksheet, r: number) => (ws.getRow(r).values as unknown[]).slice(1).map(v => (v == null ? '' : typeof v === 'object' ? String((v as { text?: string }).text ?? '') : String(v)))
  return wb.worksheets.map(ws => ({
    name: ws.name,
    header: cells(ws, 1),
    rows: Array.from({ length: ws.rowCount - 1 }, (_, i) => cells(ws, i + 2)),
  }))
}
const REQ_SHEET = /Exigences|Requirements/

test.beforeAll(async () => {
  test.setTimeout(600_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh439x_req', label: 'GH439X Exigence', prefix: 'GH439XR', category: 'requirement',
    fields: [{ name: 'details', label: 'Détails GH439X', type: 'richtext', defaultVisible: true }],
    statuses: [{ name: 'draft', label: 'Brouillon' }],
  }]
  typeOfCategory(root, 'version', {
    name: 'gh439x_version', label: 'Version', prefix: 'GH439XP', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  })
  await s.invoke('schema:save', repo(), schema)
  // 300 exigences à champ richtext long, écrites sur le disque (plus rapide que 300 créations) puis commitées.
  await fs.promises.mkdir(path.join(repo(), 'requirements'), { recursive: true })
  const long = Array.from({ length: 12 }, (_, i) => `<p>Paragraphe ${i} : le système doit conserver une mesure détaillée et longue, avec ses tolérances.</p>`).join('')
  const ids = Array.from({ length: COUNT }, (_, i) => `GH439XR-${String(i + 1).padStart(4, '0')}`)
  await Promise.all(ids.map(id => fs.promises.writeFile(path.join(repo(), 'requirements', `${id}.yaml`),
    yaml.dump({ id, projectId: '', branchId: '', objectTypeRef: 'root::gh439x_req', title: `Exigence GH439X ${id}`, status: 'draft', version: 1, fields: { details: long } }))))
  firstId = ids[0]
  lastId = ids[COUNT - 1]
  await commit('GH439 export — exigences')
  frozenId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439X figée' }, ws())).id
  await s.invoke('versions:include', repo(), frozenId, [firstId], ws())
  await commit('GH439 export — version figée')
  await s.invoke('versions:release', repo(), frozenId, 'gh439x-fige', ws())
  currentId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439X en cours' }, ws())).id
  abandonedFrozenId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439X abandonnée figée' }, ws())).id
  await s.invoke('versions:include', repo(), abandonedFrozenId, [lastId], ws())
  await commit('GH439 export — version à abandonner')
  await s.invoke('versions:release', repo(), abandonedFrozenId, 'gh439x-aband', ws())
  const page = await s.invoke<VersionPageLike>('versions:get', repo(), abandonedFrozenId, ws())
  await s.invoke('versions:update', repo(), abandonedFrozenId, { status: page.typeDef.statuses!.find(x => x.isTerminal)!.name }, ws())
})

test('X1, X2, X3 — fenêtre d\'export : cases cochées, formats, clic souris, fermeture au clic extérieur', async () => {
  const p = s.page
  await openVersion(frozenId)
  await openExport()
  for (const key of ALL_SECTIONS) {
    await expect(p.getByTestId(`export-choice-${key}`)).toBeChecked()
  }
  await expect(p.getByTestId('export-format-xlsx')).toBeEnabled()
  await expect(p.getByTestId('export-format-pdf')).toBeEnabled()
  await expect(p.getByTestId('export-format-docx')).toHaveCount(0)

  // X3 — clics souris sur les cases : la fenêtre reste ouverte.
  await p.getByTestId('export-choice-info').click()
  await expect(p.getByTestId('export-choices')).toBeVisible()
  await p.getByTestId('export-choice-info').click()
  await expect(p.getByTestId('export-choice-info')).toBeChecked()

  // X2 — plus aucune section cochée : formats désactivés ; une cochée : activés.
  await choose([])
  await expect(p.getByTestId('export-format-xlsx')).toBeDisabled()
  await expect(p.getByTestId('export-format-pdf')).toBeDisabled()
  await p.getByTestId('export-choice-requirements').click()
  await expect(p.getByTestId('export-format-xlsx')).toBeEnabled()
  await choose(ALL_SECTIONS)

  // Fermeture au clic extérieur.
  await p.mouse.click(5, 5)
  await expect(p.getByTestId('export-choices')).toHaveCount(0)
})

test('X4, X5, X8 — Excel « Informations » + « Exigences » : deux feuilles, section repliée exportée, informations de la version', async () => {
  const p = s.page
  await openVersion(frozenId)
  await expect(p.getByTestId('version-requirements-toggle')).toHaveAttribute('aria-expanded', 'false')   // repliée
  const sheets = await readSheets(await exportSections('xlsx', ['info', 'requirements'], 'x4'))
  expect(sheets.map(x => x.name.length <= 31)).toEqual([true, true])
  expect(sheets).toHaveLength(2)
  expect(sheets[0].name).toMatch(/Informations?/)
  expect(sheets[1].name).toMatch(REQ_SHEET)
  // X5 — la section repliée est exportée avec ses lignes.
  expect(sheets[1].rows.length).toBeGreaterThan(COUNT)
  const ids = sheets[1].rows.map(r => r[0])
  expect(ids).toContain(firstId)
  expect(ids).toContain(lastId)
  // X8 — Informations : libellé, état, tag, date de gel, commit (7 caractères), composant, export.
  const info = Object.fromEntries(sheets[0].rows.map(r => [r[0], r[1]]))
  expect(Object.values(info)).toContain('GH439X figée')
  expect(Object.values(info)).toContain('gh439x-fige')
  expect(Object.values(info).some(v => /^[0-9a-f]{7}$/.test(v))).toBe(true)
  expect(sheets[0].rows.length).toBeGreaterThanOrEqual(8)
  expect(sheets[0].header).toHaveLength(2)
})

test('X9 — version en cours : « Informations » sans tag ni commit', async () => {
  await openVersion(currentId)
  const [info] = await readSheets(await exportSections('xlsx', ['info'], 'x9'))
  const fields = info.rows.map(r => r[0])
  expect(fields.some(f => /^(Tag|Commit)$/.test(f))).toBe(false)
  expect(info.rows.map(r => r[1])).toContain('GH439X en cours')
})

test('X6, X7 — colonne décochée absente de la feuille ; filtre actif sans effet sur l\'export', async () => {
  const p = s.page
  await openVersion(frozenId)
  await p.getByTestId('version-requirements-toggle').click()
  await expect(p.getByTestId('version-requirements')).toBeVisible()
  const before = await readSheets(await exportSections('xlsx', ['requirements'], 'x6a'))
  expect(before[0].header.some(h => /Statut|Status/.test(h))).toBe(true)

  // X6 — décocher « Statut » dans le panneau 👁.
  await p.getByTestId('version-requirements-columns').click()
  await p.getByTestId('version-requirements-column-status').click()
  await p.getByTestId('column-picker-close').click()
  await expect(p.getByTestId('version-requirements-header-status')).toHaveCount(0)
  // X7 — filtre sur l'ID : la grille ne garde que quelques lignes.
  await p.getByTestId('version-requirements-header-id').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').fill(lastId)
  await p.getByTestId('version-requirements-count').click()
  await expect(p.getByTestId('version-requirements-count')).toHaveText(new RegExp(`^1 / ${before[0].rows.length}$`))
  const after = await readSheets(await exportSections('xlsx', ['requirements'], 'x6b'))
  expect(after[0].header.some(h => /Statut|Status/.test(h))).toBe(false)
  expect(after[0].header).toHaveLength(before[0].header.length - 1)
  expect(after[0].rows).toHaveLength(before[0].rows.length)

  // Remise en l'état (préférence et filtre) pour la suite.
  await p.getByTestId('version-requirements-header-id').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').press('Escape')
  await p.getByTestId('version-requirements-columns').click()
  await p.getByTestId('version-requirements-column-status').click()
  await p.getByTestId('column-picker-close').click()
  await expect(p.getByTestId('version-requirements-header-status')).toBeVisible()
})

test('X10, X11, X12 — PDF : A4 paysage, plusieurs pages ; contenu de la route imprimable = feuilles Excel', async () => {
  const p = s.page
  await openVersion(frozenId)
  const pdfFile = await exportSections('pdf', ALL_SECTIONS, 'x10')
  const pdf = fs.readFileSync(pdfFile)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const text = pdf.toString('latin1')
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  expect(pages).toBeGreaterThan(3)
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)
  expect(box, 'MediaBox').not.toBeNull()
  expect(Number(box![1])).toBeGreaterThan(Number(box![2]))   // paysage : largeur > hauteur
  expect(Math.abs(Number(box![1]) - 842)).toBeLessThanOrEqual(2)   // A4 paysage : 842 × 595 pt
  expect(Math.abs(Number(box![2]) - 595)).toBeLessThanOrEqual(2)

  // X12 — la route imprimable, avec la même sélection, rend les mêmes sections, colonnes et lignes que Excel.
  const xlsx = await readSheets(await exportSections('xlsx', ALL_SECTIONS, 'x12'))
  const username = await s.invoke<string>('auth:project-username', repo())
  const printed = await s.context.newPage()
  try {
    const qs = new URLSearchParams({ repoPath: repo(), workspaceDir: ws(), versionId: frozenId, sections: ALL_SECTIONS.join(','), username, language: 'fr', __print: '/print/version' })
    await printed.goto(`/?${qs}`)
    await expect(printed.getByTestId('print-version')).toBeVisible({ timeout: 60_000 })
    const sections = await printed.locator('[data-testid^="print-version-"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')!.replace('print-version-', '')))
    expect(sections).toEqual(ALL_SECTIONS)
    expect(sections).toHaveLength(xlsx.length)
    const req = printed.getByTestId('print-version-requirements')
    const header = await req.locator('thead th').allInnerTexts()
    const rows = await req.locator('tbody tr').evaluateAll(trs => trs.map(tr => (tr.querySelector('td') as HTMLElement).innerText))
    const sheet = xlsx.find(x => REQ_SHEET.test(x.name))!
    expect(header).toEqual(sheet.header)
    expect(rows).toHaveLength(sheet.rows.length)
    expect(rows[0]).toBe(sheet.rows[0][0])
    expect(rows[rows.length - 1]).toBe(sheet.rows[sheet.rows.length - 1][0])
    // Un tableau statique par section, en-tête répété (thead), lignes jamais coupées.
    await expect(req.locator('thead')).toHaveCSS('display', 'table-header-group')
    await expect(req.locator('tbody tr').first()).toHaveCSS('break-inside', 'avoid')
  } finally {
    await printed.close()
  }
  await expect(p.getByTestId('version-page')).toBeVisible()
})

test('X13 — version abandonnée avec gel : Analyse et Tests non proposées, export possible', async () => {
  const p = s.page
  await openVersion(abandonedFrozenId)
  await openExport()
  await expect(p.getByTestId('export-choice-info')).toBeVisible()
  await expect(p.getByTestId('export-choice-requirements')).toBeVisible()
  await expect(p.getByTestId('export-choice-analysis')).toHaveCount(0)
  await expect(p.getByTestId('export-choice-tests')).toHaveCount(0)
  await choose(['info', 'requirements'])
  const sheets = await readSheets(await exportAs('xlsx', 'x13'))
  expect(sheets).toHaveLength(2)
  await expect(p.getByTestId('version-page')).toBeVisible()
  // L'état de la section est mémorisé par poste (ouverte par les scénarios précédents) : ne l'ouvrir que si besoin.
  const toggle = p.getByTestId('version-requirements-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(p.getByTestId('version-requirements-info')).toHaveAttribute('data-verification', 'frozen')
})
