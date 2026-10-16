import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectLink, ProjectSchema, Requirement, TestCampaign, TestCase, TypeRenameDto, TypeTree } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { TreeService } from './tree.service'
import { TypeRenameService } from './type-rename.service'

// GH100 — scénarios T4–T10 de specs/GH100-tests.md : workspace à deux repos, `prod` (racine : liens,
// campagne) et `comp` (types COMP_REQ / COMP_TEST, arbre d'affichage, exécutions).

const OLD = '2026-09-01T00:00:00Z'
const base = { projectId: '', branchId: '', title: 'X', version: 1, jiraLinks: [] }
const statuses = [{ name: 'draft' }]

const reqType = (name: string, prefix: string) => ({ name, prefix, category: 'requirement', fields: [], statuses })
const testType = (name: string, prefix: string) => ({ name, prefix, category: 'test', fields: [], statuses })
const schemaOf = (types: unknown[], linkTypes: unknown[] = []) =>
  ({ version: 1, nodes: [{ name: 'root', label: 'R', objectTypes: types }], linkTypes }) as unknown as ProjectSchema

let ws: string
let prod: string
let comp: string
let git: GitService
let service: TypeRenameService

const read = <T>(repo: string, file: string) => git.readYaml<T>(repo, file) as Promise<T>
const exists = (repo: string, file: string) => fsP.access(path.join(repo, file)).then(() => true, () => false)

/** Toutes les données des deux repos (chemin → contenu), pour vérifier qu'un refus n'écrit rien. */
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

/** L'éditeur enregistre le schéma avant la migration : on simule cet enregistrement dans `comp`. */
async function saveCompSchema(types: unknown[], linkTypes = [{ name: 'verifies', sourceRefs: ['root::COMP_TEST'], targetRefs: ['root::COMP_REQ'] }]) {
  await git.writeYaml(comp, '.polenta/schema.yaml', schemaOf(types, linkTypes))
}

const REQ_DTO: TypeRenameDto = {
  nodeName: 'root', category: 'requirement', oldName: 'COMP_REQ', newName: 'VE22D_REQ', oldPrefix: 'COMP_REQ', newPrefix: 'VE22D_REQ',
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh100-'))
  prod = path.join(ws, 'prod')
  comp = path.join(ws, 'comp')
  git = new GitService()
  const history = new HistoryService(git, async () => ({ by: 'lolive' }))
  const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const tree = new TreeService()
  const requirements = new RequirementsService(git, reqIndex, schemaStub, tree, undefined, history)
  const tests = new TestsService(git, testsIndex, schemaStub, tree, undefined, history)
  const campaigns = new CampaignsService(git, tests, undefined, undefined, history)
  const schema = {
    get: async (repo: string) => (await git.readYaml<ProjectSchema>(repo, '.polenta/schema.yaml'))!,
    save: async (repo: string, s: ProjectSchema) => git.writeYaml(repo, '.polenta/schema.yaml', s),
  }
  service = new TypeRenameService(requirements, tests, campaigns, tree, schema, [reqIndex, testsIndex], async () => [prod, comp])

  // prod — repo racine : type produit, lien vers COMP_REQ-0001, campagne d'un test de comp.
  await git.writeYaml(prod, '.polenta/schema.yaml', schemaOf([reqType('PRODUCT_REQ', 'PRODUCT_REQ')],
    [{ name: 'implements', sourceRefs: ['root::PRODUCT_REQ'], targetRefs: ['root::COMP_REQ'] }]))
  await git.writeYaml(prod, 'requirements/PRODUCT_REQ-0001.yaml', {
    ...base, id: 'PRODUCT_REQ-0001', objectTypeRef: 'root::PRODUCT_REQ', status: 'draft',
    fields: { description: 'Voir COMP_REQ-0001 et COMP_REQ-00011' },
  })
  await git.writeYaml(prod, 'links/links.yaml', { links: [
    { id: 'lnk_1', type: 'implements', sourceId: 'PRODUCT_REQ-0001', targetId: 'COMP_REQ-0001', needsRevalidation: false, createdAt: OLD, createdBy: 'u' },
  ] })
  const snapshot = { id: 'COMP_TEST-0001', objectTypeRef: 'root::COMP_TEST', title: 'T', status: 'draft', fields: {}, steps: [] }
  await git.writeYaml(prod, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', objectTypeRef: 'root::campagne', status: 'planned', testCaseIds: ['COMP_TEST-0001'], createdAt: OLD, fields: {},
    runs: [{ entryId: 'COMP_TEST-0001-1', testCaseId: 'COMP_TEST-0001', requirementId: 'COMP_REQ-0001', runId: 'COMP_TEST-0001-run-0001', status: 'PASS', testSnapshot: snapshot }],
  })

  // comp — composant : 2 exigences, 1 test et ses exécutions, arbre d'affichage avec un dossier.
  await saveCompSchema([reqType('COMP_REQ', 'COMP_REQ'), testType('COMP_TEST', 'COMP_TEST')])
  for (const n of ['0001', '0002']) {
    await git.writeYaml(comp, `requirements/COMP_REQ-${n}.yaml`, {
      ...base, id: `COMP_REQ-${n}`, objectTypeRef: 'root::COMP_REQ', status: 'draft', fields: {},
      history: { status: [{ value: 'draft', at: OLD, by: 'u' }] },
    })
  }
  await git.writeYaml(comp, 'tests/COMP_TEST-0001.yaml', {
    ...base, id: 'COMP_TEST-0001', objectTypeRef: 'root::COMP_TEST', status: 'draft', fields: {}, steps: [],
  })
  await git.writeYaml(comp, 'test-runs/COMP_TEST-0001/COMP_TEST-0001-run-0001.yaml', {
    id: 'COMP_TEST-0001-run-0001', testCaseId: 'COMP_TEST-0001', requirementId: 'COMP_REQ-0002', status: 'PASS',
  })
  await git.writeYaml(comp, '.polenta/trees/root/COMP_REQ.yaml', {
    nodeId: 'root', typeId: 'COMP_REQ', root: [
      { id: 'f1', kind: 'folder', name: 'Interface', children: [{ id: 'i1', kind: 'item', name: 'A', children: [], objectId: 'COMP_REQ-0002' }] },
      { id: 'i2', kind: 'item', name: 'B', children: [], objectId: 'COMP_REQ-0001' },
    ],
  })
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('TypeRenameService', () => {
  it('plan — aperçu sans écriture : objets, fichiers des autres repos, refs de liens', async () => {
    const before = await snapshotAll()
    const plan = await service.plan(comp, ws, REQ_DTO)
    expect(plan.errors).toEqual([])
    expect(plan.objects).toEqual([
      { oldId: 'COMP_REQ-0001', newId: 'VE22D_REQ-0001' }, { oldId: 'COMP_REQ-0002', newId: 'VE22D_REQ-0002' },
    ])
    expect(plan.retargeted).toBe(2)
    expect(plan.files.map(f => `${path.basename(f.repoPath)}/${f.path}`).sort()).toEqual([
      'comp/.polenta/trees/root/COMP_REQ.yaml', 'comp/test-runs/COMP_TEST-0001/COMP_TEST-0001-run-0001.yaml',
      'prod/campaigns/CAMP-0001.yaml', 'prod/links/links.yaml', 'prod/requirements/PRODUCT_REQ-0001.yaml',
    ])
    expect(plan.linkTypeRepos.sort()).toEqual([comp, prod].sort())
    expect(await snapshotAll()).toEqual(before)
  })

  it('T4 — nom + préfixe : fichiers, id, objectTypeRef, history, pierres tombales, arbre', async () => {
    await saveCompSchema([reqType('VE22D_REQ', 'VE22D_REQ'), testType('COMP_TEST', 'COMP_TEST')])
    const result = await service.rename(comp, ws, REQ_DTO)
    expect(result.failed).toEqual([])
    expect(result.migrated.sort()).toEqual(['VE22D_REQ-0001', 'VE22D_REQ-0002'])
    for (const n of ['0001', '0002']) {
      expect(await exists(comp, `requirements/COMP_REQ-${n}.yaml`)).toBe(false)
      const req = await read<Requirement>(comp, `requirements/VE22D_REQ-${n}.yaml`)
      expect(req.id).toBe(`VE22D_REQ-${n}`)
      expect(req.objectTypeRef).toBe('root::VE22D_REQ')
      expect(req.history).toEqual({ status: [{ value: 'draft', at: OLD, by: 'u' }] })
      expect(await exists(comp, `.polenta/tombstones/COMP_REQ-${n}`)).toBe(true)
    }
    expect(await exists(comp, '.polenta/trees/root/COMP_REQ.yaml')).toBe(false)
    const tree = await read<TypeTree>(comp, '.polenta/trees/root/VE22D_REQ.yaml')
    expect(tree.typeId).toBe('VE22D_REQ')
    expect(tree.root[0].name).toBe('Interface')
    expect(tree.root[0].children[0].objectId).toBe('VE22D_REQ-0002')
    expect(tree.root[1].objectId).toBe('VE22D_REQ-0001')
  })

  it('T5 — lien du repo racine, texte des champs et refs de linkTypes des deux repos', async () => {
    await saveCompSchema([reqType('VE22D_REQ', 'VE22D_REQ'), testType('COMP_TEST', 'COMP_TEST')])
    await service.rename(comp, ws, REQ_DTO)
    const links = (await read<{ links: ObjectLink[] }>(prod, 'links/links.yaml')).links
    expect(links[0].targetId).toBe('VE22D_REQ-0001')
    const text = (await read<Requirement>(prod, 'requirements/PRODUCT_REQ-0001.yaml')).fields.description
    expect(text).toBe('Voir VE22D_REQ-0001 et COMP_REQ-00011')
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).linkTypes[0].targetRefs).toEqual(['root::VE22D_REQ'])
    expect((await read<ProjectSchema>(comp, '.polenta/schema.yaml')).linkTypes[0].targetRefs).toEqual(['root::VE22D_REQ'])
    // Campagne : la ref d'exigence de l'entrée suit, l'exécution aussi.
    expect((await read<TestCampaign>(prod, 'campaigns/CAMP-0001.yaml')).runs[0].requirementId).toBe('VE22D_REQ-0001')
    expect((await read<{ requirementId: string }>(comp, 'test-runs/COMP_TEST-0001/COMP_TEST-0001-run-0001.yaml')).requirementId).toBe('VE22D_REQ-0002')
  })

  it('T6 — test renommé : campagne (ids, entryId, runId, snapshot), dossier et fichiers test-runs', async () => {
    await saveCompSchema([reqType('COMP_REQ', 'COMP_REQ'), testType('NEW_TEST', 'NEW_TEST')])
    const dto: TypeRenameDto = { nodeName: 'root', category: 'test', oldName: 'COMP_TEST', newName: 'NEW_TEST', oldPrefix: 'COMP_TEST', newPrefix: 'NEW_TEST' }
    const result = await service.rename(comp, ws, dto)
    expect(result.failed).toEqual([])
    const test = await read<TestCase>(comp, 'tests/NEW_TEST-0001.yaml')
    expect([test.id, test.objectTypeRef]).toEqual(['NEW_TEST-0001', 'root::NEW_TEST'])
    const camp = await read<TestCampaign>(prod, 'campaigns/CAMP-0001.yaml')
    expect(camp.testCaseIds).toEqual(['NEW_TEST-0001'])
    expect(camp.runs[0]).toMatchObject({ entryId: 'NEW_TEST-0001-1', testCaseId: 'NEW_TEST-0001', runId: 'NEW_TEST-0001-run-0001' })
    expect(camp.runs[0].testSnapshot).toMatchObject({ id: 'NEW_TEST-0001', objectTypeRef: 'root::NEW_TEST' })
    expect(await exists(comp, 'test-runs/COMP_TEST-0001')).toBe(false)
    const run = await read<{ id: string; testCaseId: string }>(comp, 'test-runs/NEW_TEST-0001/NEW_TEST-0001-run-0001.yaml')
    expect([run.id, run.testCaseId]).toEqual(['NEW_TEST-0001-run-0001', 'NEW_TEST-0001'])
    expect((await read<ProjectSchema>(comp, '.polenta/schema.yaml')).linkTypes[0].sourceRefs).toEqual(['root::NEW_TEST'])
  })

  it('T7 — nom seul : IDs et fichiers inchangés, objectTypeRef / arbre / refs migrés', async () => {
    await saveCompSchema([reqType('VE22D_REQ', 'COMP_REQ'), testType('COMP_TEST', 'COMP_TEST')])
    const dto = { ...REQ_DTO, newPrefix: 'COMP_REQ' }
    expect((await service.plan(comp, ws, dto)).objects).toEqual([])
    const result = await service.rename(comp, ws, dto)
    expect(result.migrated.sort()).toEqual(['COMP_REQ-0001', 'COMP_REQ-0002'])
    expect((await read<Requirement>(comp, 'requirements/COMP_REQ-0001.yaml')).objectTypeRef).toBe('root::VE22D_REQ')
    expect((await read<{ links: ObjectLink[] }>(prod, 'links/links.yaml')).links[0].targetId).toBe('COMP_REQ-0001')
    expect(await exists(comp, '.polenta/trees/root/VE22D_REQ.yaml')).toBe(true)
    expect(await exists(comp, '.polenta/tombstones/COMP_REQ-0001')).toBe(false)
    expect((await read<ProjectSchema>(prod, '.polenta/schema.yaml')).linkTypes[0].targetRefs).toEqual(['root::VE22D_REQ'])
  })

  it('T8 — collision (pierre tombale dans un autre repo) : refus, aucun fichier modifié', async () => {
    await fsP.mkdir(path.join(prod, '.polenta/tombstones'), { recursive: true })
    await fsP.writeFile(path.join(prod, '.polenta/tombstones/VE22D_REQ-0002'), '')
    const before = await snapshotAll()
    const plan = await service.plan(comp, ws, REQ_DTO)
    expect(plan.errors.map(e => e.code)).toEqual(['ID_COLLISION'])
    expect(plan.errors[0].detail).toContain('VE22D_REQ-0002')
    await expect(service.rename(comp, ws, REQ_DTO)).rejects.toThrow('VE22D_REQ-0002')
    expect(await snapshotAll()).toEqual(before)
  })

  it('T9 — un autre repo déclare aussi root::COMP_REQ : ses linkTypes et ses copies ne sont pas touchés', async () => {
    await git.writeYaml(prod, '.polenta/schema.yaml', schemaOf(
      [reqType('PRODUCT_REQ', 'PRODUCT_REQ'), reqType('COMP_REQ', 'P_COMP_REQ'), testType('COMP_TEST', 'P_TEST')],
      [{ name: 'implements', sourceRefs: ['root::PRODUCT_REQ'], targetRefs: ['root::COMP_REQ'] }]))
    // Copie d'un test homonyme de prod (même ref root::COMP_TEST, autre test).
    const camp = await read<TestCampaign>(prod, 'campaigns/CAMP-0001.yaml')
    const other = { ...camp.runs[0], entryId: 'P_TEST-0001-1', testCaseId: 'P_TEST-0001', runId: undefined,
      testSnapshot: { ...camp.runs[0].testSnapshot!, id: 'P_TEST-0001' } }
    await git.writeYaml(prod, 'campaigns/CAMP-0001.yaml', { ...camp, testCaseIds: [...camp.testCaseIds, 'P_TEST-0001'], runs: [...camp.runs, other] })

    expect((await service.plan(comp, ws, REQ_DTO)).linkTypeRepos).toEqual([comp])
    await saveCompSchema([reqType('COMP_REQ', 'COMP_REQ'), testType('NEW_TEST', 'COMP_TEST')])
    await service.rename(comp, ws, { nodeName: 'root', category: 'test', oldName: 'COMP_TEST', newName: 'NEW_TEST', oldPrefix: 'COMP_TEST', newPrefix: 'COMP_TEST' })
    const runs = (await read<TestCampaign>(prod, 'campaigns/CAMP-0001.yaml')).runs
    expect(runs.map(r => r.testSnapshot?.objectTypeRef)).toEqual(['root::NEW_TEST', 'root::COMP_TEST'])
  })

  it('T10 — repo absent : refus sans écriture ; type campagne : préfixe sans effet sur les IDs', async () => {
    const missing = new TypeRenameService(
      (service as unknown as { requirements: RequirementsService }).requirements,
      (service as unknown as { tests: TestsService }).tests,
      (service as unknown as { campaigns: CampaignsService }).campaigns,
      new TreeService(),
      { get: async () => schemaOf([]), save: async () => {} },
      [],
      async () => [prod, comp, path.join(ws, 'absent')],
    )
    const before = await snapshotAll()
    expect((await missing.plan(comp, ws, REQ_DTO)).errors.map(e => e.code)).toEqual(['REPO_MISSING'])
    await expect(missing.rename(comp, ws, REQ_DTO)).rejects.toThrow('absent')
    expect(await snapshotAll()).toEqual(before)

    const campDto: TypeRenameDto = { nodeName: 'root', category: 'campaign', oldName: 'campagne', newName: 'campagne', oldPrefix: 'CAMP', newPrefix: 'NEWC' }
    expect((await service.plan(prod, ws, campDto)).objects).toEqual([])
  })
})
