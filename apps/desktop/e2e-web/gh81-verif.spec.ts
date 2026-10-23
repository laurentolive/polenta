import { execFileSync } from 'child_process'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { test, expect, type Page } from '@playwright/test'
import { EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME } from '@polenta/types'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH81 — vérifications « manuelles » de specs/GH81-sprint1.md (M1, E2, M2, M3) jouées par
 * l'interface du client web, avec `git status` sur le clone du projet : la consultation (page
 * d'exécution, export du classeur) ne laisse aucune modification, la saisie fige la version
 * affichée, l'import refuse une instance dont le test a changé depuis l'export et accepte un
 * classeur exporté avant GH81 (format v1).
 */
const s = setupSession()

interface Step { order: number; action: string; expectedResult: string; notes: null }
interface TestCaseLike { id: string; objectTypeRef: string; status: string; fields: Record<string, unknown>; steps?: Step[] }
interface Run { entryId: string; testCaseId: string; status: string; testSnapshot?: TestCaseLike }
interface Campaign { id: string; runs: Run[] }
interface TypeLike { name: string; category: string; statuses?: Array<{ name: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let model: TestCaseLike
let campaign: Campaign

const steps = (name: string, v: number): Step[] => [{ order: 1, action: `Action GH81V ${name} v${v}`, expectedResult: 'OK', notes: null }]

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', s.project.localPath, '-c', 'user.name=E2E', '-c', 'user.email=e2e@polenta.test', ...args], { encoding: 'utf-8' })
/** Point de départ propre : tout l'état de préparation (tests, campagne) est commité. */
function baseline(label: string) {
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', `GH81 verif — ${label}`)
  expect(git('status', '--porcelain')).toBe('')
}
const campaignStatus = () => git('status', '--porcelain', '--', 'campaigns')

const entryOf = async (testCaseId: string) =>
  (await s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)).runs.find(r => r.testCaseId === testCaseId)!
const actionOf = async (testCaseId: string) => (await entryOf(testCaseId)).testSnapshot?.steps?.[0]?.action

async function createDraft(name: string): Promise<TestCaseLike> {
  const { localPath, workspaceDir } = s.project
  const created = await s.invoke<TestCaseLike>('tests:create', localPath, {
    title: `GH81V test ${name}`, objectTypeRef: model.objectTypeRef, steps: steps(name, 1), fields: model.fields,
  }, workspaceDir)
  campaign = await s.invoke<Campaign>('campaigns:add-tests', localPath, campaign.id, [created.id], {}, workspaceDir)
  return created
}
const update = (t: TestCaseLike, name: string, v: number) =>
  s.invoke('tests:update', s.project.localPath, t.id, { steps: steps(name, v) }, s.project.workspaceDir)

const campaignUrl = () => s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath })

/** Export par le menu « Excel d'exécution » de la page campagne ; renvoie le classeur téléchargé. */
async function exportByUi(name: string): Promise<string> {
  const p = s.page
  await navigate(p, campaignUrl())
  await p.getByRole('button', { name: "Excel d'exécution" }).click()
  const download = p.waitForEvent('download')
  await p.getByText("Exporter le classeur d'exécution…").click()
  const file = path.join(E2E.downloadsDir, `gh81-${name}.xlsx`)
  await (await download).saveAs(file)
  await p.getByRole('button', { name: 'Fermer' }).click()
  return file
}

/** Testeur : verdict « Passé » sur les étapes des tests `testIds` ; `v1` : classeur antérieur à GH81. */
async function fillAsTester(file: string, testIds: string[], v1 = false) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
  const keyCol = EXECUTION_SHEET_COLUMNS.indexOf('key') + 1
  const verdictCol = EXECUTION_SHEET_COLUMNS.indexOf('verdict') + 1
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const key = String(sheet.getRow(r).getCell(keyCol).value ?? '')
    if (key.includes('#') && testIds.some(id => key.startsWith(`${id}-`))) sheet.getRow(r).getCell(verdictCol).value = 'Passé'
  }
  if (v1) {
    wb.getWorksheet(EXECUTION_SHEET_META_NAME)!.eachRow(row => {
      if (row.getCell(1).value === 'formatVersion') row.getCell(2).value = 1
      row.getCell(5).value = null
    })
  }
  await wb.xlsx.writeFile(file)
}

async function openImportPreview(file: string) {
  const p = s.page
  await navigate(p, campaignUrl())
  await p.getByRole('button', { name: "Excel d'exécution" }).click()
  const chooser = p.waitForEvent('filechooser')
  await p.getByText('Importer des résultats…').click()
  await (await chooser).setFiles(file)
  await expect(p.getByText("Importer des résultats d'exécution")).toBeVisible()
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  for (const node of schema.nodes) {
    for (const type of node.objectTypes ?? []) {
      const approval = type.statuses?.find(st => st.isApproval)?.name
      if (type.category !== 'test' || !approval) continue
      const found = tests.find(t => t.objectTypeRef === `${node.name}::${type.name}` && t.status === approval)
      if (found) { model = found; break }
    }
    if (model) break
  }
  test.skip(!model, 'la démo doit avoir un test approuvé dans un type à statut d\'approbation')
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH81 vérifications', testCaseIds: [] }, workspaceDir)
})

test('M1 + E2 — page d\'exécution : rien d\'écrit à la consultation ; la saisie fige la version affichée', async () => {
  const p = s.page
  const draft = await createDraft('m1')
  await update(draft, 'm1', 2)
  baseline('M1')
  const entry = await entryOf(draft.id)

  // M1 — ouvrir l'exécution d'un brouillon modifié puis repartir sans rien saisir.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: s.project.localPath }))
  await expect(p.getByText('Action GH81V m1 v2')).toBeVisible()
  await s.shot('gh81v-m1-execution-version-actuelle')
  await navigate(p, campaignUrl())
  expect(campaignStatus()).toBe('')
  expect(await actionOf(draft.id)).toBe('Action GH81V m1 v1')

  // E2 — le test change pendant la saisie : la version affichée (v2) est figée avec le résultat.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: s.project.localPath }))
  await expect(p.getByText('Action GH81V m1 v2')).toBeVisible()
  await update(draft, 'm1', 3)
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await p.getByRole('button', { name: 'Exécuter quand même' }).click()
  await p.waitForURL(new RegExp(`/campaign/${campaign.id}(\\?|$)`))
  const after = await entryOf(draft.id)
  expect(after.status).not.toBe('pending')
  expect(after.testSnapshot?.steps?.[0]?.action).toBe('Action GH81V m1 v2')
  expect(campaignStatus()).not.toBe('')
})

test('M2 — export sans écriture ; test modifié depuis l\'export : instance refusée, les autres importées', async () => {
  const p = s.page
  const changed = await createDraft('m2a')
  const kept = await createDraft('m2b')
  await update(changed, 'm2a', 2)
  await update(kept, 'm2b', 2)
  baseline('M2')

  const file = await exportByUi('m2')
  expect(campaignStatus()).toBe('')
  await fillAsTester(file, [changed.id, kept.id])
  await update(changed, 'm2a', 3)
  baseline('M2 — test modifié après l\'export')

  await openImportPreview(file)
  await expect(p.getByText(`le test ${changed.id} a changé depuis l'export du classeur`)).toBeVisible()
  await s.shot('gh81v-m2-apercu-test-modifie')
  await p.getByRole('button', { name: 'Importer 1 résultat' }).click()
  await expect(p.getByText('1 résultat importé.')).toBeVisible()
  await p.getByRole('button', { name: 'Fermer' }).click()

  expect(await entryOf(changed.id)).toMatchObject({ status: 'pending' })
  expect(await actionOf(changed.id)).toBe('Action GH81V m2a v1')
  expect(await entryOf(kept.id)).toMatchObject({ status: 'PASS' })
  expect(await actionOf(kept.id)).toBe('Action GH81V m2b v2')
})

test('M3 — classeur exporté avant GH81 (v1) : importé normalement, copie conservée', async () => {
  const p = s.page
  const draft = await createDraft('m3')
  await update(draft, 'm3', 2)
  baseline('M3')
  const file = await exportByUi('m3')
  await fillAsTester(file, [draft.id], true)
  await update(draft, 'm3', 3)

  await openImportPreview(file)
  await expect(p.getByText(/version|format/i).filter({ hasText: /non prise en charge|inconnue/i })).toHaveCount(0)
  await expect(p.getByText(/a changé depuis l'export/)).toHaveCount(0)
  await s.shot('gh81v-m3-apercu-classeur-v1')
  await p.getByRole('button', { name: 'Importer 1 résultat' }).click()
  await expect(p.getByText('1 résultat importé.')).toBeVisible()
  await p.getByRole('button', { name: 'Fermer' }).click()
  expect(await entryOf(draft.id)).toMatchObject({ status: 'PASS' })
  expect(await actionOf(draft.id)).toBe('Action GH81V m3 v1')
})
