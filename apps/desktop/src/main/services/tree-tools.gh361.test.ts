import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitService } from './git.service'
import { TREE_LOCK_TTL_MS, removeAppLock, writeAppLock } from './tree-lock.util'
import { TreeService } from './tree.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerTreeTools } from '../../mcp-server/tools/tree.tools'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'

// GH361 — outils MCP de rangement en dossiers (specs/GH361-tests.md §C). Vrai GitService sur un
// dossier temporaire, conteneur MCP réel ; les tools sont appelés par leur handler.

const SCHEMA = {
  version: 1,
  nodes: [
    {
      name: 'root', label: 'Produit', objectTypes: [
        { name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft' }] },
        { name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [], statuses: [{ name: 'draft' }] },
        { name: 'issue', label: 'Issue', prefix: 'ISS', category: 'issue', fields: [], statuses: [{ name: 'open' }] },
        { name: 'campagne', label: 'Campagne', prefix: 'CMP', category: 'campaign', fields: [], statuses: [{ name: 'draft' }] },
      ],
    },
    {
      name: 'fige', label: 'Figé', readonly: true, objectTypes: [
        { name: 'exf', label: 'Exigence figée', prefix: 'FIG', category: 'requirement', fields: [], statuses: [{ name: 'draft' }] },
      ],
    },
  ],
  linkTypes: [],
}

const REQ = 'root::exigence'
const TREE_FILE = '.polenta/trees/root/exigence.yaml'

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let git: GitService
let mcp: McpContainer
let tools: Record<string, Handler>

async function call(name: string, args: Record<string, unknown>) {
  const res = await tools[name](args)
  return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) }
}
const tree = async (objectTypeRef = REQ) => (await call('get_tree', { objectTypeRef })).data
const raw = () => fsP.readFile(path.join(dir, TREE_FILE), 'utf-8').catch(() => null)
const newReq = (title: string) => mcp.requirements.create(dir, { objectTypeRef: REQ, title, fields: {} } as never)
const future = () => new Date(Date.now() + TREE_LOCK_TTL_MS).toISOString()

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh361-'))
  await fsP.mkdir(path.join(dir, '.git'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  mcp = createMcpContainer(dir, undefined, 'alice')
  vi.spyOn(mcp.git, 'currentBranch').mockResolvedValue('main')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } }
  registerTreeTools(server as never, mcp)
  registerBulkImportTools(server as never, mcp)
})

afterEach(async () => {
  await removeAppLock(dir, 'root', 'exigence')
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('get_tree', () => {
  it('C1 — rangement, non classés triés, titres courants', async () => {
    await newReq('Un'); await newReq('Deux'); await newReq('Trois')
    await git.writeYaml(dir, TREE_FILE, {
      nodeId: 'root', typeId: 'exigence',
      root: [{ id: 'f', kind: 'folder', name: 'Perf', children: [{ id: 'i', kind: 'item', objectId: 'SYS-0002', children: [] }] }],
    })
    expect(await tree()).toEqual({
      objectTypeRef: REQ, locked: null,
      root: [{ kind: 'folder', name: 'Perf', path: 'Perf', children: [{ kind: 'item', id: 'SYS-0002', title: 'Deux', children: [] }] }],
      unclassified: [{ id: 'SYS-0001', title: 'Un' }, { id: 'SYS-0003', title: 'Trois' }],
    })
  })

  it('C2 — types de test et d’issue', async () => {
    await mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', fields: {}, steps: [] } as never)
    await mcp.issues.create(dir, { objectTypeRef: 'root::issue', title: 'I', fields: {} })
    expect((await tree('root::test')).unclassified).toEqual([{ id: 'TEST-0001', title: 'T' }])
    expect((await tree('root::issue')).unclassified.map((o: { title: string }) => o.title)).toEqual(['I'])
  })

  it('C3 — type campagne / inconnu', async () => {
    expect((await call('get_tree', { objectTypeRef: 'root::campagne' })).data).toContain('[TYPE_NOT_SUPPORTED]')
    expect((await call('get_tree', { objectTypeRef: 'root::nope' })).data).toContain('[TYPE_NOT_FOUND]')
  })
})

describe('create_folders', () => {
  it('C4 — dryRun par défaut : aucun fichier écrit', async () => {
    const res = await call('create_folders', { objectTypeRef: REQ, paths: ['A/B'] })
    expect(res.data).toMatchObject({ dryRun: true, locked: null, created: ['A', 'A/B'], existing: [], errors: [] })
    expect(await raw()).toBeNull()
  })

  it('C5 — écrit en une fois ; rejoué : existants, fichier inchangé ; chemin invalide reporté', async () => {
    const res = await call('create_folders', { objectTypeRef: REQ, paths: ['Sécurité/Batterie', 'Sécurité/Moteur', 'X//Y'], dryRun: false })
    expect(res.data.created).toEqual(['Sécurité', 'Sécurité/Batterie', 'Sécurité/Moteur'])
    expect(res.data.errors).toEqual([{ index: 2, path: 'X//Y', reason: expect.stringContaining('[FOLDER_PATH_INVALID]') }])
    const before = await raw()
    const again = await call('create_folders', { objectTypeRef: REQ, paths: ['Sécurité/Batterie', 'Sécurité/Moteur'], dryRun: false })
    expect(again.data).toMatchObject({ created: [], existing: ['Sécurité/Batterie', 'Sécurité/Moteur'] })
    expect(await raw()).toBe(before)
    expect((await tree()).root.map((n: { path: string }) => n.path)).toEqual(['Sécurité'])
  })
})

describe('move_to_folder', () => {
  it('C6 — range un non classé, puis le remet ; fichier sans name sur les éléments', async () => {
    await newReq('Un'); await newReq('Deux')
    const res = await call('move_to_folder', { objectTypeRef: REQ, moves: [{ id: 'SYS-0002', folder: 'A/B' }], dryRun: false })
    expect(res.data).toMatchObject({ moved: [{ id: 'SYS-0002', folder: 'A/B' }], createdFolders: ['A', 'A/B'], errors: [] })
    const t = await tree()
    expect(t.root[0].children[0].children).toEqual([{ kind: 'item', id: 'SYS-0002', title: 'Deux', children: [] }])
    expect(t.unclassified).toEqual([{ id: 'SYS-0001', title: 'Un' }])
    const stored = yaml.load((await raw())!) as { root: Array<{ children: Array<{ children: Array<Record<string, unknown>> }> }> }
    expect(stored.root[0].children[0].children[0]).not.toHaveProperty('name')

    await call('move_to_folder', { objectTypeRef: REQ, moves: [{ id: 'SYS-0002', folder: null }], dryRun: false })
    expect((await tree()).unclassified.map((o: { id: string }) => o.id)).toEqual(['SYS-0001', 'SYS-0002'])
  })

  it('C7 / C8 — dossier absent sans createMissing ; objet inconnu', async () => {
    await newReq('Un')
    const res = await call('move_to_folder', {
      objectTypeRef: REQ, createMissing: false, dryRun: false,
      moves: [{ id: 'SYS-0001', folder: 'Absent' }, { id: 'SYS-0099', folder: null }],
    })
    expect(res.data.errors.map((e: { reason: string }) => e.reason.slice(0, 18))).toEqual(['[FOLDER_NOT_FOUND]', '[OBJECT_NOT_FOUND]'])
    expect(await raw()).toBeNull()
  })
})

describe('rename / move / delete / reorder', () => {
  it('C9 — opérations sur les dossiers, aucun objet supprimé', async () => {
    await newReq('Un'); await newReq('Deux'); await newReq('Trois')
    await call('move_to_folder', {
      objectTypeRef: REQ, dryRun: false,
      moves: [{ id: 'SYS-0001', folder: 'A/B' }, { id: 'SYS-0002', folder: 'C' }],
    })
    expect((await call('rename_folder', { objectTypeRef: REQ, renames: [{ path: 'A/B', name: 'Bis' }], dryRun: false })).data.renamed)
      .toEqual([{ from: 'A/B', to: 'A/Bis' }])
    expect((await call('move_folder', { objectTypeRef: REQ, moves: [{ path: 'A/Bis', parent: 'C' }], dryRun: false })).data.moved)
      .toEqual([{ from: 'A/Bis', to: 'C/Bis' }])
    const reorder = await call('reorder_tree', { objectTypeRef: REQ, folder: 'C', order: [{ folder: 'Bis' }], dryRun: false })
    expect(reorder.data.order.map((e: { path?: string; id?: string }) => e.path ?? e.id)).toEqual(['C/Bis', 'SYS-0002'])
    const del = await call('delete_folders', { objectTypeRef: REQ, paths: ['C', 'A'], recursive: true, dryRun: false })
    expect(del.data).toMatchObject({ deleted: ['C', 'A'], unclassified: ['SYS-0001', 'SYS-0002'] })
    expect((await tree()).unclassified).toHaveLength(3)
    expect((await fsP.readdir(path.join(dir, 'requirements')))).toHaveLength(3)
  })
})

describe('verrou', () => {
  it('C10 / C11 — application affichant le rangement : écriture refusée, aperçu et lecture le signalent ; libéré : passe', async () => {
    const since = new Date().toISOString()
    await writeAppLock(dir, 'root', 'exigence', since, future())
    const write = await call('create_folders', { objectTypeRef: REQ, paths: ['A'], dryRun: false })
    expect(write.isError).toBe(true)
    expect(write.data).toContain('[TREE_LOCKED]')
    expect(await raw()).toBeNull()
    expect((await call('create_folders', { objectTypeRef: REQ, paths: ['A'] })).data.locked).toEqual({ by: 'app', since })
    expect((await tree()).locked).toEqual({ by: 'app', since })
    expect((await call('create_folders', { objectTypeRef: 'root::test', paths: ['A'], dryRun: false })).isError).toBe(false)

    await removeAppLock(dir, 'root', 'exigence')
    expect((await call('create_folders', { objectTypeRef: REQ, paths: ['A'], dryRun: false })).data.created).toEqual(['A'])
  })

  it('C12 — branche en lecture seule ; nœud readonly', async () => {
    expect((await call('create_folders', { objectTypeRef: 'fige::exf', paths: ['A'], dryRun: false })).data).toContain('[READONLY_REPO]')
    vi.spyOn(mcp.git, 'currentBranch').mockResolvedValue('prj-x')
    expect((await call('create_folders', { objectTypeRef: REQ, paths: ['A'], dryRun: false })).data).toContain('[READONLY_BRANCH]')
  })
})

describe('bulk_import avec folder', () => {
  it('C13 — dryRun : dossiers prévus, chemin invalide refusé, rien écrit', async () => {
    const res = await call('bulk_import_requirements', {
      dryRun: true,
      entries: [
        { objectTypeRef: REQ, title: 'Un', fields: {}, folder: 'A/B' },
        { objectTypeRef: REQ, title: 'Deux', fields: {}, folder: 'A//B' },
      ],
    })
    expect(res.data.wouldCreate.map((w: { index: number }) => w.index)).toEqual([0])
    expect(res.data.errors).toEqual([{ index: 1, field: 'folder', reason: expect.stringContaining('[FOLDER_PATH_INVALID]') }])
    expect(res.data.folders).toEqual([{ objectTypeRef: REQ, toCreate: ['A', 'A/B'], locked: null }])
    expect(res.data.summary).toEqual({ total: 2, ok: 1, failed: 1 })
    expect(await raw()).toBeNull()
  })

  it('C14 — écriture : objets créés et rangés, YAML sans folder ; chemin invalide = non créé', async () => {
    const res = await call('bulk_import_requirements', {
      dryRun: false,
      entries: [
        { objectTypeRef: REQ, title: 'Un', fields: {}, folder: 'A' },
        { objectTypeRef: REQ, title: 'Deux', fields: {}, folder: 'A/B' },
        { objectTypeRef: REQ, title: 'Trois', fields: {} },
        { objectTypeRef: REQ, title: 'Quatre', fields: {}, folder: '/' },
      ],
    })
    expect(res.data.created.map((c: { index: number }) => c.index)).toEqual([0, 1, 2])
    expect(res.data.errors).toEqual([{ index: 3, reason: expect.stringContaining('[FOLDER_PATH_INVALID]') }])
    const t = await tree()
    expect(t.root).toEqual([{
      kind: 'folder', name: 'A', path: 'A', children: [
        { kind: 'item', id: 'SYS-0001', title: 'Un', children: [] },
        { kind: 'folder', name: 'B', path: 'A/B', children: [{ kind: 'item', id: 'SYS-0002', title: 'Deux', children: [] }] },
      ],
    }])
    expect(t.unclassified).toEqual([{ id: 'SYS-0003', title: 'Trois' }])
    expect(await fsP.readFile(path.join(dir, 'requirements', 'SYS-0001.yaml'), 'utf-8')).not.toContain('folder')
  })

  it('C15 — arbre verrouillé : tests créés, non classés, FOLDER_PLACEMENT_FAILED', async () => {
    await writeAppLock(dir, 'root', 'test', new Date().toISOString(), future())
    try {
      const res = await call('bulk_import_tests', {
        dryRun: false,
        entries: [{ objectTypeRef: 'root::test', title: 'T', fields: {}, steps: [], folder: 'A' }],
      })
      expect(res.data.created).toEqual([{ index: 0, id: 'TEST-0001' }])
      expect(res.data.errors).toEqual([{ index: 0, reason: expect.stringMatching(/^FOLDER_PLACEMENT_FAILED: \[TREE_LOCKED\]/) }])
      await removeAppLock(dir, 'root', 'test')
      expect((await tree('root::test')).unclassified).toEqual([{ id: 'TEST-0001', title: 'T' }])
    } finally {
      await removeAppLock(dir, 'root', 'test')
    }
  })

  it('C16 — le fichier écrit par le MCP est relu à l’identique par le TreeService de l’app', async () => {
    await newReq('Un'); await newReq('Deux')
    await call('move_to_folder', { objectTypeRef: REQ, moves: [{ id: 'SYS-0002', folder: 'A' }], dryRun: false })
    const app = new TreeService()
    const stored = await app.get(dir, 'root', 'exigence')
    expect(stored.root).toEqual([{ id: expect.any(String), kind: 'folder', name: 'A', children: [{ id: expect.any(String), kind: 'item', objectId: 'SYS-0002', children: [] }] }])
  })
})
