import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isApprovalStatus } from '@polenta/types'
import type { CampaignTestRun, TestCampaign, TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { TestsService } from './tests.service'

// GH68 — resynchronisation de la copie des instances pending non approuvées (scénarios U1–U2 et
// R1–R12 de specs/GH68-tests.md). Vrai GitService sur un dossier temporaire ; tests simulés.

/** Le statut d'approbation s'appelle `valide` : on ne doit pas comparer au littéral `approved`. */
const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [{
      name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
      statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'valide', isApproval: true }, { name: 'obsolete', isTerminal: true }],
    }],
  }],
  linkTypes: [],
}

function testCase(id: string, status: string, version = 1, action = 'Étape v1'): TestCase {
  return {
    id, title: `Titre ${id}`, objectTypeRef: 'root::test', status, version, fields: {},
    steps: [{ order: 1, action, expectedResult: 'OK' }],
  } as unknown as TestCase
}

let dir: string
let git: GitService
let tests: Map<string, TestCase>
let service: CampaignsService

const testsService = {
  async findOne(_repo: string, id: string): Promise<TestCase> {
    const tc = tests.get(id)
    if (!tc) throw new Error(`Test not found: ${id}`)
    return structuredClone(tc)
  },
} as unknown as TestsService

function run(entryId: string, snapshot: TestCase | undefined, extra: Partial<CampaignTestRun> = {}): CampaignTestRun {
  const testCaseId = entryId.replace(/-\d+$/, '')
  return { entryId, testCaseId, status: 'pending', ...(snapshot && { testSnapshot: snapshot }), ...extra }
}

async function writeCampaign(runs: CampaignTestRun[], extra: Partial<TestCampaign> = {}): Promise<void> {
  await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', fields: {}, status: 'planned', createdAt: '2026-10-01T00:00:00.000Z',
    ...extra, runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

const entry = async (entryId: string) => (await service.get(dir, 'CAMP-0001')).runs.find(r => r.entryId === entryId)!

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh68-'))
  git = new GitService()
  service = new CampaignsService(git, testsService)
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  tests = new Map([
    ['TEST-A', testCase('TEST-A', 'draft', 2, 'Étape v2')],
    ['TEST-B', testCase('TEST-B', 'valide', 2, 'Étape v2')],
  ])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('isApprovalStatus', () => {
  const typeDef = SCHEMA.nodes[0]!.objectTypes[0]!
  it('U1 — statut isApproval du type, pas le littéral approved', () => {
    expect(isApprovalStatus(typeDef, 'valide')).toBe(true)
    expect(isApprovalStatus(typeDef, 'approved')).toBe(false)
    expect(isApprovalStatus(typeDef, 'draft')).toBe(false)
  })
  it('U2 — repli sur approved sans statut isApproval ou sans type', () => {
    expect(isApprovalStatus({ statuses: [{ name: 'draft' }] }, 'approved')).toBe(true)
    expect(isApprovalStatus(undefined, 'approved')).toBe(true)
    expect(isApprovalStatus(null, 'draft')).toBe(false)
  })
})

describe('CampaignsService.refreshEntries', () => {
  it('R1 — pending, copie non approuvée, test modifié : copie remplacée, une écriture', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'))])
    const write = vi.spyOn(git, 'writeYaml')
    const campaign = await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect(campaign.runs[0]!.testSnapshot).toMatchObject({ version: 2, steps: [{ action: 'Étape v2' }] })
    expect(write).toHaveBeenCalledTimes(1)
    expect((await entry('TEST-A-1')).testSnapshot?.version).toBe(2)
  })

  it('R2 — copie approuvée : jamais resynchronisée (T49)', async () => {
    await writeCampaign([run('TEST-B-1', testCase('TEST-B', 'valide'))])
    const write = vi.spyOn(git, 'writeYaml')
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-B-1'])
    expect(write).not.toHaveBeenCalled()
    expect((await entry('TEST-B-1')).testSnapshot?.version).toBe(1)
  })

  it('R3 — instance exécutée : copie figée', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'), { status: 'PASS', runId: 'RUN-1' })])
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect((await entry('TEST-A-1')).testSnapshot?.version).toBe(1)
  })

  it('R4 — test identique à la copie : aucune écriture', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft', 2, 'Étape v2'))])
    const write = vi.spyOn(git, 'writeYaml')
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect(write).not.toHaveBeenCalled()
  })

  it('R5 — resynchronisée sur une version approuvée, elle ne bouge plus ensuite', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'))])
    tests.set('TEST-A', testCase('TEST-A', 'valide', 3, 'Étape v3'))
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect((await entry('TEST-A-1')).testSnapshot).toMatchObject({ status: 'valide', version: 3 })

    tests.set('TEST-A', testCase('TEST-A', 'valide', 4, 'Étape v4'))
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect((await entry('TEST-A-1')).testSnapshot?.version).toBe(3)
  })

  it('R6 — test source supprimé : copie conservée, pas d\'erreur', async () => {
    await writeCampaign([run('TEST-Z-1', testCase('TEST-Z', 'draft'))])
    await expect(service.refreshEntries(dir, 'CAMP-0001', ['TEST-Z-1'])).resolves.toBeDefined()
    expect((await entry('TEST-Z-1')).testSnapshot?.version).toBe(1)
  })

  it.each(['completed', 'abandoned'] as const)('R7 — campagne %s : aucune modification', async (status) => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'))], { status })
    const write = vi.spyOn(git, 'writeYaml')
    const campaign = await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect(write).not.toHaveBeenCalled()
    expect(campaign.runs[0]!.testSnapshot?.version).toBe(1)
  })

  it('R8 — entrée pré-T49 (sans copie) : ignorée', async () => {
    await writeCampaign([run('TEST-A-1', undefined)])
    const write = vi.spyOn(git, 'writeYaml')
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect(write).not.toHaveBeenCalled()
    expect((await entry('TEST-A-1')).testSnapshot).toBeUndefined()
  })

  it('R9 — entryId inconnu : ignoré ; seules les instances demandées sont traitées', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft')), run('TEST-A-2', testCase('TEST-A', 'draft'))])
    await expect(service.refreshEntries(dir, 'CAMP-0001', ['TEST-X-9', 'TEST-A-2'])).resolves.toBeDefined()
    expect((await entry('TEST-A-1')).testSnapshot?.version).toBe(1)
    expect((await entry('TEST-A-2')).testSnapshot?.version).toBe(2)
  })

  it('R10 — paramètres et métadonnées de l\'instance inchangés', async () => {
    const extra: Partial<CampaignTestRun> = {
      paramValues: { tension: '12V' }, resolvedParams: { gain: '3 dB' }, paramSourceRef: 'v1',
      unresolvedParams: [{ ref: 'x', reason: 'missing' }], requirementId: 'SYS-0001',
      carriedFrom: { campaignId: 'CAMP-0000', entryId: 'TEST-A-1' },
    }
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'), extra)])
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    const e = await entry('TEST-A-1')
    expect(e.testSnapshot?.version).toBe(2)
    expect(e).toMatchObject(extra)
  })

  it('R11 — schéma absent : repli sur approved (une copie draft est resynchronisée)', async () => {
    await fsP.rm(path.join(dir, '.polenta', 'schema.yaml'))
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft'))])
    await service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1'])
    expect((await entry('TEST-A-1')).testSnapshot?.version).toBe(2)
  })

  it('R12 — appels concurrents sérialisés : fichier final cohérent', async () => {
    await writeCampaign([run('TEST-A-1', testCase('TEST-A', 'draft')), run('TEST-A-2', testCase('TEST-A', 'draft'))])
    await Promise.all([
      service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-1']),
      service.refreshEntries(dir, 'CAMP-0001', ['TEST-A-2']),
      service.updateRun(dir, 'CAMP-0001', 'TEST-A-1', 'PASS', 'RUN-1'),
    ])
    const campaign = await service.get(dir, 'CAMP-0001')
    expect(campaign.runs.map(r => r.testSnapshot?.version)).toEqual([2, 2])
    expect(campaign.runs[0]!.status).toBe('PASS')
  })
})

describe('CampaignsService.approvalPredicate', () => {
  it('GH80 — schéma fourni par SchemaService (cache), pas relu du disque', async () => {
    const get = vi.fn(async () => SCHEMA as never)
    const withSchema = new CampaignsService(git, testsService, undefined, { get })
    await fsP.rm(path.join(dir, '.polenta', 'schema.yaml'))
    const isApproved = await withSchema.approvalPredicate(dir)
    expect(get).toHaveBeenCalledWith(dir)
    expect(isApproved(testCase('TEST-A', 'valide'))).toBe(true)
    expect(isApproved(testCase('TEST-A', 'approved'))).toBe(false)
  })

  it('GH80 — ref sans préfixe : le type de test est retenu, pas un type d\'exigence homonyme', async () => {
    await git.writeYaml(dir, '.polenta/schema.yaml', {
      ...SCHEMA,
      nodes: [{
        name: 'root', label: 'Produit', objectTypes: [
          { name: 'item', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'ok', isApproval: true }] },
          { name: 'item', label: 'Test', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'valide', isApproval: true }] },
        ],
      }],
    })
    const isApproved = await service.approvalPredicate(dir)
    const tc = (status: string) => ({ ...testCase('TST-1', status), objectTypeRef: 'item' }) as TestCase
    expect(isApproved(tc('valide'))).toBe(true)
    expect(isApproved(tc('ok'))).toBe(false)
  })
})
