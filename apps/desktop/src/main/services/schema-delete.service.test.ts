import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObjectLink, ProjectSchema, SchemaDeleteTarget } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import { nextCounterId } from './id-counter.util'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { SchemaDeleteService } from './schema-delete.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { TreeService } from './tree.service'

// GH104 — scénarios D2–D10 de specs/GH104-tests.md : workspace à deux repos, `prod` (racine :
// type produit, composant local A avec sous-composant B) et `comp` (lien et ref vers A).

const OLD = '2026-09-01T00:00:00Z'
const base = { projectId: '', branchId: '', title: 'X', version: 1, jiraLinks: [] }
const statuses = [{ name: 'draft' }]
const type = (name: string, category: string) => ({ name, prefix: name, category, fields: [], statuses })

const NODE_A: SchemaDeleteTarget = { kind: 'node', nodeName: 'A' }

let ws: string
let prod: string
let comp: string
let git: GitService
let service: SchemaDeleteService
let readonlyRepos: Set<string>
let schemaApi: { get(repo: string): Promise<ProjectSchema>; save(repo: string, s: ProjectSchema): Promise<void> }

const read = <T>(repo: string, file: string) => git.readYaml<T>(repo, file) as Promise<T>
const exists = (repo: string, file: string) => fsP.access(path.join(repo, file)).then(() => true, () => false)
const linkIds = async (repo: string) => ((await read<{ links: ObjectLink[] }>(repo, 'links/links.yaml')).links).map(l => l.id)

async function snapshotAll(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (root: string, rel: string): Promise<void> => {
    for (const e of await fsP.readdir(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(root, child)
      else out[`${path.basename(root)}/${child}`] = await fsP.readFile(path.join(root, child), 'utf-8')
    }
  }
  await walk(prod, '')
  await walk(comp, '')
  return out
}

const link = (id: string, sourceId: string, targetId: string, t = 'implements') =>
  ({ id, type: t, sourceId, targetId, createdAt: OLD, createdBy: 'u' })
const req = (repo: string, id: string, ref: string) =>
  git.writeYaml(repo, `requirements/${id}.yaml`, { ...base, id, objectTypeRef: ref, status: 'draft', fields: {} })

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh104-'))
  prod = path.join(ws, 'prod')
  comp = path.join(ws, 'comp')
  git = new GitService()
  readonlyRepos = new Set()
  const history = new HistoryService(git, async () => ({ by: 'lolive' }))
  const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const tree = new TreeService()
  const requirements = new RequirementsService(git, reqIndex, schemaStub, tree, undefined, history)
  const tests = new TestsService(git, testsIndex, schemaStub, tree, undefined, history)
  const campaigns = new CampaignsService(git, tests, undefined, undefined, history)
  const schema = schemaApi = {
    get: async (repo: string) => {
      const s = await git.readYaml<ProjectSchema>(repo, '.polenta/schema.yaml')
      if (!s) throw new Error(`pas de schéma : ${repo}`)
      return s
    },
    save: async (repo: string, s: ProjectSchema) => git.writeYaml(repo, '.polenta/schema.yaml', s),
  }
  service = new SchemaDeleteService(
    git, { requirements, tests, campaigns }, reqIndex, tree, schema, [reqIndex, testsIndex],
    async () => [prod, comp], async () => readonlyRepos,
  )

  // prod — root (PRODUCT_REQ), composant A (A_REQ, A_TEST, A_CAMP) et son sous-composant B (B_REQ).
  await git.writeYaml(prod, '.polenta/schema.yaml', {
    version: 1,
    nodes: [
      { name: 'root', label: 'P', objectTypes: [type('PRODUCT_REQ', 'requirement')] },
      { name: 'A', label: 'A', objectTypes: [type('A_REQ', 'requirement'), type('A_TEST', 'test'), type('A_CAMP', 'campaign')],
        children: [{ name: 'B', label: 'B', objectTypes: [type('B_REQ', 'requirement')] }] },
    ],
    linkTypes: [
      { name: 'implements', sourceRefs: ['A::A_REQ', 'B::B_REQ'], targetRefs: ['root::PRODUCT_REQ'] },
      { name: 'verifies', sourceRefs: ['A::A_TEST'], targetRefs: ['A::A_REQ'] },
    ],
  })
  for (const n of ['0001', '0002', '0003']) await req(prod, `PRODUCT_REQ-${n}`, 'root::PRODUCT_REQ')
  await req(prod, 'A_REQ-0001', 'A::A_REQ')
  await req(prod, 'A_REQ-0002', 'A::A_REQ')
  await req(prod, 'B_REQ-0001', 'B::B_REQ')
  await git.writeYaml(prod, 'tests/A_TEST-0001.yaml', { ...base, id: 'A_TEST-0001', objectTypeRef: 'A::A_TEST', status: 'draft', fields: {}, steps: [] })
  await git.writeYaml(prod, 'test-runs/A_TEST-0001/A_TEST-0001-run-0001.yaml', { id: 'A_TEST-0001-run-0001', testCaseId: 'A_TEST-0001', status: 'PASS' })
  await git.writeYaml(prod, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', objectTypeRef: 'A::A_CAMP', status: 'planned', testCaseIds: ['A_TEST-0001'], createdAt: OLD, fields: {}, runs: [],
  })
  await git.writeYaml(prod, 'links/links.yaml', { links: [
    link('l1', 'A_REQ-0001', 'PRODUCT_REQ-0001'),
    link('l2', 'A_REQ-0002', 'PRODUCT_REQ-0002'),
    link('l3', 'A_TEST-0001', 'PRODUCT_REQ-0003', 'verifies'),
    link('l4', 'B_REQ-0001', 'PRODUCT_REQ-0001'),
    link('l5', 'PRODUCT_REQ-0001', 'PRODUCT_REQ-0002', 'refines'),
  ] })
  for (const [node, t] of [['A', 'A_REQ'], ['A', 'A_TEST'], ['B', 'B_REQ']]) {
    await git.writeYaml(prod, `.polenta/trees/${node}/${t}.yaml`, { nodeId: node, typeId: t, root: [] })
  }
  await git.writeYaml(prod, '.polenta/trees/root/PRODUCT_REQ.yaml', { nodeId: 'root', typeId: 'PRODUCT_REQ', root: [] })
  await git.writeYaml(prod, 'impact-acks/A_REQ-0001/ack-1.yaml', { id: 'ack-1' })

  // comp — composant en repo séparé : un lien vers A_REQ-0002, une ref A::A_REQ dans ses linkTypes.
  await git.writeYaml(comp, '.polenta/schema.yaml', {
    version: 1,
    nodes: [{ name: 'root', label: 'C', objectTypes: [type('COMP_REQ', 'requirement')] }],
    linkTypes: [{ name: 'derives', sourceRefs: ['root::COMP_REQ'], targetRefs: ['A::A_REQ', 'root::COMP_REQ'] }],
  })
  await req(comp, 'COMP_REQ-0001', 'root::COMP_REQ')
  await git.writeYaml(comp, 'links/links.yaml', { links: [link('c1', 'COMP_REQ-0001', 'A_REQ-0002', 'derives')] })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('SchemaDeleteService', () => {
  it('D2 — plan d\'un composant : sous-arbre, objets, liens, types de lien, sans écriture', async () => {
    const before = await snapshotAll()
    const plan = await service.plan(prod, ws, NODE_A)
    expect(plan.errors).toEqual([])
    expect(plan.nodes).toEqual(['A', 'B'])
    expect(plan.types).toEqual(['A::A_REQ', 'A::A_TEST', 'A::A_CAMP', 'B::B_REQ'])
    expect(plan.objects).toEqual({ requirement: ['A_REQ-0001', 'A_REQ-0002', 'B_REQ-0001'], test: ['A_TEST-0001'], campaign: ['CAMP-0001'] })
    expect(plan.links).toEqual([{ repoPath: prod, count: 4 }, { repoPath: comp, count: 1 }])
    expect(plan.linkTypes).toEqual([
      { repoPath: prod, name: 'implements', emptied: true },
      { repoPath: prod, name: 'verifies', emptied: true },
      { repoPath: comp, name: 'derives', emptied: false },
    ])
    expect(await snapshotAll()).toEqual(before)
  })

  it('D3 — suppression d\'un composant et de son sous-composant dans tout le workspace', async () => {
    const result = await service.delete(prod, ws, NODE_A)
    expect(result.failed).toEqual([])
    expect(result.deleted.sort()).toEqual(['A_REQ-0001', 'A_REQ-0002', 'A_TEST-0001', 'B_REQ-0001', 'CAMP-0001'])
    expect(result.links).toBe(5)
    for (const f of ['requirements/A_REQ-0001.yaml', 'requirements/A_REQ-0002.yaml', 'requirements/B_REQ-0001.yaml',
      'tests/A_TEST-0001.yaml', 'campaigns/CAMP-0001.yaml', 'test-runs/A_TEST-0001', 'impact-acks/A_REQ-0001',
      '.polenta/trees/A', '.polenta/trees/B']) {
      expect(await exists(prod, f), f).toBe(false)
    }
    for (const id of result.deleted) expect(await exists(prod, `.polenta/tombstones/${id}`), id).toBe(true)
    expect(await exists(prod, '.polenta/trees/root/PRODUCT_REQ.yaml')).toBe(true)
    expect(await exists(prod, 'requirements/PRODUCT_REQ-0001.yaml')).toBe(true)
    expect(await linkIds(prod)).toEqual(['l5'])
    expect(await linkIds(comp)).toEqual([])

    const s = await read<ProjectSchema>(prod, '.polenta/schema.yaml')
    expect(s.nodes.map(n => n.name)).toEqual(['root'])
    expect(s.linkTypes).toEqual([
      { name: 'implements', sourceRefs: [], targetRefs: ['root::PRODUCT_REQ'] },
      { name: 'verifies', sourceRefs: [], targetRefs: [] },
    ])
    const c = await read<ProjectSchema>(comp, '.polenta/schema.yaml')
    expect(c.linkTypes?.[0].targetRefs).toEqual(['root::COMP_REQ'])
  })

  it('D4 — type seul : ses tests, runs, liens, arbre et ref ; le reste du composant intact', async () => {
    const target: SchemaDeleteTarget = { kind: 'type', nodeName: 'A', typeName: 'A_TEST' }
    const plan = await service.plan(prod, ws, target)
    expect(plan.nodes).toEqual([])
    expect(plan.objects).toEqual({ requirement: [], test: ['A_TEST-0001'], campaign: [] })
    const result = await service.delete(prod, ws, target)
    expect(result.failed).toEqual([])
    expect(await exists(prod, 'tests/A_TEST-0001.yaml')).toBe(false)
    expect(await exists(prod, 'test-runs/A_TEST-0001')).toBe(false)
    expect(await exists(prod, '.polenta/trees/A/A_TEST.yaml')).toBe(false)
    expect(await exists(prod, '.polenta/trees/A/A_REQ.yaml')).toBe(true)
    expect(await exists(prod, 'requirements/A_REQ-0001.yaml')).toBe(true)
    expect(await exists(prod, 'campaigns/CAMP-0001.yaml')).toBe(true)
    expect(await linkIds(prod)).toEqual(['l1', 'l2', 'l4', 'l5'])
    const s = await read<ProjectSchema>(prod, '.polenta/schema.yaml')
    const a = s.nodes.find(n => n.name === 'A')!
    expect(a.objectTypes?.map(t => t.name)).toEqual(['A_REQ', 'A_CAMP'])
    expect(a.children?.map(n => n.name)).toEqual(['B'])
    expect(s.linkTypes?.find(l => l.name === 'verifies')).toEqual({ name: 'verifies', sourceRefs: [], targetRefs: ['A::A_REQ'] })
  })

  it('D5 — une ref déclarée aussi par un autre repo y est conservée', async () => {
    const c = await read<ProjectSchema>(comp, '.polenta/schema.yaml')
    await git.writeYaml(comp, '.polenta/schema.yaml', {
      ...c, nodes: [...c.nodes, { name: 'A', label: 'A homonyme', objectTypes: [type('A_REQ', 'requirement')] }],
    })
    const plan = await service.plan(prod, ws, NODE_A)
    expect(plan.linkTypes.filter(l => l.repoPath === comp)).toEqual([])
    await service.delete(prod, ws, NODE_A)
    expect((await read<ProjectSchema>(comp, '.polenta/schema.yaml')).linkTypes?.[0].targetRefs).toEqual(['A::A_REQ', 'root::COMP_REQ'])
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).linkTypes?.[1].targetRefs).toEqual([])
  })

  it('D6 — repo du workspace absent : refus, aucune écriture', async () => {
    await fsP.rm(comp, { recursive: true, force: true })
    const walkProd = async () => (await fsP.readdir(prod, { recursive: true })).sort()
    const files = await walkProd()
    const plan = await service.plan(prod, ws, NODE_A)
    expect(plan.errors.map(e => e.code)).toEqual(['REPO_MISSING'])
    await expect(service.delete(prod, ws, NODE_A)).rejects.toThrow(/introuvable/)
    expect(await walkProd()).toEqual(files)
  })

  it('D7 — nœud ou repo en lecture seule : refus, aucune écriture', async () => {
    const before = await snapshotAll()
    const s = await read<ProjectSchema>(prod, '.polenta/schema.yaml')
    await git.writeYaml(prod, '.polenta/schema.yaml', { ...s, nodes: s.nodes.map(n => (n.name === 'A' ? { ...n, readonly: true } : n)) })
    const sub = await service.plan(prod, ws, { kind: 'type', nodeName: 'B', typeName: 'B_REQ' })
    expect(sub.errors.map(e => e.code)).toEqual(['READONLY']) // ancêtre en lecture seule
    await expect(service.delete(prod, ws, NODE_A)).rejects.toThrow(/lecture seule/)
    // Sous-composant en lecture seule : supprimer son parent le supprimerait aussi.
    await git.writeYaml(prod, '.polenta/schema.yaml', { ...s, nodes: s.nodes.map(n => (n.name === 'A'
      ? { ...n, children: n.children?.map(c => ({ ...c, readonly: true })) } : n)) })
    await expect(service.delete(prod, ws, NODE_A)).rejects.toThrow(/B est en lecture seule/)
    await git.writeYaml(prod, '.polenta/schema.yaml', s)
    readonlyRepos = new Set([prod])
    expect((await service.plan(prod, ws, NODE_A)).errors.map(e => e.code)).toEqual(['READONLY'])
    await expect(service.delete(prod, ws, NODE_A)).rejects.toThrow(/lecture seule/)
    expect(await snapshotAll()).toEqual(before)
  })

  it('D8 — cible introuvable (renommée entre l\'aperçu et la suppression), et root refusé', async () => {
    const before = await snapshotAll()
    await expect(service.delete(prod, ws, { kind: 'type', nodeName: 'A', typeName: 'A_OLD' })).rejects.toThrow(/introuvable/)
    await expect(service.delete(prod, ws, { kind: 'node', nodeName: 'Z' })).rejects.toThrow(/introuvable/)
    await expect(service.delete(prod, ws, { kind: 'node', nodeName: 'root' })).rejects.toThrow(/composant local/)
    expect(await snapshotAll()).toEqual(before)
  })

  it('D9 — échec partiel : listé, schéma intact, relance qui termine', async () => {
    const original = git.deleteFile.bind(git)
    const spy = vi.spyOn(git, 'deleteFile').mockImplementation(async (repo, rel) => {
      if (rel === 'requirements/A_REQ-0002.yaml') throw new Error('EBUSY')
      return original(repo, rel)
    })
    const first = await service.delete(prod, ws, NODE_A)
    expect(first.failed).toEqual([{ id: 'A_REQ-0002', error: 'EBUSY' }])
    expect(await exists(prod, 'requirements/A_REQ-0001.yaml')).toBe(false)
    expect(await exists(prod, 'requirements/A_REQ-0002.yaml')).toBe(true)
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).nodes.map(n => n.name)).toEqual(['root', 'A'])
    // Liens de l'objet resté sur disque conservés ; arbres non touchés (il reste affiché).
    expect(await linkIds(prod)).toEqual(['l2', 'l5'])
    expect(await linkIds(comp)).toEqual(['c1'])
    expect(await exists(prod, '.polenta/trees/A/A_REQ.yaml')).toBe(true)

    spy.mockRestore()
    const second = await service.delete(prod, ws, NODE_A)
    expect(second.failed).toEqual([])
    expect(second.deleted).toEqual(['A_REQ-0002'])
    expect(second.links).toBe(2)
    expect(await exists(prod, 'requirements/A_REQ-0002.yaml')).toBe(false)
    expect(await exists(prod, '.polenta/trees/A')).toBe(false)
    expect(await linkIds(prod)).toEqual(['l5'])
    expect(await linkIds(comp)).toEqual([])
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).nodes.map(n => n.name)).toEqual(['root'])
  })

  it('D9b — fichier déjà absent : compté supprimé, la suppression va au bout', async () => {
    const plan = await service.plan(prod, ws, NODE_A)
    expect(plan.objects.requirement).toContain('A_REQ-0001')
    await fsP.rm(path.join(prod, 'requirements/A_REQ-0001.yaml'))
    // L'index en mémoire voit encore A_REQ-0001 : le plan refait par `delete` le cite.
    const result = await service.delete(prod, ws, NODE_A)
    expect(result.failed).toEqual([])
    expect(result.deleted).toContain('A_REQ-0001')
    expect(await exists(prod, '.polenta/tombstones/A_REQ-0001')).toBe(true)
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).nodes.map(n => n.name)).toEqual(['root'])
  })

  it('D9c — échec du schéma du repo : les types de lien des autres repos ne sont pas réécrits', async () => {
    const save = vi.spyOn(schemaApi, 'save').mockImplementation(async (repo, s) => {
      if (repo === prod) throw new Error('EPERM')
      return git.writeYaml(repo, '.polenta/schema.yaml', s)
    })
    const result = await service.delete(prod, ws, NODE_A)
    expect(result.failed).toEqual([{ id: `${prod}:.polenta/schema.yaml`, error: 'EPERM' }])
    expect(save).toHaveBeenCalledTimes(1)
    expect((await read<ProjectSchema>(comp, '.polenta/schema.yaml')).linkTypes?.[0].targetRefs).toEqual(['A::A_REQ', 'root::COMP_REQ'])
  })

  it('D10 — pierres tombales : un type recréé avec le même préfixe repart au-delà des IDs supprimés', async () => {
    await service.delete(prod, ws, NODE_A)
    expect(await nextCounterId(git, prod, 'A_REQ', 'requirements')).toBe('A_REQ-0003')
  })
})
