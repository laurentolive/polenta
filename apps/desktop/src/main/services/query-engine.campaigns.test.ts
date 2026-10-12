import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, ProjectSchema, TestCampaign, TestCase } from '@polenta/types'
import { QueryEngineService } from './query-engine.service'
import { CAMPAIGN_SEED_QUERIES } from './dashboard-seed.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'

// GH65 — table `campaign_entries` du moteur de requêtes et requêtes du seed « Campagnes ».

const ROOT = '/ws/produit'
const COMP = '/ws/bms'

const SCHEMA: ProjectSchema = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root',
    label: 'Produit',
    objectTypes: [{
      name: 'campagne',
      label: 'Campagne',
      prefix: 'CAMP',
      category: 'campaign',
      fields: [{ name: 'status', label: 'Statut perso', type: 'text' }, { name: 'banc', label: 'Banc', type: 'text' }],
      statuses: [],
    }],
  }],
} as unknown as ProjectSchema

function run(i: number, status: CampaignTestRun['status'], extra: Partial<CampaignTestRun> = {}): CampaignTestRun {
  return {
    entryId: `TEST-000${i}`,
    testCaseId: `TEST-000${i}`,
    status,
    ...(status !== 'pending' ? { executedAt: `2026-10-1${i % 2}T21:30:00.000Z`, executedBy: 'alice', runId: `RUN-${i}` } : {}),
    ...extra,
  }
}

function campaign(id: string, runs: CampaignTestRun[], extra: Partial<TestCampaign> = {}): TestCampaign {
  return {
    id,
    title: `Campagne ${id}`,
    objectTypeRef: 'root::campagne',
    fields: { status: 'perso', banc: 'B1' },
    status: 'in_progress',
    testCaseIds: runs.map(r => r.testCaseId),
    runs,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}

// 10 entrées : 3 PASS, 1 FAIL, 6 pending (scénarios 1.1 / 1.2).
const CAMP_A = campaign('CAMP-0001', [
  run(1, 'PASS'), run(2, 'PASS'), run(3, 'PASS'), run(4, 'FAIL'),
  run(5, 'pending'), run(6, 'pending'), run(7, 'pending'), run(8, 'pending'), run(9, 'pending'), run(0, 'pending'),
])

function engine(byRepo: Record<string, TestCampaign[]>, opts: { withCampaigns?: boolean; tests?: TestCase[] } = {}) {
  const reqIndex = { findAll: async () => [], findAllLinks: async () => [] } as unknown as RequirementsIndexService
  const testsIndex = {
    findAll: async (rp: string) => (rp === ROOT ? opts.tests ?? [] : []),
    getLatestRunMap: async () => new Map(),
    getRunsMap: async () => new Map(),
  } as unknown as TestsIndexService
  const schema = { get: async () => SCHEMA } as unknown as SchemaService
  const traceability = { computeCoverage: () => new Map() } as unknown as TraceabilityService
  const workspaceTree = {
    readCache: async () => ({ nodes: [{ name: 'produit', repoPath: ROOT }, { name: 'bms', repoPath: COMP }] }),
  } as unknown as WorkspaceTreeService
  const campaigns = { list: async (rp: string) => byRepo[rp] ?? [] } as unknown as CampaignsService
  return new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree, opts.withCampaigns === false ? undefined : campaigns)
}

const sql = (sqlText: string) => ({ mode: 'sql' as const, sqlText })
const seedSql = (key: string) => CAMPAIGN_SEED_QUERIES.find(q => q.key === key)!.sqlText

describe('GH65 — campaign_entries', () => {
  it('1.1 — décompte par statut', async () => {
    const r = await engine({ [ROOT]: [CAMP_A] }).execute(ROOT, sql('SELECT status, COUNT(*) AS n FROM campaign_entries GROUP BY status'), '/ws')
    expect(Object.fromEntries(r.rows.map(x => [x.status, x.n]))).toEqual({ PASS: 3, FAIL: 1, pending: 6 })
  })

  it('1.2 — % exécuté / % PASS du seed', async () => {
    const e = engine({ [ROOT]: [CAMP_A] })
    expect((await e.execute(ROOT, sql(seedSql('executedPct')), '/ws')).rows).toEqual([{ executedPct: 40 }])
    expect((await e.execute(ROOT, sql(seedSql('passPct')), '/ws')).rows).toEqual([{ passPct: 75 }])
  })

  it('1.3 — campagnes du repo racine et d\'un repo composant, composant du fichier', async () => {
    const e = engine({ [ROOT]: [CAMP_A], [COMP]: [campaign('CAMP-0002', [run(1, 'PASS')])] })
    const r = await e.execute(ROOT, sql('SELECT campaignId, component, COUNT(*) AS n FROM campaign_entries GROUP BY campaignId, component'), '/ws')
    expect(r.rows).toEqual(expect.arrayContaining([
      { campaignId: 'CAMP-0001', component: 'produit', n: 10 },
      { campaignId: 'CAMP-0002', component: 'bms', n: 1 },
    ]))
  })

  it('1.4 / 1.5 — builder sur un type de campagne (groupBy, champ perso préfixé)', async () => {
    const e = engine({ [ROOT]: [CAMP_A, campaign('CAMP-0003', [run(1, 'FAIL')], { fields: { banc: 'B2' } })] })
    const byStatus = await e.execute(ROOT, {
      mode: 'builder',
      builderConfig: { objectTypeRef: 'root::campagne', conditions: [], combinator: 'AND', groupBy: ['status'] },
    }, '/ws')
    expect(Object.fromEntries(byStatus.rows.map(x => [x.status, x.count]))).toEqual({ PASS: 3, FAIL: 2, pending: 6 })

    const banc = await e.execute(ROOT, {
      mode: 'builder',
      builderConfig: { objectTypeRef: 'root::campagne', conditions: [{ field: 'campaign_banc', operator: '=', value: 'B2' }], combinator: 'AND' },
    }, '/ws')
    expect(banc.rows.map(x => x.campaignId)).toEqual(['CAMP-0003'])
  })

  it('builder : un champ hors allowlist des entrées est refusé', async () => {
    await expect(engine({ [ROOT]: [CAMP_A] }).execute(ROOT, {
      mode: 'builder',
      builderConfig: { objectTypeRef: 'root::campagne', conditions: [{ field: 'banc', operator: '=', value: 'B1' }], combinator: 'AND' },
    }, '/ws')).rejects.toThrow(/Champ inconnu/)
  })

  it('1.6 — executedDay = date UTC de l\'ISO stocké', async () => {
    const r = await engine({ [ROOT]: [campaign('CAMP-0004', [run(1, 'PASS', { executedAt: '2026-10-12T23:30:00.000Z' })])] })
      .execute(ROOT, sql('SELECT executedDay, executed FROM campaign_entries'), '/ws')
    expect(r.rows).toEqual([{ executedDay: '2026-10-12', executed: true }])
  })

  it('1.20 — aucune campagne : table vide, KPI sans ligne', async () => {
    const e = engine({})
    expect((await e.execute(ROOT, sql('SELECT * FROM campaign_entries'), '/ws')).rows).toEqual([])
    expect((await e.execute(ROOT, sql(seedSql('executedPct')), '/ws')).rows).toEqual([])
  })

  it('1.21 / 1.22 — campagne sans objectTypeRef ni fields, entrée sans snapshot ni test live', async () => {
    const legacy = campaign('CAMP-0005', [run(7, 'pending')], { objectTypeRef: undefined, fields: undefined as unknown as Record<string, unknown> })
    const r = await engine({ [ROOT]: [legacy] }).execute(ROOT, sql('SELECT campaignId, objectTypeRef, testTitle, executedAt FROM campaign_entries'), '/ws')
    expect(r.rows).toEqual([{ campaignId: 'CAMP-0005', objectTypeRef: null, testTitle: null, executedAt: null }])
  })

  it('testTitle : snapshot prioritaire, sinon test live', async () => {
    const snap = { id: 'TEST-0001', title: 'Figé' } as TestCase
    const c = campaign('CAMP-0006', [run(1, 'PASS', { testSnapshot: snap }), run(2, 'PASS')])
    const r = await engine({ [ROOT]: [c] }, { tests: [{ id: 'TEST-0002', title: 'Live' } as TestCase] })
      .execute(ROOT, sql('SELECT testCaseId, testTitle FROM campaign_entries ORDER BY testCaseId'), '/ws')
    expect(r.rows.map(x => x.testTitle)).toEqual(['Figé', 'Live'])
  })

  it('1.23 — champ perso `status` → campaign_status, status = statut de l\'entrée', async () => {
    const r = await engine({ [ROOT]: [CAMP_A] }).execute(ROOT, sql("SELECT DISTINCT status, campaign_status FROM campaign_entries WHERE status = 'FAIL'"), '/ws')
    expect(r.rows).toEqual([{ status: 'FAIL', campaign_status: 'perso' }])
  })

  it('1.24 — % PASS sans entrée exécutée : aucune ligne (KPI en état vide)', async () => {
    const r = await engine({ [ROOT]: [campaign('CAMP-0007', [run(1, 'pending')])] }).execute(ROOT, sql(seedSql('passPct')), '/ws')
    expect(r.rows).toEqual([])
  })

  it('1.29 — sans CampaignsService : table vide', async () => {
    const r = await engine({ [ROOT]: [CAMP_A] }, { withCampaigns: false }).execute(ROOT, sql('SELECT * FROM campaign_entries'), '/ws')
    expect(r.rows).toEqual([])
  })

  it('1.30 — INTO refusé sur campaign_entries', async () => {
    await expect(engine({ [ROOT]: [CAMP_A] }).execute(ROOT, sql("SELECT * INTO CSV('x.csv') FROM campaign_entries"), '/ws')).rejects.toThrow(/lecture seule/)
  })

  it('requêtes du seed : avancement, par jour, échecs', async () => {
    const e = engine({ [ROOT]: [CAMP_A, campaign('CAMP-0008', [run(1, 'PASS')], { status: 'completed' })] })
    const progress = await e.execute(ROOT, sql(seedSql('progress')), '/ws')
    expect(progress.rows.every(x => x.campaignTitle === 'Campagne CAMP-0001')).toBe(true)
    const perDay = await e.execute(ROOT, sql(seedSql('perDay')), '/ws')
    expect(perDay.rows).toEqual([{ executedDay: '2026-10-10', count: 2 }, { executedDay: '2026-10-11', count: 3 }])
    const failures = await e.execute(ROOT, sql(seedSql('failures')), '/ws')
    expect(failures.rows.map(x => x.entryId)).toEqual(['TEST-0004'])
  })
})
