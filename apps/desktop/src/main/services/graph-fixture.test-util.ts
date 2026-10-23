import type {
  CampaignTestRun, CoverageStatus, ObjectLink, ProjectSchema, Requirement, TestCampaign, TestCase, TestRun,
} from '@polenta/types'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'
import type { GitService } from './git.service'

// GH74 — jeu de données commun aux tests du graphe et de la bibliothèque de départ : un repo
// produit (avec un composant local) et un repo composant, dont les types de test portent le même
// `objectTypeRef` (`root::test`) mais pas les mêmes statuts d'approbation.

export const ROOT = '/ws/produit'
export const COMP = '/ws/moteur'
export const WS = '/ws'

const statuses = (names: string[], approval: string) => names.map((name) => ({ name, label: name.toUpperCase(), ...(name === approval ? { isApproval: true } : {}) }))

export const SCHEMA_ROOT = {
  version: 1,
  linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
  nodes: [{
    name: 'root',
    label: 'Produit',
    objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement',
        fields: [
          { name: 'priority', label: 'Priorité', type: 'enum', values: ['high', 'low'], required: true, trackHistory: true },
          { name: 'statement', label: 'Énoncé', type: 'richtext', validator: 'EARS', required: true },
          { name: 'acceptanceCriteria', label: 'Critères', type: 'textarea' },
        ],
        statuses: [...statuses(['draft', 'review', 'approved'], 'approved'), { name: 'obsolete', label: 'OBSOLETE', isTerminal: true }],
      },
      { name: 'test', label: 'Test', prefix: 'TST', category: 'test', fields: [], statuses: statuses(['draft', 'review', 'approved'], 'approved') },
      { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [{ name: 'banc', label: 'Banc', type: 'text' }], statuses: [] },
    ],
    children: [{
      name: 'hydraulique',
      label: 'Hydraulique',
      objectTypes: [{
        name: 'exigence-hyd', label: 'Exigence hydraulique', prefix: 'HYD', category: 'requirement',
        fields: [], statuses: statuses(['draft', 'approved'], 'approved'),
      }],
    }],
  }],
} as unknown as ProjectSchema

export const SCHEMA_COMP = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root',
    label: 'Moteur',
    objectTypes: [
      { name: 'exigence-mot', label: 'Exigence moteur', prefix: 'MOT', category: 'requirement', fields: [], statuses: statuses(['brouillon', 'valide'], 'valide') },
      { name: 'test', label: 'Test moteur', prefix: 'TMOT', category: 'test', fields: [], statuses: statuses(['brouillon', 'revu', 'valide'], 'valide') },
    ],
  }],
} as unknown as ProjectSchema

const audit = (d: string) => ({ createdAt: `${d}T08:00:00.000Z`, createdBy: 'alice', updatedAt: `${d}T09:00:00.000Z`, updatedBy: 'bob' })

function req(id: string, ref: string, status: string, fields: Record<string, unknown>, extra: Partial<Requirement> = {}): Requirement {
  return { id, projectId: '', branchId: '', objectTypeRef: ref, title: `Titre ${id}`, status, version: 1, fields, jiraLinks: [], ...audit('2026-09-01'), ...extra } as unknown as Requirement
}

function test(id: string, status: string): TestCase {
  return { id, projectId: '', branchId: '', objectTypeRef: 'root::test', title: `Test ${id}`, status, version: 2, fields: {}, steps: [], ...audit('2026-09-02') } as unknown as TestCase
}

export const REQUIREMENTS_ROOT: Requirement[] = [
  req('REQ-0001', 'root::exigence', 'approved', {
    priority: 'high', statement: 'WHEN the user presses start THE system SHALL start within 500 ms', acceptanceCriteria: '- [ ] 500 ms',
  }, { history: { status: [{ value: 'draft', at: '2026-09-01T08:00:00Z', by: 'alice' }, { value: 'approved', at: '2026-09-10T08:00:00Z', by: 'bob' }] } }),
  // Statut courant ≠ dernière entrée : entrée implicite attendue (G4).
  req('REQ-0002', 'root::exigence', 'approved', { priority: 'low', statement: 'Le système démarre vite', acceptanceCriteria: 'rapide' }, {
    history: { status: [{ value: 'review', at: '2026-09-05T08:00:00Z', by: 'alice' }] },
  }),
  req('REQ-0003', 'root::exigence', 'draft', { statement: 'THE system SHALL stop' }, { needsRevalidation: true }),
  req('HYD-0001', 'hydraulique::exigence-hyd', 'draft', {}),
  req('REQ-0004', '', 'draft', {}),
]
export const REQUIREMENTS_COMP: Requirement[] = [req('MOT-0001', 'root::exigence-mot', 'valide', {})]

export const TESTS_ROOT: TestCase[] = [test('TST-0001', 'approved'), test('TST-0002', 'draft')]
export const TESTS_COMP: TestCase[] = [test('TMOT-0001', 'brouillon'), test('TMOT-0002', 'valide')]

export const LINKS_ROOT: ObjectLink[] = [
  { id: 'LNK-1', type: 'verification', sourceId: 'TST-0001', targetId: 'REQ-0001', createdAt: '2026-09-03T00:00:00Z', createdBy: 'alice' } as unknown as ObjectLink,
]

function run(id: string, testCaseId: string, result: TestRun['result'], executedAt: string, campaignEntry?: { campaignId: string; entryId: string }): TestRun {
  return { id, testCaseId, result, executedAt, executedBy: 'carol', duration: 60, equipmentUsed: [], stepResults: [], notes: '', ...(campaignEntry ? { campaignEntry } : {}) }
}

export const RUNS_ROOT: TestRun[] = [
  run('RUN-1', 'TST-0001', 'FAIL', '2026-10-02T10:00:00Z', { campaignId: 'CAMP-0001', entryId: 'TST-0001-1' }),
  run('RUN-2', 'TST-0001', 'PASS', '2026-10-03T10:00:00Z', { campaignId: 'CAMP-0001', entryId: 'TST-0001-1' }),
  // Données antérieures à GH73 (CAMP-0002) : pas de `campaignEntry`.
  run('RUN-OLDER', 'TST-0002', 'FAIL', '2026-09-05T10:00:00Z'),
  run('RUN-OLD', 'TST-0002', 'PASS', '2026-09-10T10:00:00Z'),
  // Exécution isolée, hors campagne (et hors fenêtre de CAMP-0002).
  run('RUN-ALONE', 'TST-0002', 'BLOCKED', '2026-09-25T10:00:00Z'),
]

const snapshot = (t: TestCase, status: string): TestCase => ({ ...t, status, title: `${t.title} (copie)` })

function entry(entryId: string, testCaseId: string, status: CampaignTestRun['status'], extra: Partial<CampaignTestRun> = {}): CampaignTestRun {
  return { entryId, testCaseId, status, ...extra }
}

export const CAMPAIGNS_ROOT: TestCampaign[] = [
  {
    id: 'CAMP-0001', title: 'Campagne en cours', objectTypeRef: 'root::campagne', fields: { banc: 'B1' }, status: 'in_progress',
    testCaseIds: ['TST-0001', 'TST-0002', 'TMOT-0001', 'TMOT-0002'], createdAt: '2026-10-01T07:00:00Z', completedAt: null,
    history: { status: [{ value: 'planned', at: '2026-10-01T07:00:00Z', by: 'alice' }, { value: 'in_progress', at: '2026-10-02T09:00:00Z', by: 'alice' }] },
    runs: [
      entry('TST-0001-1', 'TST-0001', 'PASS', { runId: 'RUN-2', executedAt: '2026-10-03T10:00:00Z', executedBy: 'carol', addedAt: '2026-10-01T07:00:00Z', testSnapshot: snapshot(TESTS_ROOT[0], 'approved') }),
      entry('TST-0002-1', 'TST-0002', 'pending', { addedAt: '2026-10-01T07:00:00Z', testSnapshot: snapshot(TESTS_ROOT[1], 'draft') }),
      entry('TMOT-0001-1', 'TMOT-0001', 'pending', { addedAt: '2026-10-02T07:00:00Z', testSnapshot: snapshot(TESTS_COMP[0], 'brouillon') }),
      entry('TMOT-0002-1', 'TMOT-0002', 'pending', { addedAt: '2026-10-02T07:00:00Z', testSnapshot: snapshot(TESTS_COMP[1], 'brouillon') }),
      entry('TST-0001-2', 'TST-0001', 'pending', { addedAt: '2026-10-04T07:00:00Z', requirementId: 'REQ-0001' }),
    ],
    removedRuns: [{ ...entry('TST-0002-2', 'TST-0002', 'pending', { addedAt: '2026-10-02T07:00:00Z' }), removedAt: '2026-10-05T07:00:00Z' }],
  },
  {
    id: 'CAMP-0002', title: 'Campagne close', objectTypeRef: 'root::campagne', fields: {}, status: 'completed',
    testCaseIds: ['TST-0002'], createdAt: '2026-09-01T07:00:00Z', completedAt: '2026-09-20T18:00:00Z',
    runs: [
      entry('TST-0002-1', 'TST-0002', 'PASS', { runId: 'RUN-OLD', executedAt: '2026-09-10T10:00:00Z', testSnapshot: snapshot(TESTS_ROOT[1], 'review') }),
      entry('TST-0001-1', 'TST-0001', 'pending', { testSnapshot: snapshot(TESTS_ROOT[0], 'draft') }),
    ],
  },
]

export const COVERAGE = new Map<string, { coverageStatus: CoverageStatus }>([['REQ-0001', { coverageStatus: 'covered' }]])

export interface FixtureOptions {
  /** Campagnes du repo composant illisibles (G9). */
  brokenComponentCampaigns?: boolean
}

/** Services simulés, avec un compteur des lectures d'index (cache, G10–G11). */
export function fixtureServices(opts: FixtureOptions = {}) {
  const calls = { findAll: 0 }
  const byRepo = <T>(root: T[], comp: T[]) => async (rp: string) => (rp === ROOT ? root : rp === COMP ? comp : [])
  const reqIndex = {
    findAll: async (rp: string) => { calls.findAll++; return byRepo(REQUIREMENTS_ROOT, REQUIREMENTS_COMP)(rp) },
    findAllLinks: byRepo(LINKS_ROOT, []),
  } as unknown as RequirementsIndexService
  const runsMap = (rp: string) => {
    const m = new Map<string, TestRun[]>()
    if (rp !== ROOT) return m
    for (const r of RUNS_ROOT) m.set(r.testCaseId, [...(m.get(r.testCaseId) ?? []), r])
    return m
  }
  const testsIndex = {
    findAll: byRepo(TESTS_ROOT, TESTS_COMP),
    getRunsMap: async (rp: string) => runsMap(rp),
    getLatestRunMap: async (rp: string) => {
      const out = new Map<string, TestRun>()
      for (const [id, list] of runsMap(rp)) out.set(id, [...list].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1))[0])
      return out
    },
  } as unknown as TestsIndexService
  const schema = { get: async (rp: string) => (rp === COMP ? SCHEMA_COMP : SCHEMA_ROOT) } as unknown as SchemaService
  const traceability = { computeCoverage: () => COVERAGE } as unknown as TraceabilityService
  const workspaceTree = {
    readCache: async () => ({ nodes: [{ name: 'produit', label: 'Produit', repoPath: ROOT }, { name: 'moteur', label: 'Moteur', repoPath: COMP }] }),
  } as unknown as WorkspaceTreeService
  const campaigns = {
    list: async (rp: string) => {
      if (rp === COMP && opts.brokenComponentCampaigns) throw new Error('YAML invalide')
      return rp === ROOT ? CAMPAIGNS_ROOT : []
    },
  } as unknown as CampaignsService
  const git = {
    fileHistory: async () => ({ createdAt: '2026-09-01T07:00:00Z', createdBy: 'alice', updatedAt: '2026-10-02T09:30:00Z', updatedBy: 'alice' }),
  } as unknown as GitService
  return { reqIndex, testsIndex, schema, traceability, workspaceTree, campaigns, git, calls }
}
