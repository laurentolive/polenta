import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { carryKey } from '@polenta/types'
import type { CampaignTestRun, ParamResolutionPreview, TestCampaign, TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { ParametersService } from './parameters.service'
import type { TestsService } from './tests.service'

// GH64 — report d'entrées d'une campagne à l'autre (scénarios S1–S12 de specs/GH64-tests.md).
// Vrai GitService sur un dossier temporaire ; tests et résolution des paramètres simulés.

function testCase(id: string, version = 1): TestCase {
  return { id, title: `Titre ${id}`, objectTypeRef: 'root::test', status: 'approved', version, fields: {} } as unknown as TestCase
}

/** Paramètres simulés par test : références à saisir, référence de base `{gain}` (valeur selon la
 *  baseline lue), exigences liées (test itérant). */
interface FakeParams { manual?: string[]; base?: boolean; linked?: string[] }

let dir: string
let git: GitService
let tests: Map<string, TestCase>
let params: Map<string, FakeParams>
let service: CampaignsService

const parameters = {
  async previewForTests(_repo: string, list: TestCase[], opts: { baselineRef?: string } = {}): Promise<ParamResolutionPreview[]> {
    return list.map((tc): ParamResolutionPreview => {
      const p = params.get(tc.id) ?? {}
      return {
        testCaseId: tc.id,
        resolved: p.base ? { gain: `gain@${opts.baselineRef ?? 'HEAD'}` } : ({} as Record<string, string>),
        manual: p.manual ?? [],
        unresolved: [],
        ...(opts.baselineRef && { sourceRef: opts.baselineRef }),
        ...(p.linked && {
          requirements: p.linked.map(r => ({ requirementId: r, title: `Titre ${r}`, resolved: { 'req.title': `Titre ${r}` }, unresolved: [] })),
        }),
      }
    })
  },
} as unknown as ParametersService

const testsService = {
  async findOne(_repo: string, id: string): Promise<TestCase> {
    const tc = tests.get(id)
    if (!tc) throw new Error(`Test not found: ${id}`)
    return structuredClone(tc)
  },
} as unknown as TestsService

function run(entryId: string, extra: Partial<CampaignTestRun> = {}): CampaignTestRun {
  const testCaseId = entryId.replace(/-\d+$/, '')
  return { entryId, testCaseId, status: 'pending', testSnapshot: testCase(testCaseId), ...extra }
}

async function writeCampaign(c: Partial<TestCampaign> & { id: string }): Promise<void> {
  const runs = c.runs ?? []
  await git.writeYaml(dir, `campaigns/${c.id}.yaml`, {
    title: c.id, fields: {}, status: 'planned', createdAt: '2026-10-01T00:00:00.000Z', completedAt: null,
    ...c, runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

const readRaw = (id: string) => fsP.readFile(path.join(dir, 'campaigns', `${id}.yaml`), 'utf-8')

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh64-'))
  git = new GitService()
  service = new CampaignsService(git, testsService, parameters)
  tests = new Map(['TEST-0001', 'TEST-0002', 'TEST-0003', 'TEST-0005'].map(id => [id, testCase(id)]))
  params = new Map<string, FakeParams>([
    ['TEST-0002', { manual: ['tension'] }],
    ['TEST-0003', { linked: ['SYS-0001', 'SYS-0002'] }],
    ['TEST-0005', { base: true }],
  ])
  // CAMP-0001 (clôturée) : jeu de référence de specs/GH64-tests.md.
  await writeCampaign({
    id: 'CAMP-0001', status: 'completed', runs: [
      run('TEST-0001-1', { status: 'PASS', executedAt: '2026-10-01T10:00:00.000Z' }),
      run('TEST-0002-1', { paramValues: { tension: '12V' } }),
      run('TEST-0002-2', { status: 'BLOCKED', paramValues: { tension: '24V' } }),
      run('TEST-0003-1', { status: 'FAIL', requirementId: 'SYS-0001' }),
      run('TEST-0003-2', { requirementId: 'SYS-0002' }),
      run('TEST-0005-1', { status: 'INCOMPLETE', resolvedParams: { gain: 'gain@v1' }, paramSourceRef: 'v1' }),
    ],
  })
  await writeCampaign({ id: 'CAMP-0002', status: 'in_progress', runs: [run('TEST-0001-1')] })
  await writeCampaign({ id: 'CAMP-0003' })
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('CampaignsService — report (GH64)', () => {
  it('S1 — une instance par entrée reportée, avec ses valeurs saisies, carriedFrom et copie live', async () => {
    tests.set('TEST-0002', testCase('TEST-0002', 3))
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1', paramValues: { tension: '12V' } },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', paramValues: { tension: '24V' } },
    ])
    expect(c.runs.map(r => [r.entryId, r.status, r.paramValues, r.carriedFrom, r.testSnapshot?.version])).toEqual([
      ['TEST-0002-1', 'pending', { tension: '12V' }, { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1' }, 3],
      ['TEST-0002-2', 'pending', { tension: '24V' }, { campaignId: 'CAMP-0001', entryId: 'TEST-0002-2' }, 3],
    ])
    expect(c.testCaseIds).toEqual(['TEST-0002', 'TEST-0002'])
    expect((await service.get(dir, 'CAMP-0003')).runs).toHaveLength(2)
  })

  it('S2 — une instance T179 garde son exigence et ses valeurs {req.…}', async () => {
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' },
    ])
    expect(c.runs).toHaveLength(1)
    expect(c.runs[0]).toMatchObject({
      testCaseId: 'TEST-0003', requirementId: 'SYS-0002', resolvedParams: { 'req.title': 'Titre SYS-0002' },
      carriedFrom: { campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' },
    })
  })

  it("S3 — exigence plus liée : rien n'est créé, sans erreur", async () => {
    params.set('TEST-0003', { linked: ['SYS-0001'] })
    const before = await readRaw('CAMP-0003')
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' },
    ])
    expect(c.runs).toEqual([])
    expect(await readRaw('CAMP-0003')).toBe(before)
  })

  it('S4 — test sans paramètre déjà présent dans la cible : ignoré', async () => {
    await writeCampaign({ id: 'CAMP-0003', runs: [run('TEST-0001-1')] })
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0002', entryId: 'TEST-0001-1' },
    ])
    expect(c.runs.map(r => r.entryId)).toEqual(['TEST-0001-1'])
  })

  it('S5 — doublon test + valeurs saisies : seule la valeur absente de la cible est ajoutée', async () => {
    await writeCampaign({ id: 'CAMP-0003', runs: [run('TEST-0002-1', { paramValues: { tension: '12V' } })] })
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1', paramValues: { tension: ' 12V ' } },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', paramValues: { tension: '24V' } },
    ])
    expect(c.runs.map(r => [r.entryId, r.paramValues?.tension, r.carriedFrom?.entryId])).toEqual([
      ['TEST-0002-1', '12V', undefined],
      ['TEST-0002-2', '24V', 'TEST-0002-2'],
    ])
  })

  it('S6 — cible clôturée : refus', async () => {
    await expect(service.addTests(dir, 'CAMP-0001', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0002', entryId: 'TEST-0001-1' },
    ])).rejects.toThrow(/completed/)
  })

  it('S7 — sélections invalides ignorées, les autres créées', async () => {
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-9999', entryId: 'TEST-0001-1' },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0042-1' },
      { campaignId: 'CAMP-0003', entryId: 'TEST-0001-1' },
      { campaignId: '../campaigns/CAMP-0002', entryId: 'TEST-0001-1' },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' },
    ])
    expect(c.runs.map(r => r.carriedFrom)).toEqual([{ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' }])
  })

  it('S7b — test supprimé depuis : ignoré', async () => {
    tests.delete('TEST-0001')
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' },
    ])
    expect(c.runs).toEqual([])
  })

  it('S8 — paramètres de base relus à la baseline de la cible, jamais recopiés de la source', async () => {
    await writeCampaign({ id: 'CAMP-0003', baselineRef: 'v2' })
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0005-1' },
    ])
    expect(c.runs[0]).toMatchObject({ resolvedParams: { gain: 'gain@v2' }, paramSourceRef: 'v2' })
  })

  it("S9 — create() : onglet Tests puis reportées, dans cet ordre", async () => {
    const c = await service.create(dir, {
      title: 'Suite', testCaseIds: ['TEST-0001'],
      carried: [{ campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', paramValues: { tension: '24V' } }],
    })
    expect(c.runs.map(r => [r.testCaseId, r.paramValues, r.carriedFrom?.campaignId])).toEqual([
      ['TEST-0001', undefined, undefined],
      ['TEST-0002', { tension: '24V' }, 'CAMP-0001'],
    ])
    expect(c.testCaseIds).toEqual(['TEST-0001', 'TEST-0002'])
  })

  it("S9b — même test dans l'onglet Tests et reporté : une seule instance", async () => {
    const c = await service.create(dir, {
      title: 'Suite', testCaseIds: ['TEST-0001'],
      carried: [{ campaignId: 'CAMP-0002', entryId: 'TEST-0001-1' }],
    })
    expect(c.runs.map(r => r.testCaseId)).toEqual(['TEST-0001'])
  })

  it("S9c — entrée sans exigence d'un test devenu itérant : une instance par exigence retenue", async () => {
    await writeCampaign({ id: 'CAMP-0004', runs: [run('TEST-0003-1')] })
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0004', entryId: 'TEST-0003-1', reqInstances: [{ requirementId: 'SYS-0002' }, { requirementId: 'SYS-0404' }] },
    ])
    expect(c.runs.map(r => [r.testCaseId, r.requirementId, r.carriedFrom?.campaignId])).toEqual([
      ['TEST-0003', 'SYS-0002', 'CAMP-0004'],
    ])
  })

  it('S7c — sans ParametersService (MCP) : exigence et valeurs de la source gardées', async () => {
    const bare = new CampaignsService(git, testsService)
    const c = await bare.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', paramValues: { tension: '24V' } },
    ])
    expect(c.runs.map(r => [r.testCaseId, r.requirementId, r.paramValues])).toEqual([
      ['TEST-0003', 'SYS-0002', undefined],
      ['TEST-0002', undefined, { tension: '24V' }],
    ])
  })

  it('S7d — campagne source illisible : erreur, pas de report silencieusement vide', async () => {
    await fsP.writeFile(path.join(dir, 'campaigns', 'CAMP-0004.yaml'), 'runs: [\n', 'utf-8')
    await expect(service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0004', entryId: 'TEST-0001-1' },
    ])).rejects.toThrow()
  })

  it('S10 — la campagne source est inchangée', async () => {
    const before = await readRaw('CAMP-0001')
    await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1', paramValues: { tension: '12V' } },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' },
    ])
    expect(await readRaw('CAMP-0001')).toBe(before)
  })

  it('S11 — sans report : addTests et create inchangés', async () => {
    const c = await service.addTests(dir, 'CAMP-0003', ['TEST-0001', 'TEST-0002'], { 'TEST-0002': { tension: '5V' } })
    expect(c.runs.map(r => [r.entryId, r.paramValues, 'carriedFrom' in r])).toEqual([
      ['TEST-0001-1', undefined, false],
      ['TEST-0002-1', { tension: '5V' }, false],
    ])
    const again = await service.addTests(dir, 'CAMP-0003', [])
    expect(again.runs).toHaveLength(2)
    const created = await service.create(dir, { title: 'X', testCaseIds: [] })
    expect(created.runs).toEqual([])
  })
})

describe('carryKey (GH64)', () => {
  it("S12 — indépendante de l'ordre des clés, des espaces et des valeurs vides", () => {
    expect(carryKey('T', 'R', { b: ' 2 ', a: '1', c: '' })).toBe(carryKey('T', 'R', { a: '1', b: '2' }))
    expect(carryKey('T', undefined, {})).toBe(carryKey('T', undefined, undefined))
    expect(carryKey('T', 'R', {})).not.toBe(carryKey('T', undefined, {}))
    expect(carryKey('T', undefined, { a: '1' })).not.toBe(carryKey('T', undefined, { a: '2' }))
  })
})

// GH66 — après le retrait d'une instance, une nouvelle instance du même test ne reprend jamais
// un entryId encore porté : numérotation depuis le plus grand suffixe, pas le nombre d'instances.
describe('CampaignsService — entryId après retrait (GH66)', () => {
  beforeEach(async () => {
    await writeCampaign({
      id: 'CAMP-0003', runs: [
        run('TEST-0002-1', { paramValues: { tension: '12V' } }),
        run('TEST-0002-2', { paramValues: { tension: '24V' } }),
        run('TEST-0003-1', { requirementId: 'SYS-0001' }),
        run('TEST-0003-2', { requirementId: 'SYS-0002' }),
      ],
    })
  })

  it('duplicata après retrait : suffixe suivant le plus grand', async () => {
    await service.removeEntries(dir, 'CAMP-0003', ['TEST-0002-1'])
    const c = await service.duplicateTest(dir, 'CAMP-0003', 'TEST-0002', { tension: '48V' })
    expect(c.runs.filter(r => r.testCaseId === 'TEST-0002').map(r => r.entryId)).toEqual(['TEST-0002-2', 'TEST-0002-3'])
  })

  it('ajout groupé d\'un test itérant après retrait : pas de doublon', async () => {
    await service.removeEntries(dir, 'CAMP-0003', ['TEST-0003-1'])
    const c = await service.addTests(dir, 'CAMP-0003', ['TEST-0003'])
    expect(c.runs.filter(r => r.testCaseId === 'TEST-0003').map(r => [r.entryId, r.requirementId])).toEqual([
      ['TEST-0003-2', 'SYS-0002'], ['TEST-0003-3', 'SYS-0001'],
    ])
  })

  it('report après retrait : pas de doublon', async () => {
    await service.removeEntries(dir, 'CAMP-0003', ['TEST-0002-1'])
    const c = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1', paramValues: { tension: '12V' } },
    ])
    expect(c.runs.filter(r => r.testCaseId === 'TEST-0002').map(r => r.entryId)).toEqual(['TEST-0002-2', 'TEST-0002-3'])
  })
})
