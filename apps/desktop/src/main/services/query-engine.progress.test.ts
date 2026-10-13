import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, ProjectSchema, TestCampaign, TestCase } from '@polenta/types'
import { QueryEngineService } from './query-engine.service'
import { PROGRESS_SQL } from './dashboard-seed.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'

// GH71 — étape d'avancement dans `campaign_entries` et ouverture d'une ligne (scénarios Q1–Q6,
// T1–T4 de specs/GH71-tests.md). Deux repos : produit (type `root::test`) et composant BMS (type
// `bms::essai`, statuts propres).

const ROOT = '/ws/produit'
const COMP = '/ws/bms'

function schemaWith(node: string, type: string, statuses: string[], approval: string): ProjectSchema {
  return {
    version: 1, linkTypes: [],
    nodes: [{
      name: node, label: node, objectTypes: [
        { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [], statuses: [] },
        { name: type, label: type, prefix: 'T', category: 'test', fields: [], statuses: [...statuses.map(name => ({ name })), { name: approval, isApproval: true }] },
      ],
    }],
  } as unknown as ProjectSchema
}
const SCHEMAS: Record<string, ProjectSchema> = {
  [ROOT]: schemaWith('root', 'test', ['draft', 'review'], 'valide'),
  [COMP]: schemaWith('bms', 'essai', ['brouillon', 'relecture'], 'valide'),
}

const tc = (id: string, status: string, ref = 'root::test') => ({ id, title: `Titre ${id}`, status, objectTypeRef: ref, fields: {} } as unknown as TestCase)

function run(testCaseId: string, status: CampaignTestRun['status'], snapshot?: TestCase): CampaignTestRun {
  return {
    entryId: `${testCaseId}-1`, testCaseId, status,
    ...(snapshot && { testSnapshot: snapshot }),
    ...(status !== 'pending' ? { executedAt: '2026-10-13T10:00:00.000Z', runId: `RUN-${testCaseId}` } : {}),
  }
}

function campaign(id: string, runs: CampaignTestRun[], status: TestCampaign['status'] = 'in_progress'): TestCampaign {
  return { id, title: `Campagne ${id}`, objectTypeRef: 'root::campagne', fields: {}, status, testCaseIds: runs.map(r => r.testCaseId), runs, createdAt: '2026-10-01T00:00:00.000Z' }
}

function engine(liveByRepo: Record<string, TestCase[]>, campaignsByRepo: Record<string, TestCampaign[]>) {
  const reqIndex = { findAll: async () => [], findAllLinks: async () => [], findById: async () => null } as unknown as RequirementsIndexService
  const testsIndex = {
    findAll: async (rp: string) => liveByRepo[rp] ?? [],
    findById: async (rp: string, id: string) => (liveByRepo[rp] ?? []).find(t => t.id === id) ?? null,
    getLatestRunMap: async () => new Map(),
    getRunsMap: async () => new Map(),
  } as unknown as TestsIndexService
  const schema = { get: async (rp: string) => SCHEMAS[rp] } as unknown as SchemaService
  const traceability = { computeCoverage: () => new Map() } as unknown as TraceabilityService
  const workspaceTree = {
    readCache: async () => ({ nodes: [{ name: 'produit', repoPath: ROOT }, { name: 'bms', repoPath: COMP }] }),
  } as unknown as WorkspaceTreeService
  const campaigns = { list: async (rp: string) => campaignsByRepo[rp] ?? [] } as unknown as CampaignsService
  return new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree, campaigns)
}

const sql = (sqlText: string) => ({ mode: 'sql' as const, sqlText })

// Campagne de référence : A brouillon, B en revue, C approuvé non exécuté, D PASS, E FAIL.
const LIVE = [tc('A', 'draft'), tc('B', 'review'), tc('C', 'valide'), tc('D', 'valide'), tc('E', 'valide')]
const CAMP_1 = campaign('CAMP-1', [
  run('A', 'pending', tc('A', 'draft')), run('B', 'pending', tc('B', 'review')), run('C', 'pending', tc('C', 'valide')),
  run('D', 'PASS', tc('D', 'valide')), run('E', 'FAIL', tc('E', 'valide')),
])

async function rows(e: QueryEngineService, query = 'SELECT testCaseId, status, progress, progressRank, testStatus FROM campaign_entries ORDER BY progressRank') {
  return (await e.execute(ROOT, sql(query), '/ws')).rows
}

describe('GH71 — campaign_entries : étape d\'avancement', () => {
  it('Q1 — étapes, rangs et statut du test ; `status` inchangé', async () => {
    const r = await rows(engine({ [ROOT]: LIVE }, { [ROOT]: [CAMP_1] }))
    expect(r.map(x => [x.testCaseId, x.status, x.progress, x.testStatus])).toEqual([
      ['A', 'pending', 'prep:draft', 'draft'],
      ['B', 'pending', 'prep:review', 'review'],
      ['C', 'pending', 'ready', 'valide'],
      ['E', 'FAIL', 'FAIL', 'valide'],
      ['D', 'PASS', 'PASS', 'valide'],
    ])
    expect(r.map(x => x.progressRank)).toEqual([0, 1, 1000, 1003, 1004])
  })

  it('Q2 — test passé en revue : étape live, sans réécriture de la campagne', async () => {
    const live = LIVE.map(t => (t.id === 'A' ? tc('A', 'review') : t))
    const r = await rows(engine({ [ROOT]: live }, { [ROOT]: [CAMP_1] }), "SELECT progress FROM campaign_entries WHERE testCaseId = 'A'")
    expect(r).toEqual([{ progress: 'prep:review' }])
  })

  it('Q3 — campagne clôturée : copie figée', async () => {
    const closed = campaign('CAMP-2', [run('A', 'pending', tc('A', 'draft'))], 'completed')
    const live = [tc('A', 'valide')]
    const r = await rows(engine({ [ROOT]: live }, { [ROOT]: [closed] }), 'SELECT progress, testStatus FROM campaign_entries')
    expect(r).toEqual([{ progress: 'prep:draft', testStatus: 'draft' }])
  })

  it('Q4 — test d\'un composant : statut et rang jugés dans le schéma de son repo', async () => {
    const x = tc('X', 'relecture', 'bms::essai')
    const camp = campaign('CAMP-3', [run('X', 'pending', x)])
    const r = await rows(engine({ [ROOT]: [], [COMP]: [x] }, { [ROOT]: [camp] }), 'SELECT progress, progressRank FROM campaign_entries')
    expect(r).toEqual([{ progress: 'prep:relecture', progressRank: 1 }])
  })

  it('Q5 — requête du seed et builder sur `progress`', async () => {
    const e = engine({ [ROOT]: LIVE }, { [ROOT]: [CAMP_1] })
    const seeded = (await e.execute(ROOT, sql(PROGRESS_SQL), '/ws')).rows
    expect(seeded.map(x => [x.progress, x.count]).sort()).toEqual([['FAIL', 1], ['PASS', 1], ['prep:draft', 1], ['prep:review', 1], ['ready', 1]])
    const built = await e.execute(ROOT, {
      mode: 'builder', builderConfig: { objectTypeRef: 'root::campagne', conditions: [{ field: 'progress', operator: '=', value: 'ready' }], combinator: 'AND' },
    } as never, '/ws')
    expect(built.rows.map(x => x.testCaseId)).toEqual(['C'])
  })

  it('Q6 — drill-down d\'un segment « En revue » de la requête du seed', async () => {
    const r = await engine({ [ROOT]: LIVE }, { [ROOT]: [CAMP_1] })
      .drillDown(ROOT, sql(PROGRESS_SQL), { values: { campaignTitle: 'Campagne CAMP-1', progress: 'prep:review' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(r.rows.map(x => x.entryId)).toEqual(['B-1'])
  })
})

describe('GH71 — resolveRowTarget', () => {
  const e = () => engine({ [ROOT]: LIVE }, { [ROOT]: [CAMP_1] })

  it('T1 — entrée en brouillon → campagne filtrée sur son étape', async () => {
    expect(await e().resolveRowTarget(ROOT, { campaignId: 'CAMP-1', entryId: 'A-1' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-1', repoPath: ROOT, progress: 'prep:draft' })
  })

  it('T2 — entrée exécutée → résultat d\'exécution', async () => {
    expect(await e().resolveRowTarget(ROOT, { campaignId: 'CAMP-1', entryId: 'D-1' }, '/ws'))
      .toEqual({ kind: 'campaign-run', campaignId: 'CAMP-1', entryId: 'D-1', repoPath: ROOT })
  })

  it('T3 — ligne de campagne avec une étape valide', async () => {
    expect(await e().resolveRowTarget(ROOT, { campaignId: 'CAMP-1', progress: 'ready' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-1', repoPath: ROOT, progress: 'ready' })
    expect(await e().resolveRowTarget(ROOT, { campaignId: 'CAMP-1', progress: 'nimporte' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-1', repoPath: ROOT })
  })

  it('T4 — test introuvable partout, sans copie → prêt', async () => {
    const camp = campaign('CAMP-4', [run('Z', 'pending')])
    expect(await engine({ [ROOT]: [] }, { [ROOT]: [camp] }).resolveRowTarget(ROOT, { campaignId: 'CAMP-4', entryId: 'Z-1' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-4', repoPath: ROOT, progress: 'ready' })
  })
})
