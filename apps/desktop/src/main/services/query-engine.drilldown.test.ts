import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, ProjectSchema, Requirement, TestCampaign, TestCase } from '@polenta/types'
import { QueryEngineService } from './query-engine.service'
import { CAMPAIGN_SEED_QUERIES } from './dashboard-seed.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'

// GH65 sprint 2 — drill-down (lignes d'un élément de widget) et objet à ouvrir pour une ligne.

const ROOT = '/ws/produit'
const COMP = '/ws/bms'

const SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root',
    label: 'Produit',
    objectTypes: [
      { name: 'sys', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [{ name: 'priority', label: 'Priorité', type: 'text' }], statuses: [] },
      { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [], statuses: [] },
    ],
  }],
} as unknown as ProjectSchema

const req = (id: string, status: string, priority: string | null, title = id): Requirement =>
  ({ id, title, status, objectTypeRef: 'root::sys', version: 1, fields: priority === null ? {} : { priority } }) as unknown as Requirement

const REQS: Requirement[] = [
  req('SYS-0001', 'approved', 'high'),
  req('SYS-0002', 'approved', 'low'),
  req('SYS-0003', 'draft', 'high'),
  req('SYS-0004', 'draft', null, "l'essai"),
]

const run = (i: number, status: CampaignTestRun['status']): CampaignTestRun =>
  ({ entryId: `TEST-000${i}`, testCaseId: `TEST-000${i}`, status, ...(status !== 'pending' ? { executedAt: '2026-10-12T10:00:00Z' } : {}) })

const CAMP: TestCampaign = {
  id: 'CAMP-0001', title: 'A', objectTypeRef: 'root::campagne', fields: {}, status: 'in_progress',
  testCaseIds: [], createdAt: '2026-10-01T00:00:00Z',
  runs: [run(1, 'PASS'), run(2, 'FAIL'), run(3, 'FAIL'), run(4, 'pending')],
}
const CAMP_B: TestCampaign = { ...CAMP, id: 'CAMP-0002', title: 'B', runs: [run(1, 'FAIL')] }

const T9 = { id: 'TEST-0009', title: 'T9', objectTypeRef: 'root::t', fields: {} } as unknown as TestCase

function engine() {
  const reqIndex = {
    findAll: async (rp: string) => (rp === ROOT ? REQS : []),
    findById: async (rp: string, id: string) => (rp === ROOT ? REQS.find(r => r.id === id) ?? null : null),
    findAllLinks: async () => [],
  } as unknown as RequirementsIndexService
  const testsIndex = {
    findAll: async (rp: string) => (rp === COMP ? [T9] : []),
    findById: async (rp: string, id: string) => (rp === COMP && id === T9.id ? T9 : null),
    getLatestRunMap: async () => new Map(),
    getRunsMap: async () => new Map(),
  } as unknown as TestsIndexService
  const schema = { get: async () => SCHEMA } as unknown as SchemaService
  const traceability = { computeCoverage: () => new Map() } as unknown as TraceabilityService
  const workspaceTree = {
    readCache: async () => ({ nodes: [{ name: 'produit', repoPath: ROOT }, { name: 'bms', repoPath: COMP }] }),
  } as unknown as WorkspaceTreeService
  const campaigns = { list: async (rp: string) => (rp === COMP ? [CAMP, CAMP_B] : []) } as unknown as CampaignsService
  return new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree, campaigns)
}

const sql = (sqlText: string) => ({ mode: 'sql' as const, sqlText })
const builder = (extra: Partial<{ conditions: unknown[]; combinator: 'AND' | 'OR'; groupBy: string[] }> = {}) => ({
  mode: 'builder' as const,
  builderConfig: { objectTypeRef: 'root::sys', conditions: [], combinator: 'AND' as const, ...extra } as never,
})
const ids = (rows: Array<Record<string, unknown>>, key = 'id') => rows.map(r => r[key]).sort()

describe('GH65 — drillDown', () => {
  it('2.1 — segment FAIL de la barre empilée du seed (SQL simple) → entrées FAIL de la campagne', async () => {
    const progress = CAMPAIGN_SEED_QUERIES.find(q => q.key === 'progress')!.sqlText
    const r = await engine().drillDown(ROOT, sql(progress), { values: { campaignTitle: 'A', status: 'FAIL' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows, 'entryId')).toEqual(['TEST-0002', 'TEST-0003'])
    expect(r.columns.map(c => c.name)).toContain('executedAt')
  })

  it('2.2 — builder groupBy status, clic sur approved → exigences approuvées, colonnes complètes', async () => {
    const r = await engine().drillDown(ROOT, builder({ groupBy: ['status'] }), { values: { status: 'approved' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows)).toEqual(['SYS-0001', 'SYS-0002'])
    expect(r.rows[0]).toHaveProperty('title')
  })

  it('2.3 — builder OR conservé : (c1 OR c2) AND valeur cliquée', async () => {
    const r = await engine().drillDown(ROOT, builder({
      combinator: 'OR',
      conditions: [{ field: 'priority', operator: '=', value: 'high' }, { field: 'status', operator: '=', value: 'draft' }],
      groupBy: ['status'],
    }), { values: { status: 'draft' } }, '/ws')
    expect(ids(r.rows)).toEqual(['SYS-0003', 'SYS-0004'])
  })

  it('2.4 — KPI (sélection vide) → toutes les lignes sources', async () => {
    const pct = CAMPAIGN_SEED_QUERIES.find(q => q.key === 'executedPct')!.sqlText
    const r = await engine().drillDown(ROOT, sql(pct), { values: {} }, '/ws')
    expect(r.mode).toBe('source')
    expect(r.rows).toHaveLength(5)
  })

  it('2.20 — jointure → repli sur les lignes du résultat', async () => {
    const q = 'SELECT r.status AS status, COUNT(*) AS n FROM requirements r JOIN requirements q ON q.id = r.id GROUP BY r.status'
    const r = await engine().drillDown(ROOT, sql(q), { values: { status: 'draft' } }, '/ws')
    expect(r.mode).toBe('result')
    expect(r.rows).toEqual([{ status: 'draft', n: 2 }])
  })

  it('2.21 — catégorie calculée (expression) → repli', async () => {
    const r = await engine().drillDown(ROOT, sql('SELECT UPPER(status) AS s, COUNT(*) AS n FROM requirements GROUP BY UPPER(status)'), { values: { s: 'DRAFT' } }, '/ws')
    expect(r.mode).toBe('result')
    expect(r.rows).toEqual([{ s: 'DRAFT', n: 2 }])
  })

  it('2.22 — sous-requête en FROM / UNION → repli', async () => {
    const e = engine()
    expect((await e.drillDown(ROOT, sql('SELECT status FROM (SELECT * FROM requirements) t'), { values: { status: 'draft' } }, '/ws')).mode).toBe('result')
    expect((await e.drillDown(ROOT, sql('SELECT id FROM requirements UNION SELECT id FROM tests'), { values: { id: 'SYS-0001' } }, '/ws')).mode).toBe('result')
  })

  it('2.23 — catégorie NULL → IS NULL (builder et SQL)', async () => {
    const e = engine()
    const b = await e.drillDown(ROOT, builder({ groupBy: ['priority'] }), { values: { priority: null } }, '/ws')
    expect(ids(b.rows)).toEqual(['SYS-0004'])
    const s = await e.drillDown(ROOT, sql('SELECT priority, COUNT(*) AS n FROM requirements GROUP BY priority'), { values: { priority: null } }, '/ws')
    expect(s.mode).toBe('source')
    expect(ids(s.rows)).toEqual(['SYS-0004'])
  })

  it('2.24 — valeur avec apostrophe', async () => {
    const r = await engine().drillDown(ROOT, sql('SELECT title, COUNT(*) AS n FROM requirements GROUP BY title'), { values: { title: "l'essai" } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows)).toEqual(['SYS-0004'])
  })

  it('WHERE d\'origine avec OR : parenthèses conservées', async () => {
    const q = "SELECT status, COUNT(*) AS n FROM requirements WHERE priority = 'high' OR priority = 'low' GROUP BY status"
    const r = await engine().drillDown(ROOT, sql(q), { values: { status: 'draft' } }, '/ws')
    expect(ids(r.rows)).toEqual(['SYS-0003'])
  })

  it('SELECT * sans GROUP BY : colonne cliquée lue sur la table', async () => {
    const r = await engine().drillDown(ROOT, sql('SELECT * FROM requirements'), { values: { status: 'approved' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows)).toEqual(['SYS-0001', 'SYS-0002'])
  })

  it("revue — littéral avec apostrophe dans le WHERE d'origine : sens conservé", async () => {
    const q = "SELECT status, COUNT(*) AS n FROM requirements WHERE title = 'l''essai' OR title = 'SYS-0003' GROUP BY status"
    const r = await engine().drillDown(ROOT, sql(q), { values: { status: 'draft' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows)).toEqual(['SYS-0003', 'SYS-0004'])
    const injection = "SELECT status, COUNT(*) AS n FROM requirements WHERE title <> 'a'' OR ''1''=''1' GROUP BY status"
    const r2 = await engine().drillDown(ROOT, sql(injection), { values: { status: 'approved' } }, '/ws')
    expect(ids(r2.rows)).toEqual(['SYS-0001', 'SYS-0002'])
  })

  it('revue — alias de table conservé', async () => {
    const q = "SELECT r.status AS st, COUNT(*) AS n FROM requirements r WHERE r.priority = 'high' GROUP BY r.status"
    const r = await engine().drillDown(ROOT, sql(q), { values: { st: 'approved' } }, '/ws')
    expect(r.mode).toBe('source')
    expect(ids(r.rows)).toEqual(['SYS-0001'])
  })

  it('revue — TOP / LIMIT → repli (les lignes sources ne seraient pas celles comptées)', async () => {
    const e = engine()
    expect((await e.drillDown(ROOT, sql('SELECT * FROM requirements LIMIT 1'), { values: {} }, '/ws')).mode).toBe('result')
    expect((await e.drillDown(ROOT, sql('SELECT TOP 1 * FROM requirements'), { values: {} }, '/ws')).mode).toBe('result')
  })

  it('revue — valeur tableau → repli, comparée par contenu', async () => {
    const r = await engine().drillDown(ROOT, sql('SELECT id, fields_tags FROM (SELECT id, ARRAY(status) AS fields_tags FROM requirements GROUP BY id)'), { values: { id: ['x'] } }, '/ws')
    expect(r.mode).toBe('result')
  })

  it('revue — builder : colonne cliquée hors allowlist → repli explicite', async () => {
    const r = await engine().drillDown(ROOT, builder({ groupBy: ['status'] }), { values: { status: 'approved', count: 2 } }, '/ws')
    expect(r.mode).toBe('result')
    expect(r.rows).toEqual([{ status: 'approved', count: 2 }])
  })

  it('garde-fou lecture seule', async () => {
    await expect(engine().drillDown(ROOT, sql("SELECT * INTO CSV('x') FROM requirements"), { values: {} }, '/ws')).rejects.toThrow(/lecture seule/)
  })
})

describe('GH65 — resolveRowTarget', () => {
  const e = engine()
  it('2.6 — entrée exécutée → résultat d\'exécution, repo de la campagne (2.29)', async () => {
    expect(await e.resolveRowTarget(ROOT, { campaignId: 'CAMP-0001', entryId: 'TEST-0002', status: 'FAIL' }, '/ws'))
      .toEqual({ kind: 'campaign-run', campaignId: 'CAMP-0001', entryId: 'TEST-0002', repoPath: COMP })
  })

  it('2.7 — entrée pending → page de campagne filtrée', async () => {
    expect(await e.resolveRowTarget(ROOT, { campaignId: 'CAMP-0001', entryId: 'TEST-0004' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-0001', repoPath: COMP, status: 'pending' })
  })

  it('campagne seule (+ statut valide), statut inconnu ignoré', async () => {
    expect(await e.resolveRowTarget(ROOT, { campaignId: 'CAMP-0002', status: 'FAIL' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-0002', repoPath: COMP, status: 'FAIL' })
    expect(await e.resolveRowTarget(ROOT, { campaignId: 'CAMP-0002', status: 'FOO' }, '/ws'))
      .toEqual({ kind: 'campaign', id: 'CAMP-0002', repoPath: COMP })
  })

  it('2.8 — id d\'exigence / de test / de campagne', async () => {
    expect(await e.resolveRowTarget(ROOT, { id: 'SYS-0003' }, '/ws')).toEqual({ kind: 'requirement', id: 'SYS-0003', repoPath: ROOT })
    expect(await e.resolveRowTarget(ROOT, { id: 'TEST-0009' }, '/ws')).toEqual({ kind: 'test', id: 'TEST-0009', repoPath: COMP })
    expect(await e.resolveRowTarget(ROOT, { id: 'CAMP-0001' }, '/ws')).toEqual({ kind: 'campaign', id: 'CAMP-0001', repoPath: COMP })
  })

  it('2.25 / 2.26 — ligne sans colonne exploitable ou id inconnu → null', async () => {
    expect(await e.resolveRowTarget(ROOT, { status: 'draft', n: 2 }, '/ws')).toBeNull()
    expect(await e.resolveRowTarget(ROOT, { id: 'SYS-9999' }, '/ws')).toBeNull()
    expect(await e.resolveRowTarget(ROOT, { campaignId: 'CAMP-9999', entryId: 'X' }, '/ws')).toBeNull()
  })
})
