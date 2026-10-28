import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCase } from '@polenta/types'
import { applyHistory } from '@polenta/types'
import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'

// GH163 — commentaire de modification conservé sur les entrées d'historique créées par l'écriture
// (specs/GH163.md, décisions du 28/10).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'priority', type: 'enum', values: ['high', 'low'], trackHistory: true }, { name: 'note', type: 'text' }],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
    ],
  }],
  linkTypes: [],
}

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

let dir: string
let git: GitService
let mcp: McpContainer
let tools: Record<string, Handler>

const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>
const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await tools[name](args)).content[0].text)

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh163-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  registerUpdateTools({ registerTool: (n: string, _d: unknown, h: Handler) => { tools[n] = h } } as never, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

const newReq = () => mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: { priority: 'low' } } as never)

describe('applyHistory', () => {
  it('commentaire posé sur les entrées créées, pas sur une entrée vide de commentaire', () => {
    const typeDef = SCHEMA.nodes[0].objectTypes[0] as never
    const before = { status: 'draft', fields: { priority: 'low' }, history: { status: [{ value: 'draft', at: 'x' }] } }
    const after = applyHistory(before, { ...before, status: 'approved' }, typeDef, { by: 'bob', comment: '  revue OK ' }, new Date('2026-10-28T10:00:00Z'))
    expect(after.history?.status.at(-1)).toEqual({ value: 'approved', at: '2026-10-28T10:00:00Z', by: 'bob', comment: 'revue OK' })
    const blank = applyHistory(before, { ...before, status: 'approved' }, typeDef, { by: 'bob', comment: '  ' }, new Date())
    expect(blank.history?.status.at(-1)).not.toHaveProperty('comment')
  })
})

describe('services', () => {
  it('1 — approved → draft avec commentaire (transition) : entrée history.status commentée', async () => {
    const req = await newReq()
    await mcp.requirements.transition(dir, req.id, { toStatus: 'approved' })
    await mcp.requirements.transition(dir, req.id, { toStatus: 'draft', comment: 'retour client' })
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.status.at(-1)).toMatchObject({ value: 'draft', comment: 'retour client' })
    expect(file.history?.status.at(-2)).not.toHaveProperty('comment')
  })

  it('« Repasser en brouillon » (openDraft) et test (update) : commentaire conservé', async () => {
    const req = await newReq()
    await mcp.requirements.transition(dir, req.id, { toStatus: 'approved' })
    await mcp.requirements.openDraft(dir, req.id, 'draft', undefined, 'à reprendre')
    expect((await onDisk<Requirement>(`requirements/${req.id}.yaml`)).history?.status.at(-1)).toMatchObject({ comment: 'à reprendre' })

    const tc = await mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [] } as never)
    await mcp.tests.update(dir, tc.id, { status: 'approved', modificationComment: 'validé' })
    expect((await onDisk<TestCase>(`tests/${tc.id}.yaml`)).history?.status.at(-1)).toMatchObject({ value: 'approved', comment: 'validé' })
  })

  it('5 — sans commentaire : aucune clé comment écrite', async () => {
    const req = await newReq()
    await mcp.requirements.transition(dir, req.id, { toStatus: 'approved' })
    const raw = await fsP.readFile(path.join(dir, `requirements/${req.id}.yaml`), 'utf-8')
    expect(raw).not.toContain('comment')
  })
})

describe('update_requirements (MCP)', () => {
  it('3 — modificationComment sur les entrées créées (champ suivi et statut)', async () => {
    const req = await newReq()
    const res = await call('update_requirements', {
      entries: [{ id: req.id, status: 'approved', fields: { priority: 'high' }, modificationComment: 'arbitrage' }], dryRun: false,
    })
    expect(res.updated[0]).not.toHaveProperty('warning')
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.priority.at(-1)).toMatchObject({ value: 'high', comment: 'arbitrage', source: 'mcp' })
    expect(file.history?.status.at(-1)).toMatchObject({ value: 'approved', comment: 'arbitrage' })
  })

  it('2 — commentaire sans changement suivi : avertissement, rien de conservé', async () => {
    const req = await newReq()
    const res = await call('update_requirements', {
      entries: [{ id: req.id, fields: { note: 'texte libre' }, modificationComment: 'perdu' }], dryRun: false,
    })
    expect(res.errors).toEqual([])
    expect(res.updated[0].warning).toMatch(/non conservé/)
  })
})
