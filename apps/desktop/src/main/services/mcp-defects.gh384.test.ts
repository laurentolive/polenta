import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ProjectSchema } from '@polenta/types'
import { GitService } from './git.service'
import { createMcpContainer } from '../../mcp-server/container'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerLinkTools } from '../../mcp-server/tools/links.tools'
import { registerSchemaMutationTools } from '../../mcp-server/tools/schema-mutation.tools'
import { registerDeleteObjectTools } from '../../mcp-server/tools/delete-objects.tools'

// GH384 — défauts restants du serveur MCP (import EMQS du projet washer). Conteneur MCP réel sur un
// dossier temporaire, handlers appelés comme le SDK (zod champ par champ).

const SCHEMA = {
  version: 1,
  linkTypes: [
    { name: 'verifies', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] },
  ],
  nodes: [
    {
      name: 'root', label: 'Produit', objectTypes: [
        {
          name: 'exigence', prefix: 'REQ', category: 'requirement',
          fields: [
            { name: 'priority', type: 'enum', values: ['high', 'low'] },
            { name: 'phases', type: 'multi_enum', values: ['Proto V1', 'Proto V2', 'Série'] },
            { name: 'note', type: 'text' },
          ],
          statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
        },
        {
          name: 'test', prefix: 'TST', category: 'test',
          fields: [
            { name: 'dev_qualif', type: 'enum', values: ['D', 'Q'] },
            { name: 'tested_samples', type: 'number' },
          ],
          statuses: [{ name: 'draft' }, { name: 'ready' }],
        },
        { name: 'campagne', prefix: 'CMP', category: 'campaign', fields: [] },
        {
          name: 'version', prefix: 'PV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
        },
      ],
    },
  ],
}

let dir: string
let git: GitService
type Tool = { schema: Record<string, { parse(v: unknown): unknown }>; handler: (dto: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }
let tools: Map<string, Tool>

function registerTools(user?: string): void {
  tools = new Map()
  const server = { registerTool: (name: string, config: { inputSchema: Tool['schema'] }, handler: Tool['handler']) => { tools.set(name, { schema: config.inputSchema, handler }) } } as unknown as McpServer
  const container = createMcpContainer(dir, undefined, user)
  for (const register of [registerBulkImportTools, registerUpdateTools, registerLinkTools, registerSchemaMutationTools, registerDeleteObjectTools]) {
    register(server, container)
  }
}

async function raw(name: string, dto: Record<string, unknown>) {
  const tool = tools.get(name)!
  const parsed = Object.fromEntries(Object.entries(tool.schema).map(([k, s]) => [k, s.parse(dto[k])]).filter(([, v]) => v !== undefined))
  return tool.handler(parsed)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(name: string, dto: Record<string, unknown>): Promise<T> {
  const res = await raw(name, dto)
  if (res.isError) throw new Error(res.content[0].text)
  return JSON.parse(res.content[0].text) as T
}
const read = async (rel: string) => yaml.load(await fsP.readFile(path.join(dir, rel), 'utf-8')) as Record<string, unknown>
const exists = (rel: string) => fsP.access(path.join(dir, rel)).then(() => true, () => false)

const req = (title: string, fields: Record<string, unknown> = {}) => ({ objectTypeRef: 'root::exigence', title, fields })
const tst = (title: string, fields: Record<string, unknown> = {}) => ({ objectTypeRef: 'root::test', title, steps: [], fields })

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh384-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  registerTools()
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('1 — toutes les erreurs d\'une entrée', () => {
  it('bulk_import_tests dryRun : enum hors liste, nombre, champ non déclaré', async () => {
    const res = await call('bulk_import_tests', { entries: [tst('A', { dev_qualif: 'Z', tested_samples: 'x', inconnu: 1 }), tst('B')], dryRun: true })
    expect(res.errors.map((e: { index: number; field: string }) => [e.index, e.field])).toEqual([[0, 'dev_qualif'], [0, 'tested_samples'], [0, 'inconnu']])
    expect(res.summary).toEqual({ total: 2, ok: 1, failed: 1 })
  })

  it('bulk_import_requirements : statut inconnu et valeur hors liste ensemble', async () => {
    const res = await call('bulk_import_requirements', { entries: [{ ...req('A', { priority: 'x' }), status: 'nope' }], dryRun: true })
    expect(res.errors.map((e: { field: string }) => e.field)).toEqual(['status', 'priority'])
  })

  it('update_requirements : toutes les erreurs, failed compte les entrées', async () => {
    await call('bulk_import_requirements', { entries: [req('A')], dryRun: false })
    const res = await call('update_requirements', { entries: [{ id: 'REQ-0001', status: 'nope', fields: { priority: 'x', phases: ['Z'], foo: 1 } }], dryRun: true })
    expect(res.errors.map((e: { field: string }) => e.field)).toEqual(['status', 'priority', 'phases', 'foo'])
    expect(res.summary.failed).toBe(1)
  })
})

describe('3 — update_link_type', () => {
  beforeEach(async () => {
    await call('bulk_import_requirements', { entries: [req('R')], dryRun: false })
    await call('bulk_import_tests', { entries: [tst('T')], dryRun: false })
    await call('create_links', { entries: [{ type: 'verifies', sourceId: 'TST-0001', targetId: 'REQ-0001' }], dryRun: false })
  })
  const linkType = async () => ((yaml.load(await fsP.readFile(path.join(dir, '.polenta/schema.yaml'), 'utf-8')) as ProjectSchema).linkTypes[0])

  it('defaultVisible et libellé ; réponse = le type de lien', async () => {
    const res = await call('update_link_type', { name: 'verifies', defaultVisible: true, labelSourceToTarget: 'vérifie (essai)' })
    expect(res).toMatchObject({ name: 'verifies', defaultVisible: true, labelSourceToTarget: 'vérifie (essai)' })
    expect((await linkType()).defaultVisible).toBe(true)
    await call('update_link_type', { name: 'verifies', defaultVisible: false })
    expect('defaultVisible' in (await linkType())).toBe(false)
  })

  it('ref retiré utilisé par un lien : LINK_TYPE_IN_USE, rien n\'est écrit', async () => {
    const before = await fsP.readFile(path.join(dir, '.polenta/schema.yaml'), 'utf-8')
    const res = await raw('update_link_type', { name: 'verifies', sourceRefs: ['campaign'] })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/^\[LINK_TYPE_IN_USE\] 1 lien/)
    expect(await fsP.readFile(path.join(dir, '.polenta/schema.yaml'), 'utf-8')).toBe(before)
    // Ref compatible ajoutée, ou ref précise du type utilisé : accepté.
    await call('update_link_type', { name: 'verifies', sourceRefs: ['root::test', 'campaign'] })
    expect((await linkType()).sourceRefs).toEqual(['root::test', 'campaign'])
  })

  it('introuvable, liste vide, rien à modifier', async () => {
    expect((await raw('update_link_type', { name: 'nope', defaultVisible: true })).content[0].text).toMatch(/^\[LINK_TYPE_NOT_FOUND\]/)
    expect((await raw('update_link_type', { name: 'verifies', targetRefs: [] })).content[0].text).toMatch(/^\[LINK_TYPE_INVALID\]/)
    await expect(raw('update_link_type', { name: 'verifies' })).rejects.toThrow(/Input validation error/)
  })
})

describe('4 — delete_requirements / delete_tests', () => {
  beforeEach(async () => {
    await call('bulk_import_requirements', { entries: [req('R1'), req('R2'), req('R3')], dryRun: false })
    await call('bulk_import_tests', { entries: [tst('T1'), tst('T2')], dryRun: false })
    await call('create_links', { entries: [{ type: 'verifies', sourceId: 'TST-0001', targetId: 'REQ-0001' }], dryRun: false })
    await git.writeYaml(dir, 'campaigns/CMP-0001.yaml', { id: 'CMP-0001', title: 'C', status: 'planned', testCaseIds: ['TST-0002'], runs: [], fields: {} })
    await git.writeYaml(dir, 'versions/PV-0001.yaml', { id: 'PV-0001', objectTypeRef: 'root::version', title: '1.0', status: 'en_cours', fields: {}, changes: [{ id: 'REQ-0002' }] })
  })

  it('dryRun : aperçu et refus (lien, campagne, version, introuvable), rien d\'écrit', async () => {
    const res = await call('delete_requirements', { ids: ['REQ-0001', 'REQ-0002', 'REQ-0003', 'REQ-0099'] })
    expect(res.dryRun).toBe(true)
    expect(res.wouldDelete.map((w: { id: string }) => w.id)).toEqual(['REQ-0003'])
    expect(res.errors.map((e: { id: string; code: string }) => `${e.id}:${e.code}`)).toEqual([
      'REQ-0001:OBJECT_IN_USE', 'REQ-0002:OBJECT_IN_USE', 'REQ-0099:OBJECT_NOT_FOUND',
    ])
    expect(res.errors[0].reason).toMatch(/lien\(s\) /)
    expect(res.errors[1].reason).toMatch(/version\(s\) PV-0001/)
    const tests = await call('delete_tests', { ids: ['TST-0002'] })
    expect(tests.errors[0].reason).toMatch(/campagne\(s\) CMP-0001/)
    expect(await exists('requirements/REQ-0003.yaml')).toBe(true)
  })

  it('suppression : fichier retiré, pierre tombale, ID jamais réattribué', async () => {
    const res = await call('delete_requirements', { ids: ['REQ-0003'], dryRun: false })
    expect(res.deleted).toEqual(['REQ-0003'])
    expect(await exists('requirements/REQ-0003.yaml')).toBe(false)
    expect(await exists('.polenta/tombstones/REQ-0003')).toBe(true)
    const next = await call('bulk_import_requirements', { entries: [req('R4')], dryRun: false })
    expect(next.created[0].id).toBe('REQ-0004')
    // Plus visible des autres outils (index rafraîchi).
    expect((await call('delete_requirements', { ids: ['REQ-0003'] })).errors[0].code).toBe('OBJECT_NOT_FOUND')
  })

  it('test : ses exécutions sont supprimées avec lui', async () => {
    await call('delete_links', { ids: [(await call('list_links', {})).links[0].id], dryRun: false })
    await git.writeYaml(dir, 'test-runs/TST-0001/run-1.yaml', { id: 'run-1' })
    const res = await call('delete_tests', { ids: ['TST-0001'], dryRun: false })
    expect(res.deleted).toEqual(['TST-0001'])
    expect(await exists('test-runs/TST-0001')).toBe(false)
  })
})

describe('5 — auteur des écritures MCP', () => {
  it('sans --user : mcp (objet et lien)', async () => {
    await call('bulk_import_requirements', { entries: [req('R')], dryRun: false })
    await call('bulk_import_tests', { entries: [tst('T')], dryRun: false })
    await call('create_links', { entries: [{ type: 'verifies', sourceId: 'TST-0001', targetId: 'REQ-0001' }], dryRun: false })
    expect((await read('requirements/REQ-0001.yaml')).createdBy).toBe('mcp')
    expect((await call('list_links', {})).links[0].createdBy).toBe('mcp')
  })

  it('avec --user : cet utilisateur partout', async () => {
    registerTools('alice')
    await call('bulk_import_requirements', { entries: [req('R')], dryRun: false })
    await call('bulk_import_tests', { entries: [tst('T')], dryRun: false })
    await call('create_links', { entries: [{ type: 'verifies', sourceId: 'TST-0001', targetId: 'REQ-0001' }], dryRun: false })
    expect((await read('requirements/REQ-0001.yaml')).createdBy).toBe('alice')
    expect((await call('list_links', {})).links[0].createdBy).toBe('alice')
  })
})

describe('6 — multi_enum au format de l\'application', () => {
  it('liste et chaîne mal espacée stockées en « a, b »', async () => {
    await call('bulk_import_requirements', { entries: [req('A', { phases: ['Proto V1', 'Série'] }), req('B', { phases: 'Proto V1,Proto V2' })], dryRun: false })
    expect((await read('requirements/REQ-0001.yaml')).fields).toEqual({ phases: 'Proto V1, Série' })
    expect((await read('requirements/REQ-0002.yaml')).fields).toEqual({ phases: 'Proto V1, Proto V2' })
    await call('update_requirements', { entries: [{ id: 'REQ-0002', fields: { phases: ['Série'] } }], dryRun: false })
    expect((await read('requirements/REQ-0002.yaml')).fields).toEqual({ phases: 'Série' })
  })

  it('valeur hors liste dans une liste : toujours refusée', async () => {
    const res = await call('bulk_import_requirements', { entries: [req('A', { phases: ['Proto V1', 'Z'] })], dryRun: true })
    expect(res.errors[0]).toMatchObject({ field: 'phases', reason: expect.stringMatching(/"Z" hors liste/) })
  })
})
