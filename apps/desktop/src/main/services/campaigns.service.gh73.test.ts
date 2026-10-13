import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CampaignTestRun, ExecutionImportPreview, ParamResolutionPreview, TestCampaign, TestCase, TestRun } from '@polenta/types'
import { CampaignExecutionService } from './campaign-execution.service'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { ParametersService } from './parameters.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH73 — faits bruts de l'historique daté des campagnes : rattachement run → entrée, `addedAt`,
// entrées retirées conservées, saisie sans run interdite (scénarios de specs/GH73-tests.md).
// Vrai GitService sur un dossier temporaire ; tests et résolution des paramètres simulés.

function testCase(id: string): TestCase {
  return {
    id, title: `Titre ${id}`, projectId: '', branchId: '', objectTypeRef: 'root::test', status: 'approved', version: 1,
    preconditions: '', postconditions: '', equipment: [], fields: {}, steps: [],
  } as unknown as TestCase
}

let dir: string
let git: GitService
let service: CampaignsService
let tests: Map<string, TestCase>
/** Tests itérants simulés : exigences liées (T179). */
let linked: Map<string, string[]>

const parameters = {
  async previewForTests(_repo: string, list: TestCase[]): Promise<ParamResolutionPreview[]> {
    return list.map((tc): ParamResolutionPreview => ({
      testCaseId: tc.id, resolved: {}, manual: tc.id === 'TEST-0002' ? ['tension'] : [], unresolved: [],
      ...(linked.has(tc.id) && {
        requirements: linked.get(tc.id)!.map(r => ({ requirementId: r, title: r, resolved: {}, unresolved: [] })),
      }),
    }))
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
    title: c.id, fields: {}, status: 'in_progress', createdAt: '2026-10-01T00:00:00.000Z', completedAt: null,
    ...c, runs, testCaseIds: runs.map(r => r.testCaseId),
  })
}

const onDisk = (id: string) => git.readYaml<TestCampaign>(dir, `campaigns/${id}.yaml`) as Promise<TestCampaign>
const readRaw = (id: string) => fsP.readFile(path.join(dir, 'campaigns', `${id}.yaml`), 'utf-8')

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh73-'))
  git = new GitService()
  service = new CampaignsService(git, testsService, parameters)
  tests = new Map(['TEST-0001', 'TEST-0002', 'TEST-0003'].map(id => [id, testCase(id)]))
  linked = new Map([['TEST-0003', ['SYS-0001', 'SYS-0002']]])
})

afterEach(async () => {
  vi.useRealTimers()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('addedAt (§2)', () => {
  it('2.1 — entrées initiales : addedAt = createdAt', async () => {
    const c = await service.create(dir, { title: 'C', testCaseIds: ['TEST-0001', 'TEST-0003'] })
    expect(c.runs).toHaveLength(3)
    expect(c.runs.every(r => r.addedAt === c.createdAt)).toBe(true)
    expect((await onDisk(c.id)).runs.every(r => r.addedAt === c.createdAt)).toBe(true)
  })

  it('2.2 / 2.3 — addTests : date commune aux nouvelles entrées (instances T179 comprises), anciennes inchangées', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T08:00:00Z'))
    const c = await service.create(dir, { title: 'C', testCaseIds: ['TEST-0001'] })
    vi.setSystemTime(new Date('2026-10-05T08:00:00Z'))
    const after = await service.addTests(dir, c.id, ['TEST-0003'])
    expect(after.runs.map(r => [r.entryId, r.addedAt])).toEqual([
      ['TEST-0001-1', '2026-10-01T08:00:00.000Z'],
      ['TEST-0003-1', '2026-10-05T08:00:00.000Z'],
      ['TEST-0003-2', '2026-10-05T08:00:00.000Z'],
    ])
  })

  it('2.4 — duplicateTest : la nouvelle instance a sa date, la dupliquée garde la sienne', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T08:00:00Z'))
    const c = await service.create(dir, { title: 'C', testCaseIds: ['TEST-0002'], paramValuesByTest: { 'TEST-0002': { tension: '12V' } } })
    vi.setSystemTime(new Date('2026-10-02T08:00:00Z'))
    const after = await service.duplicateTest(dir, c.id, 'TEST-0002', { tension: '24V' })
    expect(after.runs.map(r => r.addedAt)).toEqual(['2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z'])
  })

  it('2.5 — report GH64 : date du report, pas celle de la source', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1', { addedAt: '2026-01-01T00:00:00.000Z' })] })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T08:00:00Z'))
    const created = await service.create(dir, { title: 'Cible', testCaseIds: [], carried: [{ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' }] })
    expect(created.runs.map(r => r.addedAt)).toEqual(['2026-10-03T08:00:00.000Z'])
    expect(created.runs[0]!.carriedFrom).toEqual({ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' })

    vi.setSystemTime(new Date('2026-10-04T08:00:00Z'))
    await writeCampaign({ id: 'CAMP-0003', runs: [] })
    const added = await service.addTests(dir, 'CAMP-0003', [], undefined, undefined, undefined, [{ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' }])
    expect(added.runs.map(r => r.addedAt)).toEqual(['2026-10-04T08:00:00.000Z'])
  })

  it('2.6 — updateRun (y compris gel de la version affichée, GH81) / updateRunParams ne touchent pas addedAt', async () => {
    const c = await service.create(dir, { title: 'C', testCaseIds: ['TEST-0001', 'TEST-0002'] })
    const [e1, e2] = c.runs
    await service.updateRun(dir, c.id, e1!.entryId, 'PASS', 'RUN-1')
    await service.updateRunParams(dir, c.id, e2!.entryId, { tension: '5V' })
    await service.updateRun(dir, c.id, e2!.entryId, 'FAIL', 'RUN-2', e2!.testSnapshot && { testSnapshot: e2!.testSnapshot })
    expect((await onDisk(c.id)).runs.map(r => r.addedAt)).toEqual([c.createdAt, c.createdAt])
  })

  it('2.7 — campagne antérieure à GH73 : aucun addedAt ajouté à la réécriture', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1')] })
    await service.updateRun(dir, 'CAMP-0001', 'TEST-0001-1', 'PASS', 'RUN-1')
    expect(await readRaw('CAMP-0001')).not.toContain('addedAt')
  })
})

describe('entrées retirées (§3)', () => {
  it('3.1 — campagne neuve : pas de removedRuns', async () => {
    const c = await service.create(dir, { title: 'C', testCaseIds: ['TEST-0001'] })
    expect(await readRaw(c.id)).not.toContain('removedRuns')
  })

  it('3.2 — entrée exécutée retirée : conservée complète avec removedAt, testCaseIds réduit', async () => {
    const exec = run('TEST-0001-1', { status: 'PASS', runId: 'RUN-1', executedAt: '2026-10-02T00:00:00.000Z', addedAt: '2026-10-01T00:00:00.000Z' })
    await writeCampaign({ id: 'CAMP-0001', runs: [exec, run('TEST-0002-1')] })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
    const c = await service.removeEntries(dir, 'CAMP-0001', ['TEST-0001-1'])
    expect(c.runs.map(r => r.entryId)).toEqual(['TEST-0002-1'])
    expect(c.testCaseIds).toEqual(['TEST-0002'])
    const disk = await onDisk('CAMP-0001')
    expect(disk.removedRuns).toEqual([{ ...exec, removedAt: '2026-10-06T08:00:00.000Z' }])
  })

  it('3.3 / 3.4 — retraits successifs dans l\'ordre ; entrée déjà retirée ou inconnue ignorée', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1'), run('TEST-0002-1')] })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-1'])
    vi.setSystemTime(new Date('2026-10-07T08:00:00Z'))
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0001-1'])
    vi.setSystemTime(new Date('2026-10-08T08:00:00Z'))
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-1', 'TEST-9999-1'])
    expect((await onDisk('CAMP-0001')).removedRuns!.map(r => [r.entryId, r.removedAt])).toEqual([
      ['TEST-0002-1', '2026-10-06T08:00:00.000Z'],
      ['TEST-0001-1', '2026-10-07T08:00:00.000Z'],
    ])
  })

  it('3.5 — après retrait de toutes les instances, un nouvel ajout ne réutilise aucun entryId', async () => {
    await writeCampaign({
      id: 'CAMP-0001', runs: [
        run('TEST-0002-1', { paramValues: { tension: '12V' } }),
        run('TEST-0002-2', { paramValues: { tension: '24V' } }),
      ],
    })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-1', 'TEST-0002-2'])
    const dup = await service.duplicateTest(dir, 'CAMP-0001', 'TEST-0002', { tension: '48V' })
    expect(dup.runs.map(r => r.entryId)).toEqual(['TEST-0002-3'])

    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-3'])
    const added = await service.addTests(dir, 'CAMP-0001', ['TEST-0002'], { 'TEST-0002': { tension: '5V' } })
    expect(added.runs.map(r => r.entryId)).toEqual(['TEST-0002-4'])

    await writeCampaign({ id: 'CAMP-0009', runs: [run('TEST-0002-1', { paramValues: { tension: '9V' } })] })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-4'])
    const carried = await service.addTests(dir, 'CAMP-0001', [], undefined, undefined, undefined, [
      { campaignId: 'CAMP-0009', entryId: 'TEST-0002-1', paramValues: { tension: '9V' } },
    ])
    expect(carried.runs.map(r => r.entryId)).toEqual(['TEST-0002-5'])
  })

  it('3.6 — test sans paramètre retiré puis ré-ajouté : nouvelle entrée', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1')] })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0001-1'])
    const c = await service.addTests(dir, 'CAMP-0001', ['TEST-0001'])
    expect(c.runs.map(r => r.entryId)).toEqual(['TEST-0001-2'])
    expect(c.runs[0]!.addedAt).toBeDefined()
    expect((await onDisk('CAMP-0001')).removedRuns!.map(r => r.entryId)).toEqual(['TEST-0001-1'])
  })

  it('3.7 — instance T179 retirée : recréée par un ajout du test itérant', async () => {
    await writeCampaign({
      id: 'CAMP-0001', runs: [
        run('TEST-0003-1', { requirementId: 'SYS-0001' }),
        run('TEST-0003-2', { requirementId: 'SYS-0002' }),
      ],
    })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0003-1'])
    const c = await service.addTests(dir, 'CAMP-0001', ['TEST-0003'])
    expect(c.runs.map(r => [r.entryId, r.requirementId])).toEqual([
      ['TEST-0003-2', 'SYS-0002'], ['TEST-0003-3', 'SYS-0001'],
    ])
  })

  it('3.8 — une entrée retirée de la source n\'est pas reportable', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1')] })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0001-1'])
    const c = await service.create(dir, { title: 'Cible', testCaseIds: [], carried: [{ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' }] })
    expect(c.runs).toEqual([])
  })

  it('3.9 — campagne pré-T97 : entryId backfillés figés à la réécriture', async () => {
    const legacy = (paramValues: Record<string, string>) =>
      ({ testCaseId: 'TEST-0002', status: 'pending', paramValues }) as unknown as CampaignTestRun
    await writeCampaign({ id: 'CAMP-0001', runs: [legacy({ tension: '12V' }), legacy({ tension: '24V' })] })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-1'])
    const disk = await onDisk('CAMP-0001')
    expect(disk.runs.map(r => [r.entryId, r.paramValues])).toEqual([['TEST-0002-2', { tension: '24V' }]])
    expect(disk.removedRuns!.map(r => r.entryId)).toEqual(['TEST-0002-1'])
  })

  it('3.10 — campagne clôturée : retrait refusé', async () => {
    await writeCampaign({ id: 'CAMP-0001', status: 'completed', runs: [run('TEST-0001-1')] })
    await expect(service.removeEntries(dir, 'CAMP-0001', ['TEST-0001-1'])).rejects.toThrow()
    expect(await readRaw('CAMP-0001')).not.toContain('removedRuns')
  })
})

describe('migration des copies GH82 et entrées retirées', () => {
  it('rewriteSnapshots migre aussi les copies de removedRuns', async () => {
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1'), run('TEST-0002-1')] })
    await service.removeEntries(dir, 'CAMP-0001', ['TEST-0002-1'])
    const result = { migrated: [], skipped: [], failed: [] } as unknown as Parameters<CampaignsService['rewriteSnapshots']>[3]
    await service.rewriteSnapshots(dir, 'root::test', t => (t.status === 'approved' ? { ...t, status: 'valide' } : null), result)
    const disk = await onDisk('CAMP-0001')
    expect(disk.runs[0]!.testSnapshot!.status).toBe('valide')
    expect(disk.removedRuns![0]!.testSnapshot!.status).toBe('valide')
    expect(disk.removedRuns![0]!.removedAt).toBeDefined()
    expect(result.snapshots).toBe(2)
  })
})

describe('saisie sans run (§4)', () => {
  beforeEach(async () => {
    await writeCampaign({ id: 'CAMP-0001', status: 'planned', runs: [run('TEST-0001-1')] })
  })

  it.each([undefined, '', 123, {}])('4.1 — runId %j : refus, fichier inchangé', async (runId) => {
    const before = await readRaw('CAMP-0001')
    await expect(service.updateRun(dir, 'CAMP-0001', 'TEST-0001-1', 'PASS', runId as unknown as string)).rejects.toThrow(/test run is required/)
    expect(await readRaw('CAMP-0001')).toBe(before)
  })

  it('4.2 — statut pending : refus, fichier inchangé', async () => {
    const before = await readRaw('CAMP-0001')
    await expect(service.updateRun(dir, 'CAMP-0001', 'TEST-0001-1', 'pending' as never, 'RUN-1')).rejects.toThrow(/Invalid result/)
    expect(await readRaw('CAMP-0001')).toBe(before)
  })

  it('4.3 — résultat avec run : écrit, planned → in_progress', async () => {
    const c = await service.updateRun(dir, 'CAMP-0001', 'TEST-0001-1', 'FAIL', 'RUN-1')
    expect(c.status).toBe('in_progress')
    expect(c.runs[0]).toMatchObject({ status: 'FAIL', runId: 'RUN-1' })
    expect(c.runs[0]!.executedAt).toBeDefined()
  })
})

describe('rattachement run → entrée (§1)', () => {
  let testsIndex: TestsIndexService
  let realTests: TestsService
  const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => null } as unknown as SchemaService

  beforeEach(async () => {
    testsIndex = new TestsIndexService(git)
    realTests = new TestsService(git, testsIndex, schemaStub)
    await git.writeYaml(dir, 'tests/TEST-0001.yaml', testCase('TEST-0001'))
  })

  const runFile = async (r: TestRun) => fsP.readFile(path.join(dir, 'test-runs', 'TEST-0001', `${r.id}.yaml`), 'utf-8')

  it('1.1 / 1.3 — campaignEntry écrit avec ses deux clés seulement, plus de campaignRunId', async () => {
    const r = await realTests.execute(dir, 'TEST-0001', {
      stepResults: [], result: 'PASS',
      campaignEntry: { campaignId: 'CAMP-0001', entryId: 'TEST-0001-1', foo: 'x' } as never,
    })
    const disk = await git.readYaml<TestRun>(dir, `test-runs/TEST-0001/${r.id}.yaml`)
    expect(disk!.campaignEntry).toEqual({ campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' })
    expect(await runFile(r)).not.toContain('campaignRunId')
  })

  it.each([{}, { campaignId: 'CAMP-0001' }, { campaignId: '', entryId: 'TEST-0001-1' }, { campaignId: 'CAMP-0001', entryId: 7 }])(
    '1.3 bis — campaignEntry incomplet %j : refus, aucun run écrit', async (campaignEntry) => {
      await expect(realTests.execute(dir, 'TEST-0001', { stepResults: [], result: 'PASS', campaignEntry: campaignEntry as never }))
        .rejects.toThrow(/Invalid campaign entry/)
      expect(await git.listFiles(dir, 'test-runs')).toEqual([])
    })

  it('1.2 — exécution isolée : ni campaignEntry ni campaignRunId', async () => {
    const r = await realTests.execute(dir, 'TEST-0001', { stepResults: [], result: 'PASS' })
    const raw = await runFile(r)
    expect(raw).not.toContain('campaignEntry')
    expect(raw).not.toContain('campaignRunId')
  })

  it('1.7 — ancien run `campaignRunId: null` : relu sans erreur', async () => {
    await git.writeYaml(dir, 'test-runs/TEST-0001/RUN-20260101-001.yaml', {
      id: 'RUN-20260101-001', testCaseId: 'TEST-0001', campaignRunId: null, result: 'PASS',
      executedAt: '2026-01-01T00:00:00.000Z', executedBy: 'x', duration: 0, equipmentUsed: [], stepResults: [], notes: '',
    })
    const runs = (await testsIndex.getRunsMap(dir)).get('TEST-0001')
    expect(runs?.map(r => r.result)).toEqual(['PASS'])
  })

  it('1.4 — import Excel : chaque run porte le campaignEntry de son instance', async () => {
    const executed: Array<{ testCaseId: string; dto: Record<string, unknown> }> = []
    const fakeTests = {
      findOne: testsService.findOne,
      execute: async (_repo: string, testCaseId: string, dto: Record<string, unknown>) => {
        executed.push({ testCaseId, dto })
        return { id: `RUN-${executed.length}` }
      },
    } as unknown as TestsService
    await writeCampaign({ id: 'CAMP-0001', runs: [run('TEST-0001-1'), run('TEST-0002-1')] })
    const exec = new CampaignExecutionService(service, fakeTests, { getAuthor: async () => ({ name: 'Imp', email: 'i@x' }) })
    const inst = (entryId: string, testCaseId: string) => ({
      entryId, testCaseId, result: 'PASS', stepResults: [], notes: '', executedBy: 'Imp', executedAt: '2026-10-10T12:00:00.000Z',
    })
    // GH81 — `apply` revalide par `validate` (aperçu + versions effectives + empreintes du classeur).
    vi.spyOn(exec as unknown as { validate: () => Promise<unknown> }, 'validate').mockResolvedValue({
      preview: {
        importable: [inst('TEST-0001-1', 'TEST-0001'), inst('TEST-0002-1', 'TEST-0002')],
        errors: [], warnings: [],
      } as unknown as ExecutionImportPreview,
      effectiveTests: new Map(),
      fingerprinted: new Set(),
    })
    const result = await exec.apply(dir, 'CAMP-0001', 'x.xlsx')
    expect(result.imported).toEqual(['TEST-0001-1', 'TEST-0002-1'])
    expect(executed.map(e => e.dto.campaignEntry)).toEqual([
      { campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' },
      { campaignId: 'CAMP-0001', entryId: 'TEST-0002-1' },
    ])
    expect((await onDisk('CAMP-0001')).runs.map(r => r.runId)).toEqual(['RUN-1', 'RUN-2'])
  })
})
