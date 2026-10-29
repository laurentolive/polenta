import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Change, ObjectLink, ObjectTypeDefinition, ProjectSchema, TestCampaign } from '@polenta/types'
import { DEFAULT_CHANGE_STATUSES, pruneImpacted } from '@polenta/types'
import { computeChangeAnalysis } from './change-analysis.util'
import { ChangesService } from './changes.service'
import { GitService } from './git.service'
import { SyncService } from './sync.service'
import { TraceabilityService, type ImpactSnapshot } from './traceability.service'
import type { SchemaService } from './schema.service'
import type { AuthService } from './auth.service'

// GH199 — analyse d'impact d'un change (specs/GH199-tests.md, scénarios 1 à 8).

const git = new GitService()
const sync = new SyncService({} as AuthService)
const traceability = new TraceabilityService({} as never, {} as never, git, sync)

// SYS-1 ← SW-1 (SW-1 raffine SYS-1) ; TEST-1 couvre SW-1 ; TEST-2 couvre SYS-1 ; SW-2 seul.
const link = (sourceId: string, targetId: string, type = 'refine'): ObjectLink =>
  ({ id: `${sourceId}-${targetId}`, sourceId, targetId, type } as ObjectLink)
function snapshotOf(links: ObjectLink[]): ImpactSnapshot {
  const req = (title: string, objectTypeRef = 'root::exigence') => ({ title, repoPath: '/r', objectTypeRef })
  return {
    rootRepoPath: '/r',
    requirements: new Map([['SYS-1', req('Système')], ['SW-1', req('Logiciel')], ['SW-2', req('Isolée')], ['BMS-1', req('BMS', 'bms::exigence')]]),
    tests: new Map([['TEST-1', { title: 'T1', repoPath: '/r' }], ['TEST-2', { title: 'T2', repoPath: '/r' }]]),
    links,
    repoNames: new Map(),
  }
}
const LINKS = [link('SW-1', 'SYS-1'), link('TEST-1', 'SW-1', 'verification'), link('TEST-2', 'SYS-1', 'verification')]

const baseChange = (over: Partial<Change> = {}): Change => ({
  id: 'NC-0001', projectId: '', branchId: '', objectTypeRef: 'root::nc', title: 'X', status: 'ouvert', version: 1,
  fields: {}, component: 'root', mode: 'request', toModify: [], impacted: [], origin: { runs: [], decisions: [] },
  integratedIn: null, campaigns: [], ...over,
})
const run = (change: Change, links = LINKS, campaigns: TestCampaign[] = []) => {
  const snapshot = snapshotOf(links)
  return computeChangeAnalysis({
    change, snapshot, campaigns, snapshotKind: { kind: 'workdir' },
    isComponentRequirement: ref => (ref ?? '').startsWith('root::'),
    trees: (id, type) => traceability.buildImpactTreesFromSnapshot(snapshot, id, type),
  })
}

describe('computeChangeAnalysis', () => {
  it('racines = listes ; impactés calculés dédupliqués ; statut reporté sur les nœuds', () => {
    const a = run(baseChange({
      toModify: [{ id: 'SW-1', state: 'planned' }, { id: 'TEST-1', state: 'planned' }],
      impacted: [{ id: 'TEST-2', status: 'impact_a_tester', source: 'computed' }],
    }))
    expect(a.roots.map(r => r.elementId)).toEqual(['SW-1', 'TEST-1'])
    // SYS-1 atteint depuis SW-1 (montant) et TEST-1 (montant) : une seule ligne.
    expect(a.rows.map(r => [r.id, r.source, r.status, r.reached])).toEqual([
      ['SYS-1', 'computed', 'impact_non_verifie', true],
      ['TEST-2', 'computed', 'impact_a_tester', true],
    ])
    const sw1 = a.roots[0]
    const sys1 = sw1.ascendantTree.find(n => n.elementId === 'SYS-1')!
    expect(sys1.children.find(n => n.elementId === 'TEST-2')?.status).toBe('impact_a_tester')
  })

  it('listes vides → exigences du composant', () => {
    const a = run(baseChange())
    expect(a.roots.map(r => r.elementId)).toEqual(['SW-1', 'SW-2', 'SYS-1'])
  })

  it('ligne calculée persistée non atteinte → « n\'est plus atteint » ; non persistée → absente', () => {
    const a = run(baseChange({
      toModify: [{ id: 'SW-1', state: 'planned' }],
      impacted: [{ id: 'TEST-1', status: 'impact_teste', comment: 'ok', source: 'computed' }],
    }), [link('SW-1', 'SYS-1')])
    expect(a.rows).toEqual([
      { id: 'SYS-1', elementType: 'requirement', title: 'Système', status: 'impact_non_verifie', source: 'computed', reached: true },
      { id: 'TEST-1', elementType: 'test_case', title: 'T1', status: 'impact_teste', comment: 'ok', source: 'computed', reached: false },
    ])
  })

  it('déclarés : lignes et racines', () => {
    const a = run(baseChange({ impacted: [{ id: 'SW-2', status: 'pas_d_impact_reel', source: 'declared' }] }))
    expect(a.roots.map(r => r.elementId)).toEqual(['SW-2'])
    expect(a.rows).toEqual([{ id: 'SW-2', elementType: 'requirement', title: 'Isolée', status: 'pas_d_impact_reel', source: 'declared', reached: true }])
  })

  it('campagnes non closes contenant un test impacté', () => {
    const camp = (id: string, status: string, tests: string[]) => ({ id, title: id, status, runs: tests.map(t => ({ testCaseId: t })) }) as unknown as TestCampaign
    const a = run(baseChange({ toModify: [{ id: 'SW-1', state: 'planned' }] }), LINKS,
      [camp('CAMP-1', 'in_progress', ['TEST-1', 'TEST-9']), camp('CAMP-2', 'completed', ['TEST-1']), camp('CAMP-3', 'planned', ['TEST-9'])])
    expect(a.campaigns).toEqual([{ id: 'CAMP-1', title: 'CAMP-1', status: 'in_progress', testIds: ['TEST-1'] }])
  })
})

describe('pruneImpacted', () => {
  it('garde les déclarées et les calculées portant une saisie', () => {
    expect(pruneImpacted([
      { id: 'A', status: 'impact_non_verifie', source: 'declared' },
      { id: 'B', status: 'impact_non_verifie', source: 'computed' },
      { id: 'C', status: 'impact_non_verifie', comment: 'vu', source: 'computed' },
      { id: 'D', status: 'impact_teste', source: 'computed' },
    ]).map(i => i.id)).toEqual(['A', 'C', 'D'])
  })
})

// ─── ChangesService : figé, range ─────────────────────────────────────────────

const NC: ObjectTypeDefinition = { name: 'nc', label: 'NC', prefix: 'NC', category: 'change', fields: [], statuses: DEFAULT_CHANGE_STATUSES }
const SCHEMA = { version: 1, linkTypes: [], nodes: [{ name: 'root', label: 'P', objectTypes: [NC, { name: 'exigence', category: 'requirement', fields: [], statuses: [] }] }] } as unknown as ProjectSchema

let dir: string
const sh = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args]).toString().trim()
const writeReq = (id: string, title: string) => git.writeYaml(dir, `requirements/${id}.yaml`, { id, title, status: 'draft', objectTypeRef: 'root::exigence', version: 1, fields: {} })
const svc = () => new ChangesService(git, { get: async () => SCHEMA } as unknown as SchemaService, undefined, undefined,
  { traceability, sync, campaigns: { list: async () => [] } })

beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh199-')) })
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

describe('ChangesService — analyse', () => {
  it('statut terminal → analyse figée écrite et renvoyée telle quelle ; retour → live', async () => {
    await writeReq('SW-1', 'Logiciel')
    await writeReq('SYS-1', 'Système')
    await git.writeYaml(dir, 'links/links.yaml', { links: [link('SW-1', 'SYS-1')] })
    const s = svc()
    await s.create(dir, { objectTypeRef: 'root::nc', title: 'A', toModify: [{ id: 'SW-1', state: 'planned' }] })
    expect((await s.analysis(dir, 'NC-0001')).frozen).toBe(false)

    await s.update(dir, 'NC-0001', { status: 'clos' })
    const onDisk = await git.readYaml<Change>(dir, 'changes/NC-0001.yaml')
    expect(onDisk?.analysis?.frozen).toBe(true)
    expect(onDisk?.analysis?.rows.map(r => r.id)).toEqual(['SYS-1'])
    // Un lien retiré après la clôture ne change pas l'analyse figée.
    await git.writeYaml(dir, 'links/links.yaml', { links: [] })
    expect((await s.analysis(dir, 'NC-0001')).rows.map(r => r.id)).toEqual(['SYS-1'])

    await s.update(dir, 'NC-0001', { status: 'analyse' })
    expect((await git.readYaml<Change>(dir, 'changes/NC-0001.yaml'))?.analysis).toBeUndefined()
    expect((await s.analysis(dir, 'NC-0001')).rows).toEqual([])
  })

  it('lignes calculées par défaut non écrites', async () => {
    await writeReq('SW-1', 'Logiciel')
    const s = svc()
    await s.create(dir, { objectTypeRef: 'root::nc', title: 'A' })
    const u = await s.update(dir, 'NC-0001', { impacted: [
      { id: 'SYS-1', status: 'impact_non_verifie', source: 'computed' },
      { id: 'SW-1', status: 'impact_a_tester', source: 'computed' },
    ] })
    expect(u.impacted.map(i => i.id)).toEqual(['SW-1'])
  })

  it('change sur l\'existant : bornes tag / SHA, éléments changés « modified », snapshot à `to`', async () => {
    await writeReq('SW-1', 'Logiciel')
    await writeReq('SYS-1', 'Système')
    sh('init', '-q'); sh('add', '-A'); sh('commit', '-q', '-m', 'v1'); sh('tag', 'v1.0')
    await writeReq('SW-1', 'Logiciel modifié')
    await git.writeYaml(dir, 'tests/TEST-1.yaml', { id: 'TEST-1', title: 'T1', status: 'draft', objectTypeRef: 'root::test', fields: {}, steps: [] })
    await git.writeYaml(dir, 'links/links.yaml', { links: [link('SW-1', 'SYS-1')] })
    sh('add', '-A'); sh('commit', '-q', '-m', 'v2')
    const head = sh('rev-parse', '--short', 'HEAD')
    // Modification non commitée : invisible pour un change sur l'existant (snapshot à `to`).
    await git.writeYaml(dir, 'links/links.yaml', { links: [] })

    const s = svc()
    const c = await s.create(dir, { objectTypeRef: 'root::nc', title: 'R', mode: 'range', range: { from: 'v1.0', to: head } })
    expect(c.mode).toBe('range')
    expect(c.range?.from.ref).toBe('v1.0')
    expect(c.toModify).toEqual([{ id: 'SW-1', state: 'modified' }, { id: 'TEST-1', state: 'modified' }])
    const a = await s.analysis(dir, c.id)
    expect(a.snapshot).toEqual({ kind: 'ref', sha: c.range!.to.sha })
    expect(a.rows.map(r => r.id)).toEqual(['SYS-1'])

    await expect(s.create(dir, { objectTypeRef: 'root::nc', title: 'R', mode: 'range', range: { from: 'v9', to: head } })).rejects.toThrow(/Borne introuvable/)
  })
})
