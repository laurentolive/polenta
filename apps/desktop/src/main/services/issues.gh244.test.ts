import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectLink, ObjectTypeDefinition, ProjectSchema, SchemaStatus, WorkspaceTree } from '@polenta/types'
import type { AuthService } from './auth.service'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { DiffEditService } from './diff-edit.service'
import { ElementMoveService } from './element-move.service'
import { HistoryService, readEffectiveHistory } from './history.service'
import { TypeRenameService } from './type-rename.service'
import { IssuesService } from './issues.service'
import { RequirementsIndexService } from './requirements-index.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import { TestsIndexService } from './tests-index.service'
import { TraceabilityService } from './traceability.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import { WorkspaceLinksService } from './workspace-links.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

const STATUSES: SchemaStatus[] = [
  { name: 'draft', label: 'Brouillon' },
  { name: 'approved', label: 'Approuvé', isApproval: true },
]
const VERSION_STATUSES: SchemaStatus[] = [
  { name: 'en_cours', label: 'En cours' },
  { name: 'released', label: 'Released', isApproval: true },
  { name: 'abandonnee', label: 'Abandonnée', isTerminal: true },
]
const ISSUE_STATUSES: SchemaStatus[] = [
  { name: 'ouverte', label: 'Ouverte' },
  { name: 'corrigee', label: 'Corrigée' },
  { name: 'validee', label: 'Validée', isApproval: true },
  { name: 'rejetee', label: 'Rejetée', isTerminal: true },
]
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category'], statuses: SchemaStatus[]): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses })
const schemaOf = (p: string, linkTypes: unknown[] = []): ProjectSchema => ({
  version: 1,
  linkTypes,
  nodes: [{
    name: 'root', label: p,
    objectTypes: [
      type('exigence', `${p}R`, 'requirement', STATUSES), type('test', `${p}T`, 'test', STATUSES),
      type('version', `${p}V`, 'version', VERSION_STATUSES), type('bug', `${p}I`, 'issue', ISSUE_STATUSES),
    ],
  }],
} as unknown as ProjectSchema)
const IMPACT = { name: 'issue-impact', labelSourceToTarget: 'impacte', labelTargetToSource: 'est impactée par', sourceRefs: ['issue'], targetRefs: ['requirement'] }

const auth = { getAuthor: async () => ({ name: 'Alice', email: 'a@x' }), getHttpsCredentials: async () => null } as unknown as AuthService
let ws: string, root: string, comp: string
let gitSvc: GitService
let issues: IssuesService
let versions: VersionsService
let linksSvc: WorkspaceLinksService
let tick = 0
const T0 = Date.UTC(2026, 10, 1) / 1000

async function commitAll(dir: string, message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const req = (dir: string, id: string, ref = 'root::exigence') => gitSvc.writeYaml(dir, `requirements/${id}.yaml`, { id, objectTypeRef: ref, title: `Titre ${id}`, status: 'draft', version: 1, fields: {} })
const test = (dir: string, id: string) => gitSvc.writeYaml(dir, `tests/${id}.yaml`, { id, objectTypeRef: 'root::test', title: `Test ${id}`, status: 'draft', version: 1, fields: {}, steps: [] })
const links = (dir: string, pairs: Array<[string, string, string]>) => gitSvc.writeYaml(dir, 'links/links.yaml', {
  links: pairs.map(([sourceId, targetId, t], i) => ({ id: `L${i}`, type: t, sourceId, targetId }) as ObjectLink),
})
const backlogIds = async (dir: string) => (await versions.backlog(dir)).map(i => `${i.id}:${i.kind}`)
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])
const newIssue = (title = 'Coupure') => issues.create(root, { objectTypeRef: 'root::bug', title, fields: {} }, ws)

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh244-'))
  root = path.join(ws, 'produit')
  comp = path.join(ws, 'moteur')
  gitSvc = new GitService()
  const schemas = new Map<string, ProjectSchema>()
  for (const [dir, p] of [[root, 'P'], [comp, 'M']] as const) {
    await fsP.mkdir(dir, { recursive: true })
    await git.init({ fs, dir, defaultBranch: 'main' })
    const schema = schemaOf(p, [IMPACT, { name: 'refines', labelSourceToTarget: 'r', labelTargetToSource: 'r', sourceRefs: ['requirement'], targetRefs: ['requirement'] }, { name: 'verification', labelSourceToTarget: 'v', labelTargetToSource: 'v', sourceRefs: ['test'], targetRefs: ['requirement'] }])
    schemas.set(path.resolve(dir), schema)
    await gitSvc.writeYaml(dir, '.polenta/schema.yaml', schema)
    await commitAll(dir, 'schéma')
  }
  const node = (name: string, repoPath: string, children: WorkspaceTree['nodes'] = []) =>
    ({ name, label: name, repoPath, url: '', pin: '', isInterface: false, children })
  const moteur = node('moteur', comp)
  const produit = node('produit', root, [moteur])
  const tree: WorkspaceTree = { rootRepoHeadSha: '', generatedAt: '', nodes: [produit, moteur], logicalTree: produit }
  const schemaStub = {
    get: async (repo: string) => schemas.get(path.resolve(repo))!,
    resolveComponentRepoPath: async () => null,
  } as unknown as SchemaService
  const treeStub = { readCache: async () => tree } as unknown as WorkspaceTreeService
  const history = new HistoryService(gitSvc, async () => ({ by: 'alice' }))
  versions = new VersionsService(gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
  const reqIndex = new RequirementsIndexService(gitSvc)
  const testsIndex = new TestsIndexService(gitSvc)
  versions.setImpactSources({
    traceability: new TraceabilityService(reqIndex, testsIndex, gitSvc, new SyncService(auth), treeStub),
    campaigns: new CampaignsService(gitSvc, undefined as never),
  })
  issues = new IssuesService(gitSvc, schemaStub, history)
  linksSvc = new WorkspaceLinksService(reqIndex, testsIndex, schemaStub, gitSvc, treeStub, undefined, undefined, issues)
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('objet', () => {
  it('I1 — ID séquentiel, fichier, statut initial, historique du statut', async () => {
    const a = await newIssue()
    const b = await newIssue('Autre')
    expect([a.id, b.id]).toEqual(['PI-0001', 'PI-0002'])
    expect(a.status).toBe('ouverte')
    expect(a.history?.status?.[0]).toMatchObject({ value: 'ouverte', by: 'alice' })
    const onDisk = await gitSvc.readYaml<Record<string, unknown>>(root, 'issues/PI-0001.yaml')
    expect(onDisk).toMatchObject({ id: 'PI-0001', title: 'Coupure' })
    // GH340 — dates posées par l'application dans le YAML (annule T112).
    expect(onDisk).toMatchObject({ createdBy: 'alice', updatedBy: 'alice' })
    expect(onDisk?.createdAt).toBe(onDisk?.updatedAt)
  })

  it('I2 — modification libre, même sur un statut `isApproval` ; `version` inchangée', async () => {
    const a = await newIssue()
    await issues.update(root, a.id, { status: 'validee' }, ws)
    const b = await issues.update(root, a.id, { title: 'Nouveau', fields: { cause: 'froid' } }, ws)
    expect(b).toMatchObject({ title: 'Nouveau', status: 'validee', version: 1, fields: { cause: 'froid' } })
    const c = await issues.update(root, a.id, { status: 'ouverte' }, ws)
    expect(c.version).toBe(1)
    expect(await code(issues.update(root, a.id, { status: 'inconnu' }, ws))).toBe('Statut inconnu pour le type root')
  })

  it('I3 — exécution d\'origine ajoutée une seule fois', async () => {
    const a = await issues.create(root, { objectTypeRef: 'root::bug', title: 'x', fields: {}, origin: { runs: ['RUN-1'] } }, ws)
    await issues.addRun(root, a.id, 'RUN-2', ws)
    const b = await issues.addRun(root, a.id, 'RUN-2', ws)
    expect(b.origin?.runs).toEqual(['RUN-1', 'RUN-2'])
  })

  it('composant en lecture seule : écritures refusées, lecture permise', async () => {
    const a = await newIssue()
    const stub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
    const readonly = new IssuesService(gitSvc, stub, undefined, async () => true)
    expect((await readonly.findOne(root, a.id)).id).toBe(a.id)
    expect(await code(readonly.update(root, a.id, { title: 'x' }, ws))).toBe('READONLY_REPO')
    expect(await code(readonly.create(root, { objectTypeRef: 'root::bug', title: 'x', fields: {} }, ws))).toBe('READONLY_REPO')
  })
})

describe('historique, diff, déplacement et renommage', () => {
  const history = () => new HistoryService(gitSvc, async () => ({ by: 'alice' }))
  const typeRename = () => new TypeRenameService(
    {} as never, {} as never, { rewriteSnapshots: async () => undefined } as never,
    { moveTypeTree: async () => undefined, renameTypeTree: async () => undefined } as never,
    { get: async () => schemaOf('P', [IMPACT]), save: async () => undefined } as never,
    [issues], async () => [root], issues,
  )

  it('historique effectif d\'une issue', async () => {
    const a = await newIssue()
    await issues.update(root, a.id, { status: 'corrigee' }, ws)
    const h = await readEffectiveHistory({ history: history(), requirements: {} as never, tests: {} as never, campaigns: {} as never, issues }, root, 'issue', a.id)
    expect(h.status?.map(e => e.value)).toEqual(['ouverte', 'corrigee'])
  })

  it('diff : passe par le service ; statut inconnu et `origin` refusés', async () => {
    const a = await issues.create(root, { objectTypeRef: 'root::bug', title: 'x', fields: {}, origin: { runs: ['RUN-1'] } }, ws)
    const stub = { get: async () => schemaOf('P') } as unknown as SchemaService
    const diff = new DiffEditService({} as never, {} as never, stub, issues)
    const file = `issues/${a.id}.yaml`
    const save = async (patch: Record<string, unknown>) => {
      const before = await gitSvc.readYaml<Record<string, unknown>>(root, file)
      return diff.saveWorkingFile(root, file, yaml.dump({ ...before, ...patch }), await fsP.readFile(path.join(root, file), 'utf8'), ws)
    }
    expect(await save({ status: 'inconnu' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await save({ origin: { runs: [] } })).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(await save({ status: 'corrigee' })).toEqual({ ok: true })
    expect(await gitSvc.readYaml(root, file)).toMatchObject({ status: 'corrigee' })
  })

  it('déplacement d\'un type : les issues suivent', async () => {
    const a = await newIssue()
    const move = new ElementMoveService(
      { moveObjectType: async () => ({ schema: schemaOf('P'), oldRef: 'root::bug', newRef: 'sous::bug' }) } as never,
      { retargetObjectTypeRef: async () => ({ succeeded: [], failed: [] }) } as never,
      { findAll: async () => [] } as never,
      { moveTypeTree: async () => undefined } as never,
      issues,
    )
    const { failed } = await move.moveElementToNode(root, { fromNodeName: 'root', toNodeName: 'sous', typeName: 'bug' })
    expect(failed).toEqual([])
    expect((await issues.findOne(root, a.id)).objectTypeRef).toBe('sous::bug')
  })

  it('préfixe d\'un type issue : fichier, ID et liens renommés', async () => {
    const a = await newIssue()
    await req(root, 'PR-0001')
    await links(root, [[a.id, 'PR-0001', 'issue-impact']])
    const dto = { nodeName: 'root', category: 'issue' as const, oldName: 'bug', newName: 'bug', oldPrefix: 'PI', newPrefix: 'XI' }
    const plan = await typeRename().plan(root, ws, dto)
    expect(plan.objects).toEqual([{ oldId: a.id, newId: 'XI-0001' }])
    await typeRename().rename(root, ws, dto)
    issues.invalidate(root)
    expect((await issues.findAll(root)).map(i => i.id)).toEqual(['XI-0001'])
    expect((await gitSvc.readYaml<{ links: ObjectLink[] }>(root, 'links/links.yaml'))!.links[0].sourceId).toBe('XI-0001')
  })
})

describe('type de lien issue-impact', () => {
  const service = () => new SchemaService(auth, { readCache: async () => null } as unknown as WorkspaceTreeService)
  const noIssue = () => {
    const s = schemaOf('P')
    s.nodes[0].objectTypes = s.nodes[0].objectTypes!.filter(t => t.category !== 'issue')
    return s
  }
  const impactCount = async (svc: SchemaService) => (await svc.get(root)).linkTypes!.filter(l => l.name === 'issue-impact').length

  it('S1 — ajouté avec le premier type issue', async () => {
    const svc = service()
    await svc.save(root, noIssue())
    expect(await impactCount(svc)).toBe(0)
    await svc.save(root, schemaOf('P'))
    expect(await impactCount(svc)).toBe(1)
  })

  it('S2 — pas de doublon ; un retrait ultérieur n\'est pas annulé', async () => {
    const svc = service()
    await svc.save(root, noIssue())
    await svc.save(root, schemaOf('P', [IMPACT]))
    expect(await impactCount(svc)).toBe(1)
    await svc.save(root, schemaOf('P'))
    expect(await impactCount(svc)).toBe(0)
  })
})

describe('liens d\'impact', () => {
  const link = (sourceId: string, targetId: string) => linksSvc.plan(root, [{ type: 'issue-impact', sourceId, targetId }], ws)

  it('L1 — exigence du composant : acceptée', async () => {
    await req(root, 'PR-0001')
    const a = await newIssue()
    const { valid, errors } = await link(a.id, 'PR-0001')
    expect(errors).toEqual([])
    expect(valid).toHaveLength(1)
  })

  it('L2 — exigence d\'un autre repo, ou de type non déclaré : NOT_OWN_ELEMENT', async () => {
    await req(comp, 'MR-0001')
    await req(root, 'SW-0001', 'firmware::exigence')
    const a = await newIssue()
    expect((await link(a.id, 'MR-0001')).errors[0]?.code).toBe('NOT_OWN_ELEMENT')
    expect((await link(a.id, 'SW-0001')).errors[0]?.code).toBe('NOT_OWN_ELEMENT')
  })
})

describe('dans une version', () => {
  const release = async (id: string, tag: string) => {
    await versions.release(root, id, tag, ws)
  }

  it('V1/V2 — non terminale au backlog et incluable ; rejetée jamais incluse : absente', async () => {
    const a = await newIssue()
    const b = await newIssue('Rejetée')
    await issues.update(root, b.id, { status: 'rejetee' }, ws)
    expect(await backlogIds(root)).toEqual([`${a.id}:new`])
    const v = await versions.create(root, { title: '1.0' }, ws)
    const updated = await versions.include(root, v.id, [a.id], ws)
    expect(updated.changes).toEqual([{ id: a.id }])
    expect(await backlogIds(root)).toEqual([])
    const page = await versions.page(root, v.id, ws)
    expect(page.rows.find(r => r.id === a.id)).toMatchObject({ category: 'issue', filePath: `issues/${a.id}.yaml` })
  })

  it('V3 — incluse, released, puis modifiée : revient au backlog avec sa base', async () => {
    const a = await newIssue()
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, [a.id], ws)
    await commitAll(root, 'contenu')
    await release(v.id, 'p-1.0')
    expect(await backlogIds(root)).toEqual([])
    await issues.update(root, a.id, { status: 'corrigee' }, ws)
    const [item] = await versions.backlog(root)
    expect(item).toMatchObject({ id: a.id, kind: 'modified', category: 'issue' })
    expect(item.base?.version).toBe(1)
  })

  it('V4 — exigence impactée : racine, via l\'issue, ses tests proposés ; l\'issue n\'est pas racine', async () => {
    await req(root, 'PR-0001')
    await req(root, 'PR-0002')
    await test(root, 'PT-0001')
    const a = await newIssue()
    await links(root, [[a.id, 'PR-0001', 'issue-impact'], ['PR-0002', 'PR-0001', 'refines'], ['PT-0001', 'PR-0001', 'verification']])
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, [a.id], ws)
    const { analysis, tests } = await versions.impact(root, v.id, ws)
    expect(analysis.roots.map(r => r.elementId)).toEqual(['PR-0001'])
    expect(analysis.roots[0].viaIssues).toEqual([a.id])
    expect(analysis.rows.map(r => r.id)).toEqual(['PR-0002', 'PT-0001'])
    expect(tests?.tests.map(t => t.testId)).toEqual(['PT-0001'])
  })

  it('V5 — sans exigence impactée : ligne de changement, aucune racine, passage released accepté', async () => {
    const a = await newIssue()
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, [a.id], ws)
    expect((await versions.impact(root, v.id, ws)).analysis.roots).toEqual([])
    await commitAll(root, 'contenu')
    await release(v.id, 'p-1.0')
    expect((await versions.page(root, v.id, ws)).rows.map(r => r.id)).toEqual([a.id])
  })

  it('V6 — incluse non commitée : DIRTY_CHANGES', async () => {
    const a = await newIssue()
    const v = await versions.create(root, { title: '1.0' }, ws)
    await versions.include(root, v.id, [a.id], ws)
    expect(await code(versions.release(root, v.id, 'p-1.0', ws))).toBe('DIRTY_CHANGES')
  })

  it('V7 — statut `isApproval` modifié : jamais signalé hors interface', async () => {
    const a = await newIssue()
    await issues.update(root, a.id, { status: 'validee' }, ws)
    await commitAll(root, 'validée')
    await issues.update(root, a.id, { title: 'Modifiée' }, ws)
    expect((await versions.backlog(root)).find(i => i.id === a.id)?.outside).toBeUndefined()
  })
})
