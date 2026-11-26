import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TestRepo } from '../git/test-repo.test-util'
import { GitService } from './git.service'
import { WorkspaceService } from './workspace.service'
import type { HostContext } from '../host/host-context'
import type { SyncService } from './sync.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { detectWorkspaceDir } from '../../mcp-server/workspace-detect'
import { buildMcpJsonContent, extractMcpJsonAbsolutePaths } from '../../mcp-server/mcp-json.template'
import { registerSchemaTools } from '../../mcp-server/tools/schema.tools'
import { registerReadTools } from '../../mcp-server/tools/read.tools'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerDeleteObjectTools } from '../../mcp-server/tools/delete-objects.tools'

// GH447 — serveur MCP ouvert sur le repo produit d'un workspace : les exigences et tests d'un composant
// en repo séparé se listent, se créent, se modifient et se suppriment dans le repo du composant.
// Reproduit PH2 : produit `produit`, composant `comp-hmi` (préfixe `HMI_PH2_REQ`, `_` et chiffres),
// objets du composant écrits `root::<type>` comme le fait l'application.

const status = [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }]
const PRODUCT_SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'PRODUCT_REQ', label: 'Exigence produit', prefix: 'PRODUCT_REQ', category: 'requirement', fields: [], statuses: status },
      { name: 'PRODUCT_TEST', label: 'Test produit', prefix: 'PRODUCT_TEST', category: 'test', fields: [], statuses: status },
    ],
  }],
}
const COMPONENT_SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root', label: 'HMI', objectTypes: [
      {
        name: 'HMI_PH2_REQ', label: 'Exigence HMI', prefix: 'HMI_PH2_REQ', category: 'requirement', statuses: status,
        fields: [{ name: 'description', label: 'Description', type: 'text', required: true }],
      },
      { name: 'HMI_PH2_TEST', label: 'Test HMI', prefix: 'HMI_PH2_TEST', category: 'test', fields: [], statuses: status },
    ],
  }],
}

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let ws: string
let produit: string
let comp: string
let mcp: McpContainer
let tools: Record<string, Handler>

const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const readYaml = (file: string) => yaml.load(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>

function treeNode(name: string, children: unknown[] = []) {
  return { name, repoPath: name, url: '', pin: '', isInterface: false, children, label: name }
}

async function initRepo(dir: string, schema: unknown) {
  const repo = await TestRepo.init(dir, 'main')
  await repo.setConfig('user.name', 'Alice')
  await repo.setConfig('user.email', 'a@x')
  await new GitService().writeYaml(dir, '.polenta/schema.yaml', schema)
  await repo.commitAll('schéma')
  return repo
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh447-'))
  produit = path.join(ws, 'produit')
  comp = path.join(ws, 'comp-hmi')
  await initRepo(produit, PRODUCT_SCHEMA)
  const compRepo = await initRepo(comp, COMPONENT_SCHEMA)
  await fsP.mkdir(path.join(ws, '.polenta'), { recursive: true })
  await fsP.writeFile(path.join(ws, '.polenta', 'workspace.yaml'), yaml.dump({ rootRepo: 'produit' }))
  await fsP.writeFile(path.join(ws, '.polenta', 'tree.cache.yaml'), yaml.dump({
    rootRepoHeadSha: '', generatedAt: new Date().toISOString(),
    nodes: [treeNode('produit'), treeNode('comp-hmi')],
    logicalTree: treeNode('produit', [treeNode('comp-hmi')]),
  }))

  // Le cas de l'issue : le composant contient déjà HMI_PH2_REQ-0001 à 0003 (écrits par l'application).
  const setup = createMcpContainer(produit)
  for (const title of ['A', 'B', 'C']) {
    await setup.requirements.create(comp, { objectTypeRef: 'root::HMI_PH2_REQ', title, fields: { description: 'd' } } as never)
  }
  await setup.tests.create(comp, { objectTypeRef: 'root::HMI_PH2_TEST', title: 'T', steps: [], fields: {} } as never)
  await setup.requirements.create(produit, { objectTypeRef: 'root::PRODUCT_REQ', title: 'P', fields: {} } as never)
  await compRepo.commitAll('objets')
  await new TestRepo(produit).commitAll('objets')

  // Comme le `.mcp.json` généré : `--repo .` seul, workspace détecté (point 4).
  mcp = createMcpContainer(produit, detectWorkspaceDir(produit), 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } } as never
  registerSchemaTools(server, mcp)
  registerReadTools(server, mcp)
  registerBulkImportTools(server, mcp)
  registerUpdateTools(server, mcp)
  registerDeleteObjectTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('GH447 — workspace détecté sans --workspace (point 4)', () => {
  it('repo racine d’un workspace : dossier parent ; repo isolé ou composant : aucun', async () => {
    expect(detectWorkspaceDir(produit)).toBe(ws)
    expect(detectWorkspaceDir(comp)).toBeUndefined()
    const alone = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh447-alone-'))
    try {
      expect(detectWorkspaceDir(alone)).toBeUndefined()
    } finally {
      await fsP.rm(alone, { recursive: true, force: true })
    }
  })

  it('get_schema : composants du workspace, et schéma d’un composant', async () => {
    const root = await call<{ workspaceComponents: string[] }>('get_schema')
    expect(root.workspaceComponents).toEqual(['comp-hmi'])
    const component = await call<{ nodes: Array<{ objectTypes: Array<{ prefix: string }> }> }>('get_schema', { component: 'comp-hmi' })
    expect(component.nodes[0].objectTypes.map(t => t.prefix)).toEqual(['HMI_PH2_REQ', 'HMI_PH2_TEST'])
  })
})

describe('GH447 — list_requirements / list_tests (point 3)', () => {
  it('liste les exigences du composant sous son nom de montage, filtre par type compris', async () => {
    const all = await call<{ items: Array<{ id: string; objectTypeRef: string; component?: string }> }>('list_requirements')
    expect(all.items.map(r => r.id)).toEqual(['HMI_PH2_REQ-0001', 'HMI_PH2_REQ-0002', 'HMI_PH2_REQ-0003', 'PRODUCT_REQ-0001'])
    expect(all.items[0]).toMatchObject({ objectTypeRef: 'comp-hmi::HMI_PH2_REQ', component: 'comp-hmi' })
    expect(all.items[3]).toMatchObject({ objectTypeRef: 'root::PRODUCT_REQ' })
    expect(all.items[3].component).toBeUndefined()

    const filtered = await call<{ items: Array<{ id: string }> }>('list_requirements', { filters: { type: 'comp-hmi::HMI_PH2_REQ' } })
    expect(filtered.items.map(r => r.id)).toEqual(['HMI_PH2_REQ-0001', 'HMI_PH2_REQ-0002', 'HMI_PH2_REQ-0003'])
  })

  it('liste les tests du composant', async () => {
    const all = await call<{ items: Array<{ id: string; objectTypeRef: string }> }>('list_tests', { filters: { type: 'comp-hmi::HMI_PH2_TEST' } })
    expect(all.items).toEqual([expect.objectContaining({ id: 'HMI_PH2_TEST-0001', objectTypeRef: 'comp-hmi::HMI_PH2_TEST' })])
  })
})

describe('GH447 — bulk_import dans un composant (point 1)', () => {
  it('dry-run : préfixe du schéma du composant, numérotation après ses fichiers', async () => {
    const res = await call<{ wouldCreate: Array<{ index: number; id: string }>; errors: unknown[] }>('bulk_import_requirements', {
      entries: [
        { objectTypeRef: 'comp-hmi::HMI_PH2_REQ', title: 'x', fields: { description: 'd' } },
        { objectTypeRef: 'root::PRODUCT_REQ', title: 'y', fields: {} },
        { objectTypeRef: 'comp-hmi::HMI_PH2_REQ', title: 'z', fields: { description: 'd' } },
      ],
      dryRun: true,
    })
    expect(res.errors).toEqual([])
    expect(res.wouldCreate).toEqual([
      { index: 0, id: 'HMI_PH2_REQ-0004' },
      { index: 1, id: 'PRODUCT_REQ-0002' },
      { index: 2, id: 'HMI_PH2_REQ-0005' },
    ])
  })

  it('écriture réelle : fichier dans le repo du composant, type écrit `root::<type>`', async () => {
    const res = await call<{ created: Array<{ index: number; id: string }>; summary: { ok: number } }>('bulk_import_requirements', {
      entries: [{ objectTypeRef: 'comp-hmi::HMI_PH2_REQ', title: 'x', fields: { description: 'd' } }],
      dryRun: false,
    })
    expect(res.created).toEqual([{ index: 0, id: 'HMI_PH2_REQ-0004' }])
    expect(readYaml(path.join(comp, 'requirements', 'HMI_PH2_REQ-0004.yaml'))).toMatchObject({ objectTypeRef: 'root::HMI_PH2_REQ', title: 'x' })
    expect(fs.existsSync(path.join(produit, 'requirements', 'HMI_PH2_REQ-0004.yaml'))).toBe(false)
  })

  it('validation par le schéma du composant (champ requis) ; nœud ou composant inconnu refusé', async () => {
    const res = await call<{ errors: Array<{ index: number; reason: string }>; wouldCreate: unknown[] }>('bulk_import_requirements', {
      entries: [
        { objectTypeRef: 'comp-hmi::HMI_PH2_REQ', title: 'sans description', fields: {} },
        { objectTypeRef: 'comp-hmy::HMI_PH2_REQ', title: 'faute de frappe', fields: {} },
      ],
      dryRun: true,
    })
    expect(res.wouldCreate).toEqual([])
    expect(res.errors.map(e => e.index)).toEqual([0, 1])
    expect(res.errors[0].reason).toContain('description')
    expect(res.errors[1].reason).toContain('comp-hmy')
  })

  it('tests : créés dans le composant', async () => {
    const res = await call<{ created: Array<{ id: string }> }>('bulk_import_tests', {
      entries: [{ objectTypeRef: 'comp-hmi::HMI_PH2_TEST', title: 't', steps: [], fields: {} }],
      dryRun: false,
    })
    expect(res.created.map(c => c.id)).toEqual(['HMI_PH2_TEST-0002'])
    expect(fs.existsSync(path.join(comp, 'tests', 'HMI_PH2_TEST-0002.yaml'))).toBe(true)
  })
})

describe('GH447 — update / historique / suppression dans un composant (point 2)', () => {
  it('update_requirements : aperçu puis écriture dans le repo du composant', async () => {
    const preview = await call<{ preview: Array<{ id: string; changes: Record<string, unknown> }>; errors: unknown[] }>('update_requirements', {
      entries: [{ id: 'HMI_PH2_REQ-0001', title: 'Nouveau titre' }],
      dryRun: true, // défaut appliqué par le SDK, pas par le handler appelé directement
    })
    expect(preview.errors).toEqual([])
    expect(preview.preview[0].changes.title).toEqual({ before: 'A', after: 'Nouveau titre' })

    const written = await call<{ updated: Array<{ changed: boolean }>; errors: unknown[] }>('update_requirements', {
      entries: [{ id: 'HMI_PH2_REQ-0001', title: 'Nouveau titre', status: 'review' }],
      dryRun: false,
    })
    expect(written.errors).toEqual([])
    expect(readYaml(path.join(comp, 'requirements', 'HMI_PH2_REQ-0001.yaml'))).toMatchObject({
      objectTypeRef: 'root::HMI_PH2_REQ', title: 'Nouveau titre', status: 'review',
    })

    const history = await call<{ status: Array<{ value: string }> }>('get_history', { kind: 'requirement', id: 'HMI_PH2_REQ-0001' })
    expect(history.status.at(-1)).toMatchObject({ value: 'review' })
  })

  it('update_requirements : statut validé par le schéma du composant', async () => {
    const res = await call<{ errors: Array<{ reason: string }> }>('update_requirements', {
      entries: [{ id: 'HMI_PH2_REQ-0002', status: 'inconnu' }],
      dryRun: true,
    })
    expect(res.errors[0].reason).toContain('inconnu')
  })

  it('update_tests : test du composant', async () => {
    const res = await call<{ updated: unknown[]; errors: unknown[] }>('update_tests', {
      entries: [{ id: 'HMI_PH2_TEST-0001', title: 'T2' }],
      dryRun: false,
    })
    expect(res.errors).toEqual([])
    expect(readYaml(path.join(comp, 'tests', 'HMI_PH2_TEST-0001.yaml'))).toMatchObject({ title: 'T2' })
  })

  it('composant en lecture seule (HEAD détachée) : écritures refusées', async () => {
    await new TestRepo(comp).checkout('HEAD', { detach: true })
    const upd = await call<{ errors: Array<{ reason: string }> }>('update_requirements', { entries: [{ id: 'HMI_PH2_REQ-0001', title: 'x' }], dryRun: true })
    expect(upd.errors[0].reason).toContain('lecture seule')
    const imp = await call<{ errors: Array<{ reason: string }> }>('bulk_import_requirements', {
      entries: [{ objectTypeRef: 'comp-hmi::HMI_PH2_REQ', title: 'x', fields: { description: 'd' } }],
      dryRun: true,
    })
    expect(imp.errors[0].reason).toContain('lecture seule')
    const del = await call<{ errors: Array<{ code: string }> }>('delete_requirements', { ids: ['HMI_PH2_REQ-0001'], dryRun: true })
    expect(del.errors[0].code).toBe('NODE_READONLY')
  })

  it('delete_requirements : pierre tombale et fichier dans le repo du composant', async () => {
    const res = await call<{ deleted: string[]; errors: unknown[] }>('delete_requirements', { ids: ['HMI_PH2_REQ-0003', 'PRODUCT_REQ-0001'], dryRun: false })
    expect(res.errors).toEqual([])
    expect(res.deleted.sort()).toEqual(['HMI_PH2_REQ-0003', 'PRODUCT_REQ-0001'])
    expect(fs.existsSync(path.join(comp, 'requirements', 'HMI_PH2_REQ-0003.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(comp, '.polenta', 'tombstones', 'HMI_PH2_REQ-0003'))).toBe(true)
    expect(fs.existsSync(path.join(produit, '.polenta', 'tombstones', 'PRODUCT_REQ-0001'))).toBe(true)
  })
})

describe('GH447 — .mcp.json dont la commande n’existe plus sur ce poste (point 5)', () => {
  const launch = { command: process.execPath, args: ['bundle.cjs', '--repo', '.'] }
  const workspaceService = () => new WorkspaceService(
    { userDataDir: ws, machineConfig: {}, mcpServerLaunch: () => launch } as unknown as HostContext, {} as SyncService,
  )

  it('chemins absolus extraits de la commande et des arguments', () => {
    const raw = buildMcpJsonContent({ command: 'C:/x/Polenta.exe', args: ['C:/x/index.cjs', '--repo', '.'] })
    expect(extractMcpJsonAbsolutePaths(raw, p => p.startsWith('C:/'))).toEqual(['C:/x/Polenta.exe', 'C:/x/index.cjs'])
  })

  it('commande absente : proposé à la mise en conformité ; commande présente : rien', async () => {
    const service = workspaceService()
    const gone = path.join(ws, 'Temp', 'extraction', 'Polenta.exe')
    await fsP.writeFile(path.join(produit, '.mcp.json'), buildMcpJsonContent({ command: gone, args: ['--repo', '.'] }))
    const pending = (await service.pendingAgentFiles(produit)).find(f => f.path === '.mcp.json')
    expect(pending?.content).toContain(JSON.stringify(process.execPath))

    await fsP.writeFile(path.join(produit, '.mcp.json'), buildMcpJsonContent(launch))
    expect((await service.pendingAgentFiles(produit)).map(f => f.path)).not.toContain('.mcp.json')
  })
})
