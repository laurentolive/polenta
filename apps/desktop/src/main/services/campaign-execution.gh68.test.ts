import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME } from '@polenta/types'
import type { CampaignTestRun, TestCampaign, TestCase } from '@polenta/types'
import { CampaignExecutionService } from './campaign-execution.service'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { TestsService } from './tests.service'
import { readExecutionWorkbook } from './export/campaign-execution-import'

// GH68 — classeur d'exécution Excel et tests non approuvés (specs/GH68-tests.md X1–X6).
// GH81 — export sans écriture, empreinte de la version exportée, contrôle et gel à l'import
// (specs/GH81-tests.md X1–X11). Vrai CampaignsService/GitService sur un dossier temporaire ;
// tests, exécution et auteur simulés ; classeurs réellement écrits puis remplis avec exceljs.

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [{
      name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
      statuses: [{ name: 'draft' }, { name: 'valide', isApproval: true }],
    }],
  }],
  linkTypes: [],
}

function testCase(id: string, status: string, version: number, actions: string[] = [`Action ${id} v${version}`]): TestCase {
  return {
    id, title: `Titre ${id}`, projectId: '', branchId: '', objectTypeRef: 'root::test', status, version,
    preconditions: '', postconditions: '', equipment: [], fields: {},
    steps: actions.map((action, i) => ({ order: i + 1, action, expectedResult: 'OK', notes: null })),
    createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
  } as unknown as TestCase
}

let dir: string
let git: GitService
let tests: Map<string, TestCase>
let campaigns: CampaignsService
let service: CampaignExecutionService
let runSeq: number

const testsService = {
  async findOne(_repo: string, id: string): Promise<TestCase> {
    const tc = tests.get(id)
    if (!tc) throw new Error(`Test not found: ${id}`)
    return structuredClone(tc)
  },
  async execute(_repo: string, testCaseId: string) {
    return { id: `RUN-${++runSeq}`, testCaseId }
  },
} as unknown as TestsService

async function writeCampaign(runs: CampaignTestRun[], status: TestCampaign['status'] = 'in_progress'): Promise<void> {
  await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', fields: {}, status, createdAt: '2026-10-01T00:00:00.000Z',
    runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

const pending = (testCaseId: string, snapshot?: TestCase): CampaignTestRun =>
  ({ entryId: `${testCaseId}-1`, testCaseId, status: 'pending', ...(snapshot && { testSnapshot: snapshot }) })

const campaignFile = () => fsP.readFile(path.join(dir, 'campaigns', 'CAMP-0001.yaml'), 'utf-8')
const entry = async (entryId: string) => (await campaigns.get(dir, 'CAMP-0001')).runs.find(r => r.entryId === entryId)!

async function exportSheet(): Promise<string> {
  const dest = path.join(dir, 'out.xlsx')
  await service.exportSheet(dir, 'CAMP-0001', 'fr', dest)
  return dest
}

async function exportTexts(): Promise<string[]> {
  const raw = await readExecutionWorkbook(await exportSheet())
  if ('fatal' in raw) throw new Error(`fatal: ${raw.fatal.code}`)
  return raw.rows.map(r => r.text)
}

/** Remplit le verdict « Passé » de toutes les étapes des instances `entryIds`. */
async function fill(file: string, entryIds: string[], tweakMeta?: (meta: ExcelJS.Worksheet) => void): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
  const keyCol = EXECUTION_SHEET_COLUMNS.indexOf('key') + 1
  const verdictCol = EXECUTION_SHEET_COLUMNS.indexOf('verdict') + 1
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const key = String(sheet.getRow(r).getCell(keyCol).value ?? '')
    if (key.includes('#') && entryIds.includes(key.slice(0, key.lastIndexOf('#')))) {
      sheet.getRow(r).getCell(verdictCol).value = 'Passé'
    }
  }
  tweakMeta?.(workbook.getWorksheet(EXECUTION_SHEET_META_NAME)!)
  await workbook.xlsx.writeFile(file)
}

/** Classeur au format GH36/GH68 (v1) : pas de colonne d'empreinte. */
function asV1(meta: ExcelJS.Worksheet): void {
  meta.eachRow(row => {
    if (row.getCell(1).value === 'formatVersion') row.getCell(2).value = 1
    row.getCell(5).value = null
  })
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh81x-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  campaigns = new CampaignsService(git, testsService)
  service = new CampaignExecutionService(campaigns, testsService, { getAuthor: async () => ({ name: 'Imp', email: 'i@x' }) })
  runSeq = 0
  tests = new Map([
    ['TEST-A', testCase('TEST-A', 'draft', 2)],
    ['TEST-B', testCase('TEST-B', 'valide', 2)],
  ])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('export du classeur', () => {
  it('X1 — instance resynchronisable : classeur = version actuelle, aucune écriture, empreinte v2', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const before = await campaignFile()
    const raw = await readExecutionWorkbook(await exportSheet())
    if ('fatal' in raw) throw new Error(raw.fatal.code)
    expect(raw.rows.some(r => r.text.includes('Action TEST-A v2'))).toBe(true)
    expect(raw.rows.some(r => r.text.includes('Action TEST-A v1'))).toBe(false)
    expect(raw.formatVersion).toBe('2')
    expect(raw.instances[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(await campaignFile()).toBe(before)
  })

  it('X2 — instance approuvée : copie figée exportée (GH36 inchangé)', async () => {
    await writeCampaign([pending('TEST-B', testCase('TEST-B', 'valide', 1))])
    const texts = await exportTexts()
    expect(texts.some(t => t.includes('Action TEST-B v1'))).toBe(true)
    expect((await entry('TEST-B-1')).testSnapshot?.version).toBe(1)
  })

  it('X3 — campagne clôturée : refus, aucune écriture', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))], 'completed')
    const before = await campaignFile()
    await expect(service.exportSheet(dir, 'CAMP-0001', 'fr', path.join(dir, 'out.xlsx'))).rejects.toThrow()
    expect(await campaignFile()).toBe(before)
  })
})

describe('import du classeur', () => {
  it('X4 — export (v2) puis import sans changement : importée, copie = version exportée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'])
    const result = await service.apply(dir, 'CAMP-0001', file)
    expect(result.preview.errors).toEqual([])
    expect(result.imported).toEqual(['TEST-A-1'])
    expect(await entry('TEST-A-1')).toMatchObject({ status: 'PASS', testSnapshot: { version: 2 } })
  })

  it('X5 — test modifié après l\'export : instance refusée, les autres importées, copie inchangée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1)), pending('TEST-B', testCase('TEST-B', 'valide', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1', 'TEST-B-1'])
    tests.set('TEST-A', testCase('TEST-A', 'draft', 3))
    const result = await service.apply(dir, 'CAMP-0001', file)
    expect(result.preview.errors).toEqual([{ entryId: 'TEST-A-1', error: { code: 'test_changed_since_export', testCaseId: 'TEST-A' } }])
    expect(result.imported).toEqual(['TEST-B-1'])
    expect(await entry('TEST-A-1')).toMatchObject({ status: 'pending', testSnapshot: { version: 1 } })
  })

  it('X6 — #75 : étape insérée en position 2 après l\'export → test_changed_since_export', async () => {
    tests.set('TEST-A', testCase('TEST-A', 'draft', 2, ['E1', 'E2', 'E3']))
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'])
    tests.set('TEST-A', testCase('TEST-A', 'draft', 3, ['E1', 'Nouvelle', 'E2', 'E3']))
    const preview = await service.preview(dir, 'CAMP-0001', file)
    expect(preview.errors.map(e => e.error.code)).toEqual(['test_changed_since_export'])
  })

  it('X7 — modification hors application, version inchangée : détectée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'])
    tests.set('TEST-A', testCase('TEST-A', 'draft', 2, ['Édité à la main']))
    const preview = await service.preview(dir, 'CAMP-0001', file)
    expect(preview.errors.map(e => e.error.code)).toEqual(['test_changed_since_export'])
  })

  it('X8 — classeur v1 (sans empreinte) : accepté, copie actuelle conservée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'], asV1)
    tests.set('TEST-A', testCase('TEST-A', 'draft', 3))
    const result = await service.apply(dir, 'CAMP-0001', file)
    expect(result.preview.fatal).toBeUndefined()
    expect(result.imported).toEqual(['TEST-A-1'])
    expect(await entry('TEST-A-1')).toMatchObject({ status: 'PASS', testSnapshot: { version: 1 } })
  })

  it('X9 — version de format inconnue : refus global', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'], meta => meta.eachRow(row => {
      if (row.getCell(1).value === 'formatVersion') row.getCell(2).value = 3
    }))
    const preview = await service.preview(dir, 'CAMP-0001', file)
    expect(preview.fatal).toEqual({ code: 'unsupported_version', version: '3' })
  })

  it('X12 — même classeur réimporté après le gel : la copie relue du YAML a la même empreinte', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'])
    expect((await service.apply(dir, 'CAMP-0001', file)).imported).toEqual(['TEST-A-1'])
    const again = await service.preview(dir, 'CAMP-0001', file)
    expect(again.errors).toEqual([])
    expect(again.importable.map(i => i.entryId)).toEqual(['TEST-A-1'])
  })

  it('X13 — test approuvé après l\'export, contenu inchangé : importée, copie = version approuvée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-A-1'])
    tests.set('TEST-A', { ...testCase('TEST-A', 'valide', 3), steps: testCase('TEST-A', 'draft', 2).steps })
    const result = await service.apply(dir, 'CAMP-0001', file)
    expect(result.preview.errors).toEqual([])
    expect(await entry('TEST-A-1')).toMatchObject({ status: 'PASS', testSnapshot: { status: 'valide', version: 3 } })
  })

  it('X11 — instance approuvée, test modifié après l\'export : copie inchangée → importée', async () => {
    await writeCampaign([pending('TEST-B', testCase('TEST-B', 'valide', 1))])
    const file = await exportSheet()
    await fill(file, ['TEST-B-1'])
    tests.set('TEST-B', testCase('TEST-B', 'valide', 3))
    const result = await service.apply(dir, 'CAMP-0001', file)
    expect(result.imported).toEqual(['TEST-B-1'])
    expect(await entry('TEST-B-1')).toMatchObject({ status: 'PASS', testSnapshot: { version: 1 } })
  })
})

describe('aperçu d\'import — avertissement test_not_approved', () => {
  async function previewOf(runs: CampaignTestRun[], filled: string[]) {
    await writeCampaign(runs)
    const file = await exportSheet()
    await fill(file, filled)
    return service.preview(dir, 'CAMP-0001', file)
  }

  it('X10 — instance remplie non approuvée : importable + avertissement (version effective)', async () => {
    const preview = await previewOf([pending('TEST-A', testCase('TEST-A', 'draft', 1))], ['TEST-A-1'])
    expect(preview.importable.map(i => i.entryId)).toEqual(['TEST-A-1'])
    expect(preview.warnings).toEqual([{ code: 'test_not_approved', entryId: 'TEST-A-1', status: 'draft' }])
  })

  it('GH68 X5 — instance approuvée : pas d\'avertissement', async () => {
    const preview = await previewOf([pending('TEST-B', testCase('TEST-B', 'valide', 1))], ['TEST-B-1'])
    expect(preview.warnings).toEqual([])
  })

  it('GH68 X6 — instance non approuvée non remplie : pas d\'avertissement', async () => {
    const preview = await previewOf(
      [pending('TEST-A', testCase('TEST-A', 'draft', 1)), pending('TEST-B', testCase('TEST-B', 'valide', 1))],
      ['TEST-B-1'],
    )
    expect(preview.unfilledCount).toBe(1)
    expect(preview.warnings).toEqual([])
  })

  it('GH80 — entrée pré-T49 (sans copie) sur un test live non approuvé : avertissement', async () => {
    const preview = await previewOf([pending('TEST-A')], ['TEST-A-1'])
    expect(preview.warnings).toEqual([{ code: 'test_not_approved', entryId: 'TEST-A-1', status: 'draft' }])
  })
})
