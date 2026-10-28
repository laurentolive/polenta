import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCase } from '@polenta/types'
import { GitService } from './git.service'
import { mergeFields } from './field-merge.util'
import { planUpdate } from './update-validation.util'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerParameterTools } from '../../mcp-server/tools/parameters.tools'

// GH150 — outils MCP update_requirements / update_tests et base de paramètres (scénarios de
// specs/GH150-tests.md). Vrai GitService sur un dossier temporaire, conteneur MCP réel ; les tools
// sont appelés par leur handler, capturé à l'enregistrement.

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        fields: [
          { name: 'priority', type: 'enum', values: ['high', 'low'], trackHistory: true },
          { name: 'statement', type: 'richtext', validator: 'EARS', required: true },
          { name: 'note', type: 'text' },
        ],
        statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
      },
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [{ name: 'note', type: 'text' }],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
    ],
  }],
  linkTypes: [{
    name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par',
    sourceRefs: ['test'], targetRefs: ['requirement'],
  }],
}

const EARS = 'THE system SHALL start'

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let git: GitService
let mcp: McpContainer
let tools: Record<string, Handler>

async function call(name: string, args: Record<string, unknown>) {
  const res = await tools[name](args)
  return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) }
}

const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh150-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } }
  registerUpdateTools(server as never, mcp)
  registerParameterTools(server as never, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

const newReq = (fields: Record<string, unknown> = { statement: EARS, priority: 'low', note: 'n' }) =>
  mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields } as never)
const newTest = () =>
  mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [{ order: 1, action: 'a', expectedResult: 'b' }] } as never)

describe('mergeFields', () => {
  it('remplace, ajoute, et retire les clés à null', () => {
    expect(mergeFields({ a: 1, b: 2 }, { b: 3, c: 4, a: null })).toEqual({ b: 3, c: 4 })
    expect(mergeFields(undefined, undefined)).toEqual({})
  })
})

describe('planUpdate', () => {
  const existing = { objectTypeRef: 'root::exigence', title: 'R', status: 'draft', fields: { statement: EARS, priority: 'low' } }
  const plan = (entry: Record<string, unknown>) => planUpdate(SCHEMA as never, 'requirement', existing, { id: 'SYS-0001', ...entry })

  it('E2 — statut inconnu', () => {
    expect(plan({ status: 'brouillon' })).toMatchObject({ ok: false, field: 'status' })
  })

  it('E3 — champ non déclaré, valeur d\'enum hors liste', () => {
    expect(plan({ fields: { inconnu: 'x' } })).toMatchObject({ ok: false, field: 'inconnu' })
    expect(plan({ fields: { priority: 'medium' } })).toMatchObject({ ok: false, field: 'priority' })
  })

  it('E4 — champ requis vidé, EARS non conforme', () => {
    expect(plan({ fields: { statement: null } })).toMatchObject({ ok: false, field: 'statement' })
    expect(plan({ fields: { statement: 'démarrer vite' } })).toMatchObject({ ok: false, field: 'statement' })
  })

  it('aperçu avant/après par champ, rien pour une valeur inchangée', () => {
    expect(plan({ title: 'R2', status: 'review', fields: { priority: 'high', statement: EARS } })).toEqual({
      ok: true,
      changes: {
        title: { before: 'R', after: 'R2' },
        'fields.priority': { before: 'low', after: 'high' },
        status: { before: 'draft', after: 'review' },
      },
    })
  })
})

describe('update_requirements', () => {
  it('U1 — dryRun : aucun fichier modifié, aperçu renvoyé', async () => {
    const req = await newReq()
    const before = await fsP.readFile(path.join(dir, `requirements/${req.id}.yaml`), 'utf-8')
    const { data } = await call('update_requirements', { entries: [{ id: req.id, title: 'Nouveau' }], dryRun: true })
    expect(data.preview).toEqual([{ index: 0, id: req.id, changes: { title: { before: 'R', after: 'Nouveau' } } }])
    expect(await fsP.readFile(path.join(dir, `requirements/${req.id}.yaml`), 'utf-8')).toBe(before)
  })

  it('U2/U3 — titre et champs écrits, clé à null retirée, historique source mcp', async () => {
    const req = await newReq()
    const { data } = await call('update_requirements', {
      entries: [{ id: req.id, title: 'R2', fields: { priority: 'high', note: null } }], dryRun: false,
    })
    expect(data.errors).toEqual([])
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.title).toBe('R2')
    expect(file.fields).toEqual({ statement: EARS, priority: 'high' })
    expect(file.history?.priority?.at(-1)).toMatchObject({ value: 'high', by: 'alice', source: 'mcp' })
  })

  it('U4/U5 — approved → draft avec un champ : version +1, lié marqué, champs puis statut', async () => {
    const req = await newReq()
    const tc = await newTest()
    await mcp.workspaceLinks.createLinks(dir, [{ type: 'verification', sourceId: tc.id, targetId: req.id }], 'mcp')
    await mcp.requirements.transition(dir, req.id, { toStatus: 'approved' })

    const { data } = await call('update_requirements', {
      entries: [{ id: req.id, status: 'draft', fields: { priority: 'high' } }], dryRun: false,
    })
    expect(data.updated).toEqual([{ index: 0, id: req.id, version: 2, changed: true }])
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.status).toBe('draft')
    expect(file.fields.priority).toBe('high')
    expect(file.history?.status.map(e => e.value)).toEqual(['draft', 'approved', 'draft'])
    expect((await onDisk<TestCase>(`tests/${tc.id}.yaml`)).needsRevalidation).toBe(true)
  })

  it('E1 — ID inconnu : erreur sur l\'entrée, les autres passent', async () => {
    const req = await newReq()
    const { data } = await call('update_requirements', {
      entries: [{ id: 'SYS-9999', title: 'x' }, { id: req.id, title: 'ok' }], dryRun: false,
    })
    expect(data.summary).toEqual({ total: 2, ok: 1, failed: 1 })
    expect(data.errors[0]).toMatchObject({ index: 0, id: 'SYS-9999' })
  })

  it('E6 — entries vide', async () => {
    const { data } = await call('update_requirements', { entries: [], dryRun: false })
    expect(data.summary).toEqual({ total: 0, ok: 0, failed: 0 })
  })
})

describe('update_tests', () => {
  it('U6 — étapes remplacées et statut changé', async () => {
    const tc = await newTest()
    const steps = [{ order: 1, action: 'x', expectedResult: 'y', notes: null }]
    const { data } = await call('update_tests', { entries: [{ id: tc.id, steps, status: 'approved' }], dryRun: false })
    expect(data.errors).toEqual([])
    const file = await onDisk<TestCase>(`tests/${tc.id}.yaml`)
    expect(file.steps).toEqual(steps)
    expect(file.status).toBe('approved')
  })
})

describe('paramètres', () => {
  it('P1/P2 — set_parameters crée puis modifie, fichier trié, list_parameters compte les usages', async () => {
    await call('set_parameters', { entries: [{ name: 'vmax', value: '12', unit: 'V' }, { name: 'imax', value: '3' }], dryRun: false })
    await newReq({ statement: 'THE system SHALL limit to {vmax}', priority: 'low' })
    await call('set_parameters', { entries: [{ name: 'imax', value: '4', unit: 'A' }], dryRun: false })

    const file = await fsP.readFile(path.join(dir, 'parameters/parameters.yaml'), 'utf-8')
    expect(file.indexOf('imax')).toBeLessThan(file.indexOf('vmax'))
    const { data } = await call('list_parameters', {})
    expect(data[0].parameters).toEqual([
      { name: 'imax', value: '4', unit: 'A', usageCount: 0 },
      { name: 'vmax', value: '12', unit: 'V', usageCount: 1 },
    ])
  })

  it('P3 — valeur changée d\'un paramètre utilisé par une exigence approuvée : marquée', async () => {
    await call('set_parameters', { entries: [{ name: 'vmax', value: '12' }], dryRun: false })
    const req = await newReq({ statement: 'THE system SHALL limit to {vmax}', priority: 'low' })
    await mcp.requirements.transition(dir, req.id, { toStatus: 'approved' })

    const dry = await call('set_parameters', { entries: [{ name: 'vmax', value: '14' }], dryRun: true })
    expect(dry.data.preview[0]).toMatchObject({ action: 'update', wouldMark: [req.id] })
    const { data } = await call('set_parameters', { entries: [{ name: 'vmax', value: '14' }], dryRun: false })
    expect(data.written[0].marked).toContain(req.id)
  })

  it('P4/P5 — delete_parameter : supprimé si inutilisé, refusé sinon', async () => {
    await call('set_parameters', { entries: [{ name: 'libre', value: '1' }, { name: 'pris', value: '2' }], dryRun: false })
    await newReq({ statement: 'THE system SHALL use {pris}', priority: 'low' })

    expect((await call('delete_parameter', { name: 'libre' })).data).toMatchObject({ deleted: true })
    const refused = await call('delete_parameter', { name: 'pris' })
    expect(refused.data.deleted).toBe(false)
    expect(refused.data.usages).toHaveLength(1)
  })

  it('P6/P7 — nom invalide, repo inconnu', async () => {
    const { data } = await call('set_parameters', { entries: [{ name: 'a b', value: '1' }], dryRun: false })
    expect(data.errors[0]).toMatchObject({ index: 0, name: 'a b' })
    expect((await call('set_parameters', { repo: 'inconnu', entries: [], dryRun: true })).isError).toBe(true)
  })
})
