import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectLink, ObjectTypeDefinition, ProjectSchema, TestCampaign, WorkspaceTree } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import type { AuthService } from './auth.service'
import { TraceabilityService } from './traceability.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH245 sprint 1 — analyse d'impact et tests à exécuter d'une version (specs/GH245-tests.md).

const STATUSES = [
  { name: 'draft', label: 'Brouillon' },
  { name: 'approved', label: 'Approuvé', isApproval: true },
]
const VERSION_STATUSES = [
  { name: 'en_cours', label: 'En cours' },
  { name: 'released', label: 'Released', isApproval: true },
  { name: 'abandonnee', label: 'Abandonnée', isTerminal: true },
]
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses: category === 'version' ? VERSION_STATUSES : STATUSES })
const schemaOf = (p: string): ProjectSchema => ({
  version: 1, linkTypes: [],
  nodes: [{ name: 'root', label: p, objectTypes: [type('exigence', `${p}R`, 'requirement'), type('test', `${p}T`, 'test'), type('version', `${p}V`, 'version')] }],
} as unknown as ProjectSchema)

const auth = { getAuthor: async () => ({ name: 'Alice', email: 'a@x' }), getHttpsCredentials: async () => null } as unknown as AuthService
let ws: string, root: string, comp: string
let gitSvc: GitService
let versions: VersionsService
let tick = 0
const T0 = Date.UTC(2026, 10, 1) / 1000

async function commitAll(dir: string, message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const req = (dir: string, id: string) => gitSvc.writeYaml(dir, `requirements/${id}.yaml`, { id, objectTypeRef: 'root::exigence', title: `Titre ${id}`, status: 'draft', version: 1, fields: {} })
const test = (dir: string, id: string) => gitSvc.writeYaml(dir, `tests/${id}.yaml`, { id, objectTypeRef: 'root::test', title: `Test ${id}`, status: 'draft', version: 1, fields: {}, steps: [] })
/** `source` raffine / couvre `target` (exigence ↔ exigence : source = enfant). */
const links = (dir: string, pairs: Array<[string, string, string?]>) => gitSvc.writeYaml(dir, 'links/links.yaml', {
  links: pairs.map(([sourceId, targetId, type], i) => ({ id: `L${i}`, type: type ?? 'refines', sourceId, targetId }) as ObjectLink),
})
const campaign = (dir: string, id: string, status: TestCampaign['status'], testIds: string[]) => gitSvc.writeYaml(dir, `campaigns/${id}.yaml`, {
  id, title: id, status, createdAt: '2026-11-01T00:00:00Z', fields: {}, testCaseIds: testIds,
  runs: testIds.map(t => ({ testCaseId: t, status: 'pending', entryId: `${t}-1` })),
})

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh245-'))
  root = path.join(ws, 'produit')
  comp = path.join(ws, 'moteur')
  gitSvc = new GitService()
  const schemas = new Map<string, ProjectSchema>()
  for (const [dir, p] of [[root, 'P'], [comp, 'M']] as const) {
    await fsP.mkdir(dir, { recursive: true })
    await git.init({ fs, dir, defaultBranch: 'main' })
    schemas.set(path.resolve(dir), schemaOf(p))
    await gitSvc.writeYaml(dir, '.polenta/schema.yaml', schemaOf(p))
    await commitAll(dir, 'schéma')
  }
  const node = (name: string, repoPath: string, children: WorkspaceTree['nodes'] = []) =>
    ({ name, label: name, repoPath, url: '', pin: '', isInterface: false, children })
  const moteur = node('moteur', comp)
  const produit = node('produit', root, [moteur])
  const tree: WorkspaceTree = { rootRepoHeadSha: '', generatedAt: '', nodes: [produit, moteur], logicalTree: produit }
  const schemaStub = { get: async (repo: string) => schemas.get(path.resolve(repo))! } as unknown as SchemaService
  const treeStub = { readCache: async () => tree } as unknown as WorkspaceTreeService
  versions = new VersionsService(gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
  versions.setImpactSources({
    traceability: new TraceabilityService({} as RequirementsIndexService, {} as TestsIndexService, gitSvc, new SyncService(auth), treeStub),
    campaigns: new CampaignsService(gitSvc, undefined as never),
  })
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('analyse d\'impact', () => {
  it('A1/A2/A4 — lignes du repo seulement, sources (chemin), une ligne pour deux racines', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003', 'PR-0004']) await req(root, id)
    await req(comp, 'MR-0001')
    // PR-0002 raffine PR-0001 ; PR-0003 raffine PR-0002 et PR-0004 ; MR-0001 (autre repo) raffine PR-0001.
    await links(root, [['PR-0002', 'PR-0001'], ['PR-0003', 'PR-0002'], ['PR-0003', 'PR-0004']])
    await links(comp, [['MR-0001', 'PR-0001']])
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, ['PR-0001', 'PR-0004'], ws)
    const a = await versions.analysis(root, v.id, ws)
    expect(a.frozen).toBe(false)
    expect(a.roots.map(r => `${r.elementId}/${r.component}`)).toEqual(['PR-0001/produit', 'PR-0004/produit'])
    expect(a.rows.map(r => r.id)).toEqual(['PR-0002', 'PR-0003'])   // MR-0001 : autre repo
    const pr3 = a.rows.find(r => r.id === 'PR-0003')!
    expect(pr3.sources.map(s => `${s.rootId}:${s.path.map(p => p.id).join('>')}`)).toEqual(['PR-0001:PR-0002>PR-0003', 'PR-0004:PR-0003'])
    expect(pr3.sources[0].path[0].linkType).toBe('refines')
    expect(pr3.status).toBe('impact_non_verifie')
  })

  it('A3 — changement d\'une version de composant postérieure à basedOn : racine, impacts dans le produit', async () => {
    await req(root, 'PR-0001')
    await req(comp, 'MR-0001')
    await links(root, [['PR-0001', 'MR-0001']])   // l'exigence produit raffine l'exigence moteur
    await commitAll(root, 'p')
    await commitAll(comp, 'm')
    const m = await versions.create(comp, { title: 'm1' }, ws)
    await versions.include(comp, m.id, ['MR-0001'], ws)
    const p = await versions.create(root, { title: '1.0', components: { moteur: m.id } }, ws)
    const a = await versions.analysis(root, p.id, ws)
    expect(a.roots.map(r => `${r.elementId}/${r.component}`)).toEqual(['MR-0001/moteur'])
    expect(a.rows.map(r => r.id)).toEqual(['PR-0001'])
  })

  it('A5/A6/A7 — statut saisi, plus atteint, figée au passage released', async () => {
    await req(root, 'PR-0001')
    await req(root, 'PR-0002')
    await links(root, [['PR-0002', 'PR-0001']])
    await commitAll(root, 'p')
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, ['PR-0001'], ws)
    await versions.setImpact(root, v.id, 'PR-0002', 'impact_a_tester', '  à vérifier  ', ws)
    expect((await versions.get(root, v.id)).impacted).toEqual([{ id: 'PR-0002', status: 'impact_a_tester', comment: 'à vérifier' }])
    const live = await versions.analysis(root, v.id, ws)
    expect(live.rows[0]).toMatchObject({ id: 'PR-0002', status: 'impact_a_tester', reached: true })
    // Arbre : statut reporté sur le nœud.
    expect(live.roots[0].descendantTree[0]).toMatchObject({ elementId: 'PR-0002', status: 'impact_a_tester' })
    // Statut par défaut sans commentaire : entrée retirée.
    await versions.setImpact(root, v.id, 'PR-0002', 'impact_non_verifie', null, ws)
    expect((await versions.get(root, v.id)).impacted).toBeUndefined()
    await versions.setImpact(root, v.id, 'PR-0002', 'pas_d_impact_reel', null, ws)
    await links(root, [])
    expect((await versions.analysis(root, v.id, ws)).rows).toEqual([
      expect.objectContaining({ id: 'PR-0002', status: 'pas_d_impact_reel', reached: false }),
    ])
    await links(root, [['PR-0002', 'PR-0001']])
    await commitAll(root, 'liens')
    const released = await versions.release(root, v.id, 'produit-1.0', ws)
    expect(released.analysis).toMatchObject({ frozen: true, rows: [{ id: 'PR-0002', status: 'pas_d_impact_reel' }] })
    // Figée sans les arbres (volumineux, chemins locaux).
    expect(released.analysis!.roots).toEqual([expect.objectContaining({ elementId: 'PR-0001', descendantTree: [], ascendantTree: [] })])
    const head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
    expect(await gitSvc.readTextAt(root, head, `versions/${v.id}.yaml`)).toContain('analysis:')
    // Figée : un lien retiré ensuite ne change rien à l'analyse de la version released.
    await links(root, [])
    expect((await versions.analysis(root, v.id, ws)).rows[0]).toMatchObject({ id: 'PR-0002', reached: true })
    const code = await versions.setImpact(root, v.id, 'PR-0002', 'impact_teste', null, ws).then(() => 'ok', (e: Error) => e.message.split(':')[0])
    expect(code).toBe('NOT_IN_PROGRESS')
  })
})

describe('tests à exécuter', () => {
  it('T1/T2/T3/T4 — racines et impacts, instances, non couvertes, campagnes ouvertes', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003']) await req(root, id)
    for (const id of ['PT-0001', 'PT-0002', 'PT-0003']) await test(root, id)
    // PR-0002 et PR-0003 raffinent PR-0001 ; PT-0001 couvre PR-0001 (lien créé depuis l'exigence),
    // PT-0002 couvre PR-0002, PT-0003 couvre PR-0003 ; PR-0001 sans autre test.
    await links(root, [
      ['PR-0002', 'PR-0001'], ['PR-0003', 'PR-0001'],
      ['PR-0001', 'PT-0001', 'verification'], ['PT-0002', 'PR-0002', 'verification'], ['PT-0003', 'PR-0003', 'verification'],
    ])
    await campaign(root, 'PC-0001', 'in_progress', ['PT-0002'])
    await campaign(root, 'PC-0002', 'completed', ['PT-0001'])
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, ['PR-0001'], ws)
    await versions.setImpact(root, v.id, 'PR-0003', 'pas_d_impact_reel', null, ws)
    const r = await versions.testsToRun(root, v.id, ws)
    // Les tests atteints sont aussi des lignes (sources) ; PT-0003 n'est pas marqué lui-même : proposé
    // en entier (GH207 §10bis), bien que l'exigence qui l'amène soit écartée.
    expect(r.tests.map(t => `${t.testId}[${t.requirementIds}]<${t.sources}>`)).toEqual([
      'PT-0001[PR-0001]<PR-0001,PT-0001>', 'PT-0002[PR-0002]<PR-0002,PT-0002>', 'PT-0003[]<PT-0003>',
    ])
    expect(r.tests.find(t => t.testId === 'PT-0002')!.alreadyIn).toEqual([{ id: 'PC-0001', title: 'PC-0001' }])
    expect(r.tests.find(t => t.testId === 'PT-0001')!.alreadyIn).toEqual([])   // seulement dans une campagne close
    expect(r.uncovered).toEqual([])
    await req(root, 'PR-0009')
    await versions.include(root, v.id, ['PR-0009'], ws)
    expect((await versions.testsToRun(root, v.id, ws)).uncovered).toEqual(['PR-0009'])
    // « Déjà dans » par instance : une entrée de PT-0002 pour une autre exigence ne compte pas.
    await gitSvc.writeYaml(root, 'campaigns/PC-0001.yaml', {
      id: 'PC-0001', title: 'PC-0001', status: 'in_progress', createdAt: '2026-11-01T00:00:00Z', fields: {}, testCaseIds: ['PT-0002'],
      runs: [{ testCaseId: 'PT-0002', requirementId: 'PR-0001', status: 'pending', entryId: 'PT-0002-1' }],
    })
    expect((await versions.testsToRun(root, v.id, ws)).tests.find(t => t.testId === 'PT-0002')!.alreadyIn).toEqual([])
  })

  it('T2/T5 — test marqué pas d\'impact jamais proposé ; version abandonnée refusée', async () => {
    await req(root, 'PR-0001')
    await test(root, 'PT-0001')
    await links(root, [['PT-0001', 'PR-0001', 'verification']])
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, ['PR-0001'], ws)
    await versions.setImpact(root, v.id, 'PT-0001', 'pas_d_impact_reel', null, ws)
    expect((await versions.testsToRun(root, v.id, ws)).tests).toEqual([])
    // Le test devient lui-même un changement : proposé malgré le statut resté attaché.
    await versions.include(root, v.id, ['PT-0001'], ws)
    expect((await versions.testsToRun(root, v.id, ws)).tests.map(t => t.testId)).toEqual(['PT-0001'])
    await versions.update(root, v.id, { status: 'abandonnee' }, ws)
    const code = await versions.testsToRun(root, v.id, ws).then(() => 'ok', (e: Error) => e.message.split(':')[0])
    expect(code).toBe('VERSION_ABANDONED')
  })
})
