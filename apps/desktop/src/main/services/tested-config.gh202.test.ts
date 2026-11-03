import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, TestCampaign, TestRun, WorkspaceTree } from '@polenta/types'
import { CHANGES_HISTORY_KEY, applyChangesHistory, currentChangesAt, testedChoiceFromConfig, testedDeviations } from '@polenta/types'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import type { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import type { AuthService } from './auth.service'
import type { ExecuteTestCaseDto } from '@polenta/zod-schemas'
import { TestedConfigService, TestedVersionError } from './tested-config.service'
import type { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH202 — version testée d'une exécution (specs/GH202-tests.md).

const VERSION_STATUSES = [
  { name: 'en_cours', label: 'En cours' },
  { name: 'released', label: 'Released', isApproval: true },
  { name: 'abandonnee', label: 'Abandonnée', isTerminal: true },
]
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses: category === 'version' ? VERSION_STATUSES : [{ name: 'draft', label: 'Brouillon' }] })
const schemaOf = (p: string): ProjectSchema => ({
  version: 1, linkTypes: [],
  nodes: [{ name: 'root', label: p, objectTypes: [type('exigence', `${p}R`, 'requirement'), type('version', `${p}V`, 'version')] }],
} as unknown as ProjectSchema)

const auth = { getAuthor: async () => ({ name: 'Alice', email: 'a@x' }), getHttpsCredentials: async () => null } as unknown as AuthService
let ws: string, root: string, comp: string, sub: string
let gitSvc: GitService
let versions: VersionsService
let service: TestedConfigService
let clock: number
const runsByTest = new Map<string, TestRun[]>()
const campaignsById = new Map<string, TestCampaign>()

async function commitAll(dir: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message: 'c', author: { name: 'Alice', email: 'a@x', timestamp: 1_790_000_000, timezoneOffset: 0 } })
}
const req = (dir: string, id: string) => gitSvc.writeYaml(dir, `requirements/${id}.yaml`, { id, objectTypeRef: 'root::exigence', title: id, status: 'draft', version: 1, fields: {} })
const readVersion = (dir: string, id: string) => versions.get(dir, id)

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh202-'))
  root = path.join(ws, 'produit')
  comp = path.join(ws, 'moteur')
  sub = path.join(ws, 'bms')
  gitSvc = new GitService()
  const schemas = new Map<string, ProjectSchema>()
  for (const [dir, p] of [[root, 'P'], [comp, 'M'], [sub, 'B']] as const) {
    await fsP.mkdir(dir, { recursive: true })
    await git.init({ fs, dir, defaultBranch: 'main' })
    schemas.set(path.resolve(dir), schemaOf(p))
    await gitSvc.writeYaml(dir, '.polenta/schema.yaml', schemaOf(p))
    await commitAll(dir)
  }
  const node = (name: string, repoPath: string, children: WorkspaceTree['nodes'] = []) =>
    ({ name, label: name, repoPath, url: '', pin: '', isInterface: false, children })
  const subNode = node('bms', sub)
  const compNode = node('moteur', comp, [subNode])
  const tree = { logicalTree: node('produit', root, [compNode]), nodes: [compNode, subNode] } as unknown as WorkspaceTree
  const schemaStub = { get: async (dir: string) => schemas.get(path.resolve(dir)) } as unknown as Pick<SchemaService, 'get'>
  clock = Date.UTC(2026, 10, 1, 8, 0, 0)
  const history = new HistoryService(gitSvc, async () => ({ by: 'alice' }), () => new Date(clock))
  versions = new VersionsService(
    gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub as SchemaService), history,
    { readCache: async () => tree } as unknown as WorkspaceTreeService,
  )
  runsByTest.clear()
  campaignsById.clear()
  service = new TestedConfigService(
    versions, new SyncService(auth),
    { findRuns: async (_r: string, id: string) => runsByTest.get(id) ?? [] },
    { get: async (_r: string, id: string) => campaignsById.get(id)! },
  )
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

/** Avance l'horloge de l'historique d'une minute. */
const tick = () => { clock += 60_000 }

async function product() {
  const b = await versions.create(sub, { title: '0.9' }, ws)
  const m = await versions.create(comp, { title: '1.2', components: { bms: b.id } }, ws)
  const p = await versions.create(root, { title: '1.0', components: { moteur: m.id } }, ws)
  return { p, m, b }
}

describe('GH202 — historique de la liste des changements', () => {
  it('une entrée par écriture qui change la liste, liste triée, sans les base', async () => {
    await req(root, 'PR-0002')
    await req(root, 'PR-0001')
    const v = await versions.create(root, { title: '1.0' }, ws)
    expect(v.history?.[CHANGES_HISTORY_KEY]).toEqual([{ value: [], at: '2026-11-01T08:00:00Z', by: 'alice' }])
    tick()
    await versions.include(root, v.id, ['PR-0002', 'PR-0001'], ws)
    tick()
    await versions.removeChanges(root, v.id, ['PR-0002'], ws)
    const list = (await readVersion(root, v.id)).history![CHANGES_HISTORY_KEY]
    expect(list.map(e => e.value)).toEqual([[], ['PR-0001', 'PR-0002'], ['PR-0001']])
    expect(list.every(e => e.by === 'alice')).toBe(true)
  })

  it('deux écritures dans la même seconde ne font qu\'une entrée', async () => {
    await req(root, 'PR-0001')
    await req(root, 'PR-0002')
    const v = await versions.create(root, { title: '1.0' }, ws)
    tick()
    await versions.include(root, v.id, ['PR-0001'], ws)
    await versions.include(root, v.id, ['PR-0002'], ws)
    const list = (await readVersion(root, v.id)).history![CHANGES_HISTORY_KEY]
    expect(list.map(e => e.value)).toEqual([[], ['PR-0001', 'PR-0002']])
  })

  it('une écriture sans changement de la liste n\'ajoute rien ; une copie repart de sa propre liste', async () => {
    await req(root, 'PR-0001')
    const v = await versions.create(root, { title: '1.0' }, ws)
    tick()
    await versions.include(root, v.id, ['PR-0001'], ws)
    tick()
    await versions.update(root, v.id, { title: '1.0-b' }, ws)
    expect((await readVersion(root, v.id)).history![CHANGES_HISTORY_KEY]).toHaveLength(2)
    const copy = await versions.copy(root, v.id, ws)
    expect(copy.history![CHANGES_HISTORY_KEY].map(e => e.value)).toEqual([['PR-0001']])
  })

  it('une liste modifiée à la main : pas de changesAt, rattrapée à la prochaine écriture', () => {
    const edited = {
      changes: [{ id: 'A' }, { id: 'B' }],
      history: { [CHANGES_HISTORY_KEY]: [{ value: ['A'], at: '2026-11-01T08:00:00Z', by: 'x' }] },
    }
    expect(currentChangesAt(edited)).toBeUndefined()
    const fixed = applyChangesHistory(edited, { by: 'y' }, new Date('2026-11-02T08:00:00Z'))
    expect(fixed.history[CHANGES_HISTORY_KEY].map(e => e.value)).toEqual([['A'], ['A', 'B']])
    expect(currentChangesAt(fixed)).toBe('2026-11-02T08:00:00Z')
  })
})

describe('GH202 — copie de la structure testée', () => {
  it('version, label, état, commit, changesAt, composants récursifs ; aucun écart ; version intacte', async () => {
    const { p, m, b } = await product()
    const before = await fsP.readFile(path.join(root, 'versions', `${p.id}.yaml`), 'utf8')
    const config = await service.resolve(root, { version: p.id }, ws, { required: true })
    expect(config).toMatchObject({
      component: 'produit', ref: p.id, label: '1.0', state: 'in_progress', changesAt: '2026-11-01T08:00:00Z',
      components: { moteur: { ref: m.id, label: '1.2', components: { bms: { ref: b.id, label: '0.9' } } } },
    })
    expect(config!.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(config!.components!.moteur.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(testedDeviations(config!)).toEqual([])
    expect(await fsP.readFile(path.join(root, 'versions', `${p.id}.yaml`), 'utf8')).toBe(before)
  })

  it('accepte le label, comme le classeur', async () => {
    const { p } = await product()
    expect((await service.resolve(root, { version: '1.0' }, ws, { required: true }))?.ref).toBe(p.id)
  })

  it('écarts : autre version → expected ; texte libre → undocumented, en tête ; composition vide → expected null', async () => {
    const { p, m, b } = await product()
    const other = await versions.create(comp, { title: '1.3' }, ws)
    const config = await service.resolve(root, { version: p.id, components: { moteur: other.id, 'moteur/bms': 'proto' } }, ws, { required: true })
    expect(config!.components!.moteur).toMatchObject({ ref: other.id, expected: m.id })
    // La version retenue ne prévoit pas de bms.
    expect(config!.components!.moteur.components!.bms).toEqual({ undocumented: 'proto', expected: null })
    expect(testedDeviations(config!).map(d => d.path)).toEqual(['moteur/bms', 'moteur'])
    expect(b.id).toBeTruthy()
  })

  it('un écart imbriqué reste dans la copie sous un parent sans version ou en texte libre', async () => {
    const { p, m } = await product()
    const empty = await versions.create(root, { title: '2.0' }, ws)
    const b2 = await versions.create(sub, { title: '0.8' }, ws)
    const noParent = await service.resolve(root, { version: empty.id, components: { 'moteur/bms': b2.id } }, ws, { required: true })
    expect(noParent!.components!.moteur.components!.bms).toMatchObject({ ref: b2.id, expected: null })
    const freeParent = await service.resolve(root, { version: p.id, components: { moteur: 'proto', 'moteur/bms': b2.id } }, ws, { required: true })
    expect(freeParent!.components!.moteur).toMatchObject({ undocumented: 'proto', expected: m.id })
    expect(freeParent!.components!.moteur.components!.bms).toMatchObject({ ref: b2.id, expected: null })
    expect(testedDeviations(freeParent!).map(d => d.path)).toEqual(['moteur', 'moteur/bms'])
  })

  it('une valeur égale à la composition n\'est pas un écart', async () => {
    const { p, m } = await product()
    const config = await service.resolve(root, { version: p.id, components: { moteur: m.id } }, ws, { required: true })
    expect(config!.components!.moteur.expected).toBeUndefined()
  })

  it('texte libre à la racine : sans ref, écart non documenté', async () => {
    await product()
    const config = await service.resolve(root, { version: 'proto du 12/10' }, ws, { required: true })
    expect(config).toMatchObject({ component: 'produit', undocumented: 'proto du 12/10' })
    expect(config!.ref).toBeUndefined()
    expect(testedDeviations(config!).map(d => d.path)).toEqual([''])
  })

  it('une version abandonnée n\'est pas résolue : sa saisie reste un texte libre', async () => {
    const { p } = await product()
    await versions.update(root, p.id, { status: 'abandonnee' }, ws)
    const config = await service.resolve(root, { version: p.id }, ws, { required: false })
    expect(config).toMatchObject({ undocumented: p.id })
  })

  it('obligatoire si une version est sélectionnable, sinon pas de copie', async () => {
    expect(await service.resolve(root, undefined, ws, { required: true })).toBeUndefined()
    const { p } = await product()
    await expect(service.resolve(root, { version: '  ' }, ws, { required: true })).rejects.toBeInstanceOf(TestedVersionError)
    expect(await service.resolve(root, undefined, ws, { required: false })).toBeUndefined()
    await versions.update(root, p.id, { status: 'abandonnee' }, ws)
    expect(await service.resolve(root, undefined, ws, { required: true })).toBeUndefined()
  })

  it('options : arbre récursif, version abandonnée présente mais non sélectionnable', async () => {
    const { p } = await product()
    await versions.update(root, p.id, { status: 'abandonnee' }, ws)
    const options = await service.options(root, ws)
    expect(options.name).toBe('produit')
    expect(options.versions[0]).toMatchObject({ id: p.id, state: 'abandoned' })
    expect(options.dependencies[0].name).toBe('moteur')
    expect(options.dependencies[0].dependencies[0].name).toBe('bms')
  })
})

describe('GH202 — évolution depuis l\'exécution', () => {
  it('changements ajoutés et retirés, avec date et auteur ; rien sans évolution', async () => {
    await req(root, 'PR-0001')
    await req(root, 'PR-0002')
    const { p } = await product()
    await versions.include(root, p.id, ['PR-0001'], ws)
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    expect((await service.drift(root, config, ws)).items).toEqual([])
    tick()
    await versions.include(root, p.id, ['PR-0002'], ws)
    tick()
    await versions.removeChanges(root, p.id, ['PR-0001'], ws)
    const { repoPath, items } = await service.drift(root, config, ws)
    expect(repoPath).toBe(root)
    expect(items).toEqual([
      { kind: 'change_added', path: '', ref: p.id, id: 'PR-0002', at: '2026-11-01T08:01:00Z', by: 'alice' },
      { kind: 'change_removed', path: '', ref: p.id, id: 'PR-0001', at: '2026-11-01T08:02:00Z', by: 'alice' },
    ])
  })

  it('composant passé à une autre version ; un composant en écart se compare à expected', async () => {
    const { p, m } = await product()
    const other = await versions.create(comp, { title: '1.3' }, ws)
    const onExpected = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    const deviated = (await service.resolve(root, { version: p.id, components: { moteur: other.id } }, ws, { required: true }))!
    // Composition inchangée : un écart à l'exécution n'est pas une évolution.
    expect((await service.drift(root, deviated, ws)).items.filter(i => i.kind === 'component_changed' && i.path === 'moteur')).toEqual([])
    await versions.update(root, p.id, { components: { moteur: other.id } }, ws)
    expect((await service.drift(root, onExpected, ws)).items).toContainEqual({ kind: 'component_changed', path: 'moteur', from: m.id, to: other.id })
    expect((await service.drift(root, deviated, ws)).items).toContainEqual({ kind: 'component_changed', path: 'moteur', from: m.id, to: other.id })
  })

  it('version supprimée ou abandonnée', async () => {
    const { p, m } = await product()
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    await versions.update(comp, m.id, { status: 'abandonnee' }, ws)
    expect((await service.drift(root, config, ws)).items).toContainEqual({ kind: 'version_abandoned', path: 'moteur', ref: m.id })
    await versions.delete(root, p.id, ws)
    expect((await service.drift(root, config, ws)).items).toEqual([{ kind: 'version_missing', path: '', ref: p.id }])
  })

  it('déjà abandonnée à l\'exécution, ou composant hors de l\'arbre : pas d\'évolution', async () => {
    const { p, m } = await product()
    await versions.update(comp, m.id, { status: 'abandonnee' }, ws)
    await versions.update(root, p.id, { components: { moteur: m.id, retire: 'XV-0001' } }, ws)
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    expect(config.components!.moteur.state).toBe('abandoned')
    expect((await service.drift(root, config, ws)).items).toEqual([])
  })

  it('version d\'un composant : repo retrouvé par son nom', async () => {
    const { m } = await product()
    const config = (await service.resolve(comp, { version: m.id }, ws, { required: true }))!
    expect(config.component).toBe('moteur')
    expect((await service.drift(root, config, ws)).repoPath).toBe(comp)
  })
})

describe('GH202 — pré-remplissage', () => {
  const entry = (testCaseId: string, runId?: string, executedAt?: string) => ({
    entryId: `${testCaseId}-1`, testCaseId, status: runId ? 'PASS' : 'pending', ...(runId && { runId, executedAt }),
  })
  const campaign = (runs: unknown[]) => {
    campaignsById.set('C1', { id: 'C1', title: 'C', status: 'in_progress', fields: {}, testCaseIds: [], createdAt: '', runs } as unknown as TestCampaign)
  }
  const run = (id: string, testCaseId: string, config?: TestRun['testedConfig']) =>
    ({ id, testCaseId, result: 'PASS', executedAt: '', executedBy: '', duration: 0, equipmentUsed: [], stepResults: [], notes: '', ...(config && { testedConfig: config }) }) as TestRun

  it('première exécution : rien à reprendre', async () => {
    await product()
    campaign([entry('T1')])
    expect((await service.context(root, 'C1', ws)).prefill).toBeNull()
  })

  it('reprend version et écarts de la dernière exécution', async () => {
    const { p } = await product()
    const other = await versions.create(comp, { title: '1.3' }, ws)
    const older = (await service.resolve(root, { version: other.id ? p.id : '' }, ws, { required: true }))!
    const newer = (await service.resolve(root, { version: p.id, components: { moteur: other.id, 'moteur/bms': 'proto' } }, ws, { required: true }))!
    runsByTest.set('T1', [run('R1', 'T1', older)])
    runsByTest.set('T2', [run('R2', 'T2', newer)])
    campaign([entry('T1', 'R1', '2026-11-01T08:00:00Z'), entry('T2', 'R2', '2026-11-02T08:00:00Z'), entry('T3')])
    expect((await service.context(root, 'C1', ws)).prefill).toEqual({ version: p.id, components: { 'moteur/bms': 'proto', moteur: other.id } })
  })

  it('version abandonnée ou supprimée : pas de reprise', async () => {
    const { p } = await product()
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    runsByTest.set('T1', [run('R1', 'T1', config)])
    campaign([entry('T1', 'R1', '2026-11-01T08:00:00Z')])
    await versions.update(root, p.id, { status: 'abandonnee' }, ws)
    expect((await service.context(root, 'C1', ws)).prefill).toBeNull()
    expect(testedChoiceFromConfig({ component: 'x', ref: 'ABSENTE' }, { name: 'x', label: 'x', versions: [], dependencies: [] })).toBeNull()
  })

  it('run d\'un test de composant : lu dans le repo du composant', async () => {
    const { p } = await product()
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    const findRuns = async (repo: string, id: string) => (repo === comp ? runsByTest.get(id) ?? [] : [])
    const scoped = new TestedConfigService(versions, new SyncService(auth), { findRuns }, { get: async () => campaignsById.get('C1')! })
    runsByTest.set('MT', [run('R1', 'MT', config)])
    campaign([entry('MT', 'R1', '2026-11-01T08:00:00Z')])
    expect((await scoped.context(root, 'C1', ws)).prefill).toEqual({ version: p.id })
  })

  it('un run antérieur sans copie est ignoré', async () => {
    const { p } = await product()
    const config = (await service.resolve(root, { version: p.id }, ws, { required: true }))!
    runsByTest.set('T1', [run('R1', 'T1')])
    runsByTest.set('T2', [run('R2', 'T2', config)])
    campaign([entry('T1', 'R1', '2026-11-03T08:00:00Z'), entry('T2', 'R2', '2026-11-02T08:00:00Z')])
    expect((await service.context(root, 'C1', ws)).prefill).toEqual({ version: p.id })
  })
})

describe('GH202 — écriture du run', () => {
  const execute = (dto: Partial<ExecuteTestCaseDto>) => {
    const tests = new TestsService(
      gitSvc,
      { findById: async () => ({ id: 'MT-0001', objectTypeRef: 'moteur::test' }), upsertRun: () => undefined } as unknown as TestsIndexService,
      { resolveComponentRepoPath: async () => comp } as unknown as SchemaService,
    )
    tests.setTestedConfig(service)
    return tests.execute(root, 'MT-0001', { stepResults: [], result: 'PASS', ...dto }, ws)
  }
  const entry = { campaignId: 'C1', entryId: 'MT-0001-1' }

  it('test de composant depuis une campagne produit : version produit, run dans le repo du composant', async () => {
    const { p } = await product()
    const run = await execute({ campaignEntry: entry, testedVersion: { version: p.id } })
    expect(run.testedConfig).toMatchObject({ component: 'produit', ref: p.id })
    const stored = await gitSvc.readYaml<TestRun>(comp, `test-runs/MT-0001/${run.id}.yaml`)
    expect(stored?.testedConfig?.ref).toBe(p.id)
    expect(await gitSvc.readYaml(root, `test-runs/MT-0001/${run.id}.yaml`)).toBeNull()
  })

  it('refus sans saisie, rien d\'écrit ; pas de contrôle à l\'import ni pour une exécution isolée', async () => {
    await product()
    await expect(execute({ campaignEntry: entry })).rejects.toBeInstanceOf(TestedVersionError)
    expect(await gitSvc.listFiles(comp, 'test-runs/MT-0001').catch(() => [])).toEqual([])
    expect((await execute({ campaignEntry: entry, origin: 'excel-import' })).testedConfig).toBeUndefined()
    expect((await execute({})).testedConfig).toBeUndefined()
  })
})
