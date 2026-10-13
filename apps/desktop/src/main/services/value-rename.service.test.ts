import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCampaign, ValueRename } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { FieldRenameService } from './field-rename.service'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH82 — migration des statuts / valeurs d'enum renommés et aperçu (scénarios M1–M5 de
// specs/GH82-tests.md). Le schéma est celui *après* renommage (l'éditeur l'enregistre d'abord).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', objectTypes: [
      {
        name: 'exigence', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'prio', type: 'enum', values: ['high', 'basse'], trackHistory: true }],
        statuses: [{ name: 'draft' }, { name: 'en-revue' }, { name: 'approved', isApproval: true }],
      },
      { name: 'test', prefix: 'TEST', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'valide', isApproval: true }] },
      { name: 'campagne', prefix: 'CAMP', category: 'campaign', fields: [{ name: 'lot', type: 'enum', values: ['l2'] }] },
    ],
  }],
  linkTypes: [],
}

const OLD = '2026-09-01T00:00:00Z'
let dir: string
let git: GitService
let reqIndex: RequirementsIndexService
let service: FieldRenameService

const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>
const base = { projectId: '', branchId: '', title: 'X', version: 3, jiraLinks: [] }
const status = (from: string, to: string): ValueRename => ({ target: { kind: 'status' }, from, to })

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh82-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  reqIndex = new RequirementsIndexService(git)
  const history = new HistoryService(git, async () => ({ by: 'lolive' }))
  const requirements = new RequirementsService(git, reqIndex, schemaStub, undefined, undefined, history)
  const tests = new TestsService(git, new TestsIndexService(git), schemaStub, undefined, undefined, history)
  service = new FieldRenameService(requirements, tests, new CampaignsService(git, tests, undefined, undefined, history))

  await git.writeYaml(dir, 'requirements/SYS-0001.yaml', {
    ...base, id: 'SYS-0001', objectTypeRef: 'root::exigence', status: 'review', fields: { prio: 'haute' },
    history: { status: [{ value: 'draft', at: OLD }, { value: 'review', at: OLD }], prio: [{ value: 'haute', at: OLD }] },
  })
  await git.writeYaml(dir, 'requirements/SYS-0002.yaml', {
    ...base, id: 'SYS-0002', objectTypeRef: 'root::exigence', status: 'en-revue', fields: { prio: 'basse' },
  })
  const snapshot = (st: string) => ({ id: 'TEST-0001', objectTypeRef: 'root::test', title: 'T', status: st, fields: {}, steps: [] })
  await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', objectTypeRef: 'root::campagne', status: 'planned', testCaseIds: ['TEST-0001', 'TEST-0001'],
    createdAt: OLD, fields: { lot: 'l1' },
    runs: [
      { entryId: 'TEST-0001-1', testCaseId: 'TEST-0001', status: 'pending', testSnapshot: snapshot('approuve') },
      { entryId: 'TEST-0001-2', testCaseId: 'TEST-0001', status: 'PASS', testSnapshot: snapshot('draft') },
    ],
  })
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('FieldRenameService.renameValues', () => {
  it('M1 — statut : exigences migrées, historique réécrit, aucune entrée ajoutée, version et flag inchangés', async () => {
    const result = await service.renameValues(dir, 'root::exigence', [status('review', 'en-revue')])
    expect(result.migrated).toEqual(['SYS-0001'])
    const req = await onDisk<Requirement>('requirements/SYS-0001.yaml')
    expect(req.status).toBe('en-revue')
    expect(req.history?.status).toEqual([{ value: 'draft', at: OLD }, { value: 'en-revue', at: OLD }])
    expect(req.version).toBe(3)
    expect(req.needsRevalidation).toBeUndefined()
  })

  it('M1b — valeur d\'enum : champ et historique', async () => {
    await service.renameValues(dir, 'root::exigence', [{ target: { kind: 'field', field: 'prio', multi: false }, from: 'haute', to: 'high' }])
    const req = await onDisk<Requirement>('requirements/SYS-0001.yaml')
    expect(req.fields.prio).toBe('high')
    expect(req.history?.prio).toEqual([{ value: 'high', at: OLD }])
    expect((await onDisk<Requirement>('requirements/SYS-0002.yaml')).fields.prio).toBe('basse')
  })

  it('M2 — statut d\'approbation d\'un type de test : copies testSnapshot migrées et comptées', async () => {
    const result = await service.renameValues(dir, 'root::test', [status('approuve', 'valide')])
    expect(result.snapshots).toBe(1)
    expect(result.migrated).toEqual(['CAMP-0001'])
    const camp = await onDisk<TestCampaign>('campaigns/CAMP-0001.yaml')
    expect(camp.runs.map(r => r.testSnapshot?.status)).toEqual(['valide', 'draft'])
    expect(camp.history).toBeUndefined()
  })

  it('M3 — valeur d\'enum d\'un type de campagne', async () => {
    await service.renameValues(dir, 'root::campagne', [{ target: { kind: 'field', field: 'lot', multi: false }, from: 'l1', to: 'l2' }])
    expect((await onDisk<TestCampaign>('campaigns/CAMP-0001.yaml')).fields.lot).toBe('l2')
  })

  it('M5 — un fichier en échec n\'empêche pas les autres', async () => {
    await git.writeYaml(dir, 'requirements/SYS-0003.yaml', { ...base, id: 'SYS-0003', objectTypeRef: 'root::exigence', status: 'review', fields: {} })
    await reqIndex.findAll(dir, {})
    await fsP.rm(path.join(dir, 'requirements/SYS-0001.yaml'))
    await fsP.mkdir(path.join(dir, 'requirements/SYS-0001.yaml'))
    const result = await service.renameValues(dir, 'root::exigence', [status('review', 'en-revue')])
    expect(result.failed.map(f => f.id)).toEqual(['SYS-0001'])
    expect(result.migrated).toEqual(['SYS-0003'])
  })
})

describe('FieldRenameService.previewValueRenames — échange', () => {
  it('échange de statuts : pas de fausse collision', async () => {
    const swap = [status('review', 'en-revue'), status('en-revue', 'review')]
    const previews = await service.previewValueRenames(dir, 'root::exigence', swap)
    expect(previews.map(p => [p.withOld, p.withNew])).toEqual([[1, 0], [1, 0]])
  })
})

describe('FieldRenameService.previewValueRenames', () => {
  it('M4 — comptes ancien / nouveau, rien n\'est écrit', async () => {
    const before = await fsP.readFile(path.join(dir, 'requirements/SYS-0001.yaml'), 'utf-8')
    const [preview] = await service.previewValueRenames(dir, 'root::exigence', [status('review', 'en-revue')])
    expect(preview).toMatchObject({ withOld: 1, withNew: 1 })
    expect(await fsP.readFile(path.join(dir, 'requirements/SYS-0001.yaml'), 'utf-8')).toBe(before)
  })
})
