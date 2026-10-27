import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ProjectSchema, Requirement, TestCampaign, TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { FieldRenameService } from './field-rename.service'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { createMcpContainer } from '../../mcp-server/container'
import { registerSchemaMutationTools } from '../../mcp-server/tools/schema-mutation.tools'

// GH77 sprint 2 — migration des objets au renommage d'un champ (scénarios R1–R3, R7) et options
// d'historique des tools MCP de mutation du schéma (C5) de specs/GH77-tests.md.

/** Schéma *après* renommage `priority` → `criticite` (l'éditeur enregistre le schéma d'abord). */
const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'criticite', type: 'enum', values: ['high', 'low'], trackHistory: true }],
        statuses: [{ name: 'draft' }, { name: 'review' }],
      },
      { name: 'test', prefix: 'TEST', category: 'test', fields: [{ name: 'criticite', type: 'text', trackHistory: true }] },
      { name: 'campagne', prefix: 'CAMP', category: 'campaign', fields: [{ name: 'criticite', type: 'text', trackHistory: true }] },
    ],
  }],
  linkTypes: [],
}

const NOW = new Date('2026-10-13T10:00:00Z')
const OLD = '2026-09-01T00:00:00Z'

let dir: string
let git: GitService
let reqIndex: RequirementsIndexService
let service: FieldRenameService

const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>

const base = { projectId: '', branchId: '', title: 'X', version: 1, jiraLinks: [] }
const history = (v: string) => ({ status: [{ value: 'draft', at: OLD, by: 'lolive' }], priority: [{ value: v, at: OLD, by: 'lolive' }] })

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh77-rename-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const historyService = new HistoryService(git, async () => ({ by: 'lolive' }), () => NOW)
  const requirements = new RequirementsService(git, reqIndex, schemaStub, undefined, historyService)
  const tests = new TestsService(git, testsIndex, schemaStub, undefined, historyService)
  const campaigns = new CampaignsService(git, tests, undefined, undefined, historyService)
  service = new FieldRenameService(requirements, tests, campaigns)

  await git.writeYaml(dir, 'requirements/SYS-0001.yaml', {
    ...base, id: 'SYS-0001', objectTypeRef: 'root::exigence', status: 'draft',
    fields: { priority: 'high', other: 'o' }, history: history('high'),
  })
  // R2 — donnée orpheline déjà présente sous le nouveau nom.
  await git.writeYaml(dir, 'requirements/SYS-0002.yaml', {
    ...base, id: 'SYS-0002', objectTypeRef: 'root::exigence', status: 'draft',
    fields: { priority: 'low', criticite: 'orpheline' }, history: history('low'),
  })
  // Objet d'un autre type : jamais touché.
  await git.writeYaml(dir, 'requirements/SYS-0003.yaml', {
    ...base, id: 'SYS-0003', objectTypeRef: 'root::autre', status: 'draft', fields: { priority: 'high' },
  })
  await git.writeYaml(dir, 'tests/TEST-0001.yaml', {
    ...base, id: 'TEST-0001', objectTypeRef: 'root::test', status: 'draft', steps: [], preconditions: '',
    postconditions: '', equipment: [], fields: { priority: 'p' }, history: history('p'),
  })
  await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
    id: 'CAMP-0001', title: 'C', objectTypeRef: 'root::campagne', status: 'planned', runs: [], testCaseIds: [],
    createdAt: OLD, fields: { priority: 'c' }, history: { status: [{ value: 'planned', at: OLD, by: 'lolive' }], priority: [{ value: 'c', at: OLD }] },
  })
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('FieldRenameService', () => {
  it('R1 — valeur et historique migrés, aucune nouvelle entrée', async () => {
    const result = await service.renameFields(dir, 'root::exigence', [{ from: 'priority', to: 'criticite' }])
    expect(result.migrated).toEqual(['SYS-0001'])
    const req = await onDisk<Requirement>('requirements/SYS-0001.yaml')
    expect(req.fields).toEqual({ criticite: 'high', other: 'o' })
    expect(req.history).toEqual({
      status: [{ value: 'draft', at: OLD, by: 'lolive' }],
      criticite: [{ value: 'high', at: OLD, by: 'lolive' }],
    })
    expect((await onDisk<Requirement>('requirements/SYS-0003.yaml')).fields).toEqual({ priority: 'high' })
  })

  it('R2 — donnée déjà sous le nouveau nom : objet listé, non modifié', async () => {
    const before = await fsP.readFile(path.join(dir, 'requirements/SYS-0002.yaml'), 'utf-8')
    const result = await service.renameFields(dir, 'root::exigence', [{ from: 'priority', to: 'criticite' }])
    expect(result.skipped).toEqual([{ id: 'SYS-0002', reason: 'target_exists' }])
    expect(await fsP.readFile(path.join(dir, 'requirements/SYS-0002.yaml'), 'utf-8')).toBe(before)
  })

  it('R3 — un fichier en échec n\'empêche pas les autres', async () => {
    await reqIndex.findAll(dir, {})
    // Fichier rendu inaccessible en écriture : remplacé par un dossier du même nom.
    await fsP.rm(path.join(dir, 'requirements/SYS-0001.yaml'))
    await fsP.mkdir(path.join(dir, 'requirements/SYS-0001.yaml'))
    const result = await service.renameFields(dir, 'root::exigence', [{ from: 'priority', to: 'criticite' }])
    expect(result.failed.map(f => f.id)).toEqual(['SYS-0001'])
    expect(result.skipped.map(s => s.id)).toEqual(['SYS-0002'])
  })

  it('tests du type migrés', async () => {
    const result = await service.renameFields(dir, 'root::test', [{ from: 'priority', to: 'criticite' }])
    expect(result.migrated).toEqual(['TEST-0001'])
    const tc = await onDisk<TestCase>('tests/TEST-0001.yaml')
    expect(tc.fields).toEqual({ criticite: 'p' })
    expect(Object.keys(tc.history ?? {})).toEqual(['status', 'criticite'])
  })

  it('R7 — campagnes du type migrées', async () => {
    const result = await service.renameFields(dir, 'root::campagne', [{ from: 'priority', to: 'criticite' }])
    expect(result.migrated).toEqual(['CAMP-0001'])
    const camp = await onDisk<TestCampaign>('campaigns/CAMP-0001.yaml')
    expect(camp.fields).toEqual({ criticite: 'c' })
    expect(camp.history?.criticite).toEqual([{ value: 'c', at: OLD }])
    expect(camp.history?.status).toHaveLength(1)
  })

  it('renommage vide ou identique : rien à faire', async () => {
    expect(await service.renameFields(dir, 'root::exigence', [{ from: 'priority', to: 'priority' }]))
      .toEqual({ migrated: [], skipped: [], failed: [] })
  })
})

describe('tools MCP de mutation du schéma', () => {
  type Handler = (dto: unknown) => Promise<unknown>
  const handlers = new Map<string, { schema: Record<string, { parse(v: unknown): unknown }>; handler: Handler }>()
  const server = {
    registerTool: (name: string, config: { inputSchema: Record<string, { parse(v: unknown): unknown }> }, handler: Handler) => {
      handlers.set(name, { schema: config.inputSchema, handler })
    },
  } as unknown as McpServer

  /** Valide le dto comme le SDK MCP (champ par champ du schéma d'entrée) puis appelle le tool. */
  async function call(name: string, dto: Record<string, unknown>): Promise<void> {
    const tool = handlers.get(name)!
    const parsed = Object.fromEntries(Object.entries(tool.schema).map(([k, s]) => [k, s.parse(dto[k])]))
    await tool.handler(parsed)
  }

  it('C5 — add_object_type et add_field conservent trackStatusHistory / trackHistory', async () => {
    registerSchemaMutationTools(server, createMcpContainer(dir))
    await call('add_object_type', {
      nodeName: 'root',
      objectType: { name: 'risque', prefix: 'RSK', category: 'requirement', trackStatusHistory: false, fields: [{ name: 'g', type: 'enum', values: ['a'], trackHistory: true }] },
    })
    await call('add_field', { nodeName: 'root', typeName: 'risque', field: { name: 'h', type: 'number', trackHistory: true } })
    const schema = await onDisk<ProjectSchema>('.polenta/schema.yaml')
    const risque = schema.nodes[0].objectTypes!.find(t => t.name === 'risque')!
    expect(risque.trackStatusHistory).toBe(false)
    expect(risque.fields.map(f => f.trackHistory)).toEqual([true, true])
  })
})
