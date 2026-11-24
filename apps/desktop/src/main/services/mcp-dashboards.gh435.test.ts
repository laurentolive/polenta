import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { z } from 'zod'
import { TestRepo } from '../git/test-repo.test-util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerDashboardTools } from '../../mcp-server/tools/dashboards.tools'

// GH435 — dimensions des widgets par le MCP (specs/GH435-tests.md U11). Conteneur MCP réel sur un vrai
// repo git ; handlers appelés comme le ferait le SDK. `add_widget` exécute la requête dans le worker de
// scripts (non lancé ici) : son écriture est couverte au niveau du service (dashboards-size.gh435.test.ts),
// ses bornes par le schéma.

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>
interface Def { inputSchema: z.ZodRawShape }

let dir: string
let mcp: McpContainer
let tools: Record<string, Handler>
let defs: Record<string, Def>
const SPEC = '{ "data": { "name": "rows" }, "mark": "bar" }'

const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const yamlOf = (id: string) => fsP.readFile(path.join(dir, 'dashboards', id, 'dashboard.yaml'), 'utf8')

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh435-mcp-'))
  const repo = await TestRepo.init(dir, 'main')
  await repo.setConfig('user.name', 'Alice')
  await repo.setConfig('user.email', 'a@x')
  await new GitService().writeYaml(dir, '.polenta/schema.yaml', { version: 1, linkTypes: [], nodes: [{ name: 'root', label: 'Produit', objectTypes: [] }] })
  await repo.commitAll('schéma', { name: 'Alice', email: 'a@x', timestamp: Date.UTC(2026, 10, 24) / 1000 })
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  defs = {}
  const server = { registerTool: (name: string, def: Def, handler: Handler) => { tools[name] = handler; defs[name] = def } } as never
  registerDashboardTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('GH435 — dimensions par le MCP', () => {
  it('schémas : width 240 à 1104, height 160 à 720, entiers ; update accepte null', () => {
    const add = z.object(defs.add_widget.inputSchema)
    const base = { dashboardId: 'DASHBOARD-0001', title: 'W', queryId: 'QUERY-0001', spec: SPEC }
    for (const ok of [{ width: 240 }, { width: 1104 }, { height: 160 }, { height: 720 }, { width: 700, height: 320 }, {}]) {
      expect(add.safeParse({ ...base, ...ok }).success, JSON.stringify(ok)).toBe(true)
    }
    for (const bad of [{ width: 239 }, { width: 1105 }, { height: 159 }, { height: 721 }, { width: 700.5 }, { height: '320' }, { width: null }]) {
      expect(add.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false)
    }
    const update = z.object(defs.update_widget.inputSchema)
    const ref = { dashboardId: 'DASHBOARD-0001', widgetId: 'w1' }
    expect(update.safeParse({ ...ref, width: null, height: null }).success).toBe(true)
    expect(update.safeParse({ ...ref, width: 5000 }).success).toBe(false)
    expect(update.safeParse({ ...ref, height: 10 }).success).toBe(false)
  })

  it('update_widget : aperçu sans écriture, écriture, retrait par null ; list_dashboards les renvoie', async () => {
    const d = await mcp.dashboards.create(dir, 'alice', { title: 'Suivi', scope: 'shared', createdBy: 'alice' })
    const widgetId = (await mcp.dashboards.addWidget(dir, 'alice', d.id, { title: 'W', queryId: 'QUERY-0001', size: 'md', spec: SPEC })).widgets[0].id
    const before = await yamlOf(d.id)

    // dryRun : l'aperçu porte les dimensions, rien n'est écrit (le défaut `true` vient du schéma zod, que le
    // SDK applique et que ce test, qui appelle le handler directement, n'applique pas).
    const preview = await call('update_widget', { dashboardId: d.id, widgetId, width: 700, height: 320, dryRun: true })
    expect(preview).toMatchObject({ dryRun: true, widget: { width: 700, height: 320 } })
    expect(await yamlOf(d.id)).toBe(before)

    const written = await call('update_widget', { dashboardId: d.id, widgetId, width: 700, height: 320, dryRun: false })
    expect(written.widget).toMatchObject({ size: 'md', width: 700, height: 320 })
    expect(await yamlOf(d.id)).toMatch(/width: 700/)

    const listed = await call<{ dashboards: Array<{ widgets: Array<{ width?: number; height?: number }> }> }>('list_dashboards')
    expect(listed.dashboards[0].widgets[0]).toMatchObject({ width: 700, height: 320 })

    // height seule retirée par null ; width conservée.
    const cleared = await call('update_widget', { dashboardId: d.id, widgetId, height: null, dryRun: false })
    expect(cleared.widget).toMatchObject({ width: 700 })
    expect('height' in cleared.widget).toBe(false)
    expect(await yamlOf(d.id)).not.toMatch(/height/)

    // Aperçu d'un retrait de width : le widget candidat n'a plus de width, le fichier garde la sienne.
    const dry = await call('update_widget', { dashboardId: d.id, widgetId, width: null, dryRun: true })
    expect('width' in dry.widget).toBe(false)
    expect(await yamlOf(d.id)).toMatch(/width: 700/)
  })
})
