import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CampaignTestRun, TestCampaign, TestCase } from '@polenta/types'
import { CampaignExecutionService } from './campaign-execution.service'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { TestsService } from './tests.service'
import { readExecutionWorkbook, validateExecutionImport, type RawExecutionSheet } from './export/campaign-execution-import'

// GH68 — classeur d'exécution Excel et tests non approuvés (scénarios X1–X7 de specs/GH68-tests.md).
// Vrai CampaignsService/GitService sur un dossier temporaire ; tests et auteur simulés.

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

function testCase(id: string, status: string, version: number): TestCase {
  return {
    id, title: `Titre ${id}`, projectId: '', branchId: '', objectTypeRef: 'root::test', status, version,
    preconditions: '', postconditions: '', equipment: [], fields: {},
    steps: [{ order: 1, action: `Action ${id} v${version}`, expectedResult: 'OK', notes: null }],
    createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
  } as unknown as TestCase
}

let dir: string
let git: GitService
let tests: Map<string, TestCase>
let campaigns: CampaignsService
let service: CampaignExecutionService

const testsService = {
  async findOne(_repo: string, id: string): Promise<TestCase> {
    const tc = tests.get(id)
    if (!tc) throw new Error(`Test not found: ${id}`)
    return structuredClone(tc)
  },
} as unknown as TestsService

async function writeCampaign(runs: CampaignTestRun[], status: TestCampaign['status'] = 'in_progress'): Promise<void> {
  await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', fields: {}, status, createdAt: '2026-10-01T00:00:00.000Z',
    runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

const pending = (testCaseId: string, snapshot: TestCase): CampaignTestRun =>
  ({ entryId: `${testCaseId}-1`, testCaseId, status: 'pending', testSnapshot: snapshot })

async function exportTexts(): Promise<string[]> {
  const dest = path.join(dir, 'out.xlsx')
  await service.exportSheet(dir, 'CAMP-0001', 'fr', dest)
  const raw = await readExecutionWorkbook(dest)
  if ('fatal' in raw) throw new Error(`fatal: ${raw.fatal.code}`)
  return raw.rows.map(r => r.text)
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh68x-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  campaigns = new CampaignsService(git, testsService)
  service = new CampaignExecutionService(campaigns, testsService, { getAuthor: async () => ({ name: 'Imp', email: 'i@x' }) })
  tests = new Map([
    ['TEST-A', testCase('TEST-A', 'draft', 2)],
    ['TEST-B', testCase('TEST-B', 'valide', 2)],
  ])
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('export du classeur', () => {
  it('X1 — instance pending non approuvée : classeur = version actuelle, campagne réécrite', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    const texts = await exportTexts()
    expect(texts.some(t => t.includes('Action TEST-A v2'))).toBe(true)
    expect(texts.some(t => t.includes('Action TEST-A v1'))).toBe(false)
    expect((await campaigns.get(dir, 'CAMP-0001')).runs[0]!.testSnapshot?.version).toBe(2)
  })

  it('X2 — instance approuvée : copie figée exportée (GH36 inchangé)', async () => {
    await writeCampaign([pending('TEST-B', testCase('TEST-B', 'valide', 1))])
    const texts = await exportTexts()
    expect(texts.some(t => t.includes('Action TEST-B v1'))).toBe(true)
    expect((await campaigns.get(dir, 'CAMP-0001')).runs[0]!.testSnapshot?.version).toBe(1)
  })

  it('X3 — campagne clôturée : refus, aucune écriture', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))], 'completed')
    await expect(service.exportSheet(dir, 'CAMP-0001', 'fr', path.join(dir, 'out.xlsx'))).rejects.toThrow()
    expect((await campaigns.get(dir, 'CAMP-0001')).runs[0]!.testSnapshot?.version).toBe(1)
  })

  it('X7 — export (v2) puis test modifié (v3) : l\'import reste valide, copie = version exportée', async () => {
    await writeCampaign([pending('TEST-A', testCase('TEST-A', 'draft', 1))])
    await exportTexts()
    tests.set('TEST-A', testCase('TEST-A', 'draft', 3))
    const campaign = await campaigns.get(dir, 'CAMP-0001')
    const preview = validateExecutionImport(sheet(['TEST-A-1']), {
      campaign, fallbackUser: 'Imp', now: '2026-10-13T00:00:00.000Z', filePath: 'x.xlsx',
      isApproved: await campaigns.approvalPredicate(dir),
    })
    expect(preview.errors).toEqual([])
    expect(preview.importable.map(i => i.entryId)).toEqual(['TEST-A-1'])
    await campaigns.updateRun(dir, 'CAMP-0001', 'TEST-A-1', 'PASS', 'RUN-1')
    expect((await campaigns.get(dir, 'CAMP-0001')).runs[0]!.testSnapshot?.version).toBe(2)
  })
})

/** Classeur rempli simulé : une instance à une étape par entrée, verdict « filled » ou vide. */
function sheet(filled: string[], all: string[] = filled): RawExecutionSheet {
  const rows = all.flatMap((entryId, i) => {
    const verdict = filled.includes(entryId) ? 'Passé' : ''
    return [
      { row: 10 + i * 2, key: entryId, text: entryId, verdict: '', tester: '', date: null, comment: '' },
      { row: 11 + i * 2, key: `${entryId}#1`, text: 'Étape', verdict, tester: '', date: null, comment: '' },
    ]
  })
  return {
    formatVersion: '1', campaignId: 'CAMP-0001',
    instances: all.map(entryId => ({ entryId, testCaseId: entryId.replace(/-\d+$/, ''), orders: [1], testFound: true })),
    rows, rowsWithoutKey: [],
  }
}

describe('aperçu d\'import', () => {
  async function previewOf(runs: CampaignTestRun[], filled: string[], all?: string[]) {
    await writeCampaign(runs)
    return validateExecutionImport(sheet(filled, all), {
      campaign: await campaigns.get(dir, 'CAMP-0001'), fallbackUser: 'Imp', now: '2026-10-13T00:00:00.000Z',
      filePath: 'x.xlsx', isApproved: await campaigns.approvalPredicate(dir),
    })
  }

  it('X4 — instance remplie non approuvée : importable + avertissement', async () => {
    const preview = await previewOf([pending('TEST-A', testCase('TEST-A', 'draft', 1))], ['TEST-A-1'])
    expect(preview.importable.map(i => i.entryId)).toEqual(['TEST-A-1'])
    expect(preview.warnings).toEqual([{ code: 'test_not_approved', entryId: 'TEST-A-1', status: 'draft' }])
  })

  it('X5 — instance approuvée : pas d\'avertissement', async () => {
    const preview = await previewOf([pending('TEST-B', testCase('TEST-B', 'valide', 1))], ['TEST-B-1'])
    expect(preview.warnings).toEqual([])
  })

  it('X6 — instance non approuvée non remplie : pas d\'avertissement', async () => {
    const preview = await previewOf(
      [pending('TEST-A', testCase('TEST-A', 'draft', 1)), pending('TEST-B', testCase('TEST-B', 'valide', 1))],
      ['TEST-B-1'], ['TEST-A-1', 'TEST-B-1'],
    )
    expect(preview.unfilledCount).toBe(1)
    expect(preview.warnings).toEqual([])
  })

  it('GH80 — entrée pré-T49 (sans copie) sur un test live non approuvé : avertissement', async () => {
    await writeCampaign([{ entryId: 'TEST-A-1', testCaseId: 'TEST-A', status: 'pending' }])
    const preview = validateExecutionImport(sheet(['TEST-A-1']), {
      campaign: await campaigns.get(dir, 'CAMP-0001'), fallbackUser: 'Imp', now: '2026-10-13T00:00:00.000Z',
      filePath: 'x.xlsx', isApproved: await campaigns.approvalPredicate(dir), liveTests: new Map(tests),
    })
    expect(preview.warnings).toEqual([{ code: 'test_not_approved', entryId: 'TEST-A-1', status: 'draft' }])
  })
})
