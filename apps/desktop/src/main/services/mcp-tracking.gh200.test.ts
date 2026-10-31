import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CHANGE_STATUSES } from '@polenta/types'
import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'

// GH200 — outils MCP : `changesetId`, `unassigned`, verrou de l'approuvé (specs/GH200-tests.md U19–U20).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
      { name: 'nc', label: 'NC', prefix: 'NC', category: 'changeset', fields: [], statuses: DEFAULT_CHANGE_STATUSES },
    ],
  }],
  linkTypes: [],
}

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let git: GitService
let mcp: McpContainer
let tools: Record<string, Handler>

async function call(name: string, args: Record<string, unknown>) {
  const res = await tools[name](args)
  return JSON.parse(res.content[0].text)
}
const newChange = (title: string) => mcp.changes.create(dir, { objectTypeRef: 'root::nc', title, component: 'root' })
const toModifyIds = async (id: string) => (await mcp.changes.get(dir, id)).toModify.map(t => t.id)

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh200-mcp-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } }
  registerUpdateTools(server as never, mcp)
  registerBulkImportTools(server as never, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('bulk_import_requirements', () => {
  it('U19 : deux changesets ouverts sans changesetId → créés, listés dans unassigned', async () => {
    await newChange('A')
    await newChange('B')
    const res = await call('bulk_import_requirements', { entries: [{ objectTypeRef: 'root::exigence', title: 'R', fields: {} }], dryRun: false })
    expect(res.created.map((c: { id: string }) => c.id)).toEqual(['SYS-0001'])
    expect(res.unassigned).toEqual(['SYS-0001'])
  })

  it('changesetId par entrée : assigné, unassigned vide', async () => {
    await newChange('A')
    await newChange('B')
    const res = await call('bulk_import_requirements', {
      entries: [{ objectTypeRef: 'root::exigence', title: 'R', fields: {}, changesetId: 'NC-0002' }], dryRun: false,
    })
    expect(res.unassigned).toEqual([])
    expect(await toModifyIds('NC-0002')).toEqual(['SYS-0001'])
  })
})

describe('update_requirements', () => {
  it('U20 : titre d\'une exigence approuvée refusé', async () => {
    await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', status: 'approved', fields: {} } as never)
    const res = await call('update_requirements', { entries: [{ id: 'SYS-0001', title: 'X' }], dryRun: false })
    expect(res.errors[0].reason).toMatch(/approuvé/)
  })

  it('statut brouillon + titre : réouverture d\'abord, assignée au seul changeset', async () => {
    await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', status: 'approved', fields: {} } as never)
    await newChange('A')
    const res = await call('update_requirements', { entries: [{ id: 'SYS-0001', status: 'draft', title: 'X' }], dryRun: false })
    expect(res.errors).toEqual([])
    expect((await mcp.requirements.findOne(dir, 'SYS-0001')).title).toBe('X')
    expect(await toModifyIds('NC-0001')).toEqual(['SYS-0001'])
    expect(res.unassigned).toEqual([])
  })
})
