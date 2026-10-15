import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { contentHash, DashboardLibraryService } from './dashboard-library.service'
import { GitService } from './git.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { McpContainer } from '../../mcp-server/container'
import { libraryRelPath, registerSuiviScriptTools } from '../../mcp-server/tools/suivi-script.tools'

// GH74 — bibliothèque projet : chargement (repo ouvert + composants), cache, outils MCP
// (specs/GH74-tests.md L9, M1, M2, M7).

let ws: string
let root: string
let comp: string

const write = (repo: string, rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-lib-'))
  root = path.join(ws, 'produit')
  comp = path.join(ws, 'moteur')
  write(root, 'dashboards/lib/campaign.js', 'export const c = 1\n')
  write(root, 'dashboards/lib/sub/x.js', 'export const x = 2\n')
  write(root, 'dashboards/lib/polenta.d.ts', 'export {}\n')
  write(root, 'dashboards/DASHBOARD-0001/w1.js', 'export default () => []\n')
  write(comp, 'dashboards/lib/mesures.js', 'export const m = 3\n')
})
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }))

const tree = () => ({
  readCache: async () => ({ nodes: [{ name: 'produit', repoPath: root }, { name: 'moteur', repoPath: comp }] }),
}) as unknown as WorkspaceTreeService

describe('GH74 — DashboardLibraryService', () => {
  it('L9 — modules du repo ouvert (lib/…) et des composants (<composant>::lib/…)', async () => {
    const lib = await new DashboardLibraryService(new GitService(), tree()).load(root, ws)
    expect(Object.keys(lib.modules).sort()).toEqual(['lib/campaign.js', 'lib/sub/x.js', 'moteur::lib/mesures.js'])
    expect(lib.modules['moteur::lib/mesures.js']).toBe('export const m = 3\n')
  })

  it('sans workspace : le repo ouvert seulement', async () => {
    const lib = await new DashboardLibraryService(new GitService(), tree()).load(root)
    expect(Object.keys(lib.modules).sort()).toEqual(['lib/campaign.js', 'lib/sub/x.js'])
  })

  it('cache jusqu\'à invalidation d\'un repo du périmètre ; empreinte modifiée', async () => {
    const service = new DashboardLibraryService(new GitService(), tree())
    const a = await service.load(root, ws)
    write(comp, 'dashboards/lib/mesures.js', 'export const m = 4\n')
    expect((await service.load(root, ws)).hash).toBe(a.hash)
    service.invalidate(path.join(ws, 'ailleurs'))
    expect((await service.load(root, ws)).hash).toBe(a.hash)
    service.invalidate(comp)
    const b = await service.load(root, ws)
    expect(b.hash).not.toBe(a.hash)
    expect(b.modules['moteur::lib/mesures.js']).toBe('export const m = 4\n')
  })

  it('bibliothèque de départ : manifeste et fichiers livrés', () => {
    const service = new DashboardLibraryService(new GitService())
    const manifest = service.readShippedManifest()
    const campaign = manifest.files.find((f) => f.path === 'campaign.js')!
    expect(campaign.repoPath).toBe('dashboards/lib/campaign.js')
    expect(campaign.versions.at(-1)!.hash).toBe(contentHash(service.readShippedFile('campaign.js')))
  })

  it('contentHash : insensible aux fins de ligne et espaces de fin', () => {
    expect(contentHash('a  \r\nb\r\n')).toBe(contentHash('a\nb\n'))
    expect(contentHash('a\nb')).toBe(contentHash('a\nb\n\n'))
    expect(contentHash('a\nc\n')).not.toBe(contentHash('a\nb\n'))
  })
})

describe('GH74 — libraryRelPath', () => {
  it.each([
    ['campaign.js', 'campaign.js'],
    ['lib/campaign.js', 'campaign.js'],
    ['dashboards/lib/sub/x.js', 'sub/x.js'],
    ['sub\\x.js', 'sub/x.js'],
    ['../secret.js', null],
    ['sub/../../x.js', null],
    ['/abs.js', null],
    ['x.ts', null],
    ['moteur::lib/x.js', null],
    ['.cache/x.js', null],
  ])('%s → %s', (input, expected) => {
    expect(libraryRelPath(input)).toBe(expected)
  })
})

describe('GH74 — tools MCP du moteur de scripts', () => {
  type Handler = (dto: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>
  const handlers = new Map<string, { schema: Record<string, { parse(v: unknown): unknown }>; handler: Handler }>()
  const server = {
    registerTool: (name: string, config: { inputSchema: Record<string, { parse(v: unknown): unknown }> }, handler: Handler) => {
      handlers.set(name, { schema: config.inputSchema, handler })
    },
  } as unknown as McpServer

  async function call(name: string, dto: Record<string, unknown> = {}) {
    const tool = handlers.get(name)!
    const parsed = Object.fromEntries(Object.entries(tool.schema).map(([k, s]) => [k, s.parse(dto[k])]))
    const res = await tool.handler(parsed)
    return { isError: !!res.isError, text: res.content[0].text, json: (() => { try { return JSON.parse(res.content[0].text) } catch { return null } })() }
  }

  function container(branch = 'main') {
    const git = new GitService()
    vi.spyOn(git, 'currentBranch').mockResolvedValue(branch)
    const run = vi.fn(async () => ({ ok: true, columns: [], rows: [{ a: 1 }], total: 1, truncated: false, ms: 1 }))
    const c = {
      repoPath: root,
      workspaceDir: ws,
      git,
      workspaceTree: tree(),
      reqIndex: { invalidate: () => {} },
      testsIndex: { invalidate: () => {} },
      dashboardLibrary: new DashboardLibraryService(git, tree()),
      scriptEngine: { run },
    } as unknown as McpContainer
    registerSuiviScriptTools(server, c)
    return { c, run }
  }

  it('M1 — get_data_contract : types du graphe et conventions', async () => {
    container()
    const r = await call('get_data_contract')
    expect(r.json.contractVersion).toBe(1)
    expect(r.json.types).toContain('export interface PolentaGraph')
    expect(r.json.conventions.join('\n')).toContain('_ids')
  })

  it('M1b — list_templates : modèles de requête et de widget, avec leurs paramètres', async () => {
    container()
    const r = await call('list_templates')
    expect(r.json.queries.map((q: { id: string }) => q.id)).toEqual(['filtered-list', 'campaign-entries', 'campaign-timeline'])
    expect(r.json.widgets.map((w: { id: string }) => w.id)).toEqual(['bar', 'pie', 'line', 'kpi', 'table', 'matrix', 'stacked-area'])
    expect(r.json.widgets[0].params[0]).toMatchObject({ name: 'category', kind: 'column', required: true })
  })

  it('M2 — test_script : transmet le script, renvoie le résultat ou l\'erreur', async () => {
    const { run } = container()
    const ok = await call('test_script', { script: 'export default () => [{ a: 1 }]', transform: 'export default (r) => r', timezone: 'Europe/Paris' })
    expect(ok.json.rows).toEqual([{ a: 1 }])
    expect(run).toHaveBeenCalledWith(root, ws, expect.objectContaining({ script: 'export default () => [{ a: 1 }]', transform: 'export default (r) => r', limit: 200 }), { locale: 'fr', timezone: 'Europe/Paris' })
    run.mockResolvedValueOnce({ ok: false, error: { kind: 'runtime', message: 'boom', file: 'script.js', line: 2, column: 1 } } as never)
    const ko = await call('test_script', { script: 'x' })
    expect(ko.isError).toBe(true)
    expect(ko.text).toContain('SCRIPT_ERROR')
    expect(ko.text).toContain('"line":2')
  })

  it('GH93 — test_script : déclaration + valeurs (défauts, refus d\'une clé non déclarée)', async () => {
    const { run } = container()
    const parameters = [{ name: 'campaign', kind: 'campaign', label: 'Campagne' }, { name: 'lot', kind: 'text', label: 'Lot', default: 'L1' }]
    await call('test_script', { script: 'export default () => []', parameters, params: { campaign: 'CAMP-0002' } })
    expect(run).toHaveBeenLastCalledWith(root, ws, expect.objectContaining({ params: { campaign: 'CAMP-0002', lot: 'L1' } }), expect.anything())
    run.mockClear()
    const ko = await call('test_script', { script: 'export default () => []', params: { campaign: 'x' } })
    expect(ko.text).toContain('"kind":"params"')
    expect((await call('test_script', { script: 'x', parameters: [{ name: 'a', kind: 'enum', label: 'A' }] })).text).toContain('[PARAMS_INVALID]')
    expect(run).not.toHaveBeenCalled()
    expect((await call('get_data_contract')).json.conventions.join('\n')).toContain('polenta.params')
  })

  it('list_library / read_library_module', async () => {
    container()
    const list = await call('list_library')
    expect(list.json.modules.map((m: { key: string }) => m.key)).toEqual(['lib/campaign.js', 'lib/sub/x.js', 'moteur::lib/mesures.js'])
    expect(list.json.modules[0]).toMatchObject({ shippedId: 'campaign', shippedVersion: null, modified: true })
    expect((await call('read_library_module', { path: 'sub/x.js' })).json.content).toBe('export const x = 2\n')
    expect((await call('read_library_module', { path: 'moteur::lib/mesures.js' })).json.key).toBe('moteur::lib/mesures.js')
    expect((await call('read_library_module', { path: 'absent.js' })).text).toContain('LIBRARY_MODULE_NOT_FOUND')
  })

  it('M7 — write_library_module : chemin contrôlé, dryRun, branche en lecture seule', async () => {
    container()
    expect((await call('write_library_module', { path: '../../secret.js', content: 'x', dryRun: false })).text).toContain('LIBRARY_PATH_INVALID')
    const dry = await call('write_library_module', { path: 'nouveau.js', content: 'export const n = 1\n' })
    expect(dry.json).toMatchObject({ dryRun: true, path: 'dashboards/lib/nouveau.js' })
    expect(fs.existsSync(path.join(root, 'dashboards/lib/nouveau.js'))).toBe(false)
    const done = await call('write_library_module', { path: 'nouveau.js', content: 'export const n = 1\n', dryRun: false })
    expect(done.json).toEqual({ written: 'dashboards/lib/nouveau.js', key: 'lib/nouveau.js' })
    expect(fs.readFileSync(path.join(root, 'dashboards/lib/nouveau.js'), 'utf8')).toBe('export const n = 1\n')
    expect((await call('list_library')).json.modules.map((m: { key: string }) => m.key)).toContain('lib/nouveau.js')

    handlers.clear()
    container('prj-baseline')
    expect((await call('write_library_module', { path: 'autre.js', content: 'x', dryRun: false })).text).toContain('READONLY_BRANCH')
  })
})
