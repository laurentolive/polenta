import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CampaignTestRun, TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { ParametersService } from './parameters.service'
import type { TestsService } from './tests.service'

// GH442 — exigences affichées de chaque entrée (U4–U6 de specs/GH442-tests.md). Vrai GitService sur un
// dossier temporaire ; la lecture des liens (`coveredRequirementIds`, testée à part) est simulée.

const testCase = (id: string): TestCase =>
  ({ id, title: `Titre ${id}`, objectTypeRef: 'root::test', status: 'approved', version: 1, fields: {} }) as unknown as TestCase
const run = (entryId: string, extra: Partial<CampaignTestRun> = {}): CampaignTestRun =>
  ({ entryId, testCaseId: entryId.replace(/-\d+$/, ''), status: 'pending', testSnapshot: testCase(entryId.replace(/-\d+$/, '')), ...extra })

let dir: string
let git: GitService
let covered: Map<string, string[]>
let asked: string[][]
let service: CampaignsService

const parameters = {
  async coveredRequirementIds(_repo: string, testIds: string[]): Promise<Map<string, string[]>> {
    asked.push(testIds)
    return new Map(testIds.map(id => [id, covered.get(id) ?? []]))
  },
} as unknown as ParametersService
const testsService = {} as unknown as TestsService

async function writeCampaign(id: string, runs: CampaignTestRun[]): Promise<void> {
  await git.writeYaml(dir, `campaigns/${id}.yaml`, {
    title: id, fields: {}, status: 'in_progress', createdAt: '2026-10-01T00:00:00.000Z', completedAt: null,
    runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh442-'))
  git = new GitService()
  service = new CampaignsService(git, testsService, parameters)
  asked = []
  covered = new Map([
    ['TEST-0001', ['SYS-0001', 'SYS-0002']],   // non itérant, deux exigences
    ['TEST-0003', ['SYS-0001', 'SYS-0003']],   // itérant : couvre deux exigences, une instance chacune
    ['TEST-0004', ['SYS-0009']],
  ])
  await writeCampaign('CAMP-0001', [
    run('TEST-0001-1'),
    run('TEST-0002-1'),                                        // aucun lien
    run('TEST-0003-1', { requirementId: 'SYS-0001' }),
    run('TEST-0003-2', { requirementId: 'SYS-0003' }),
    run('TEST-0004-1'),
  ])
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('CampaignsService.entryRequirements (GH442)', () => {
  it('exigence de l\'instance pour un test itérant, exigences couvertes sinon', async () => {
    expect(await service.entryRequirements(dir, 'CAMP-0001')).toEqual({
      'TEST-0001-1': ['SYS-0001', 'SYS-0002'],
      'TEST-0002-1': [],
      'TEST-0003-1': ['SYS-0001'],   // jamais « SYS-0001, SYS-0003 » : une instance = une exigence
      'TEST-0003-2': ['SYS-0003'],
      'TEST-0004-1': ['SYS-0009'],
    })
  })

  it('ne lit les liens que des tests dont une entrée n\'a pas d\'exigence propre, une fois chacun', async () => {
    await service.entryRequirements(dir, 'CAMP-0001')
    expect(asked).toHaveLength(1)
    expect([...asked[0]!].sort()).toEqual(['TEST-0001', 'TEST-0002', 'TEST-0004'])
  })

  it('l\'exigence d\'une instance reste affichée même si elle n\'est plus couverte par le test', async () => {
    covered.set('TEST-0003', [])
    const result = await service.entryRequirements(dir, 'CAMP-0001')
    expect(result['TEST-0003-1']).toEqual(['SYS-0001'])
    expect(result['TEST-0003-2']).toEqual(['SYS-0003'])
  })

  it('rien n\'est figé : un lien ajouté après la création de la campagne apparaît à l\'appel suivant', async () => {
    expect((await service.entryRequirements(dir, 'CAMP-0001'))['TEST-0002-1']).toEqual([])
    covered.set('TEST-0002', ['SYS-0007'])
    expect((await service.entryRequirements(dir, 'CAMP-0001'))['TEST-0002-1']).toEqual(['SYS-0007'])
  })

  it('sans service de paramètres : exigence de l\'instance seule', async () => {
    const bare = new CampaignsService(git, testsService)
    expect(await bare.entryRequirements(dir, 'CAMP-0001')).toEqual({
      'TEST-0001-1': [], 'TEST-0002-1': [], 'TEST-0003-1': ['SYS-0001'], 'TEST-0003-2': ['SYS-0003'], 'TEST-0004-1': [],
    })
  })

  it('campagne sans entrée : objet vide, aucune lecture de liens', async () => {
    await writeCampaign('CAMP-0002', [])
    expect(await service.entryRequirements(dir, 'CAMP-0002')).toEqual({})
    expect(asked).toEqual([])
  })
})
