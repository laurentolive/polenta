import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerSchemaMutationTools } from '../../mcp-server/tools/schema-mutation.tools'
import { registerValidationTools } from '../../mcp-server/tools/validations.tools'
import { registerVersionTools } from '../../mcp-server/tools/versions.tools'
import { DEFAULT_VALIDATION_DECISIONS, DEFAULT_VALIDATION_STATUSES, DEFAULT_VERSION_STATUSES } from '../../renderer/components/schema/objectTypeEditor'

// GH377 — `add_object_type` crée un type version ou validation (scénarios de specs/GH377-tests.md).
// Conteneur MCP réel sur un vrai repo git ; l'entrée passe par le schéma zod de l'outil, comme avec le SDK.

const SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
    ],
    children: [{ name: 'moteur', label: 'Moteur', objectTypes: [] }],
  }],
}

type ToolResult = { isError?: boolean; content: Array<{ text: string }> }
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

let dir: string
let mcp: McpContainer
let tools: Record<string, Handler>
let tick = 0
const T0 = Date.UTC(2026, 10, 16) / 1000
const schemaFile = () => path.join(dir, '.polenta', 'schema.yaml')

async function commitAll(message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any

const addType = (objectType: Record<string, unknown>, nodeName = 'root') => tools.add_object_type({ nodeName, objectType })
const typeOf = (schema: ProjectSchema, name: string) => schema.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === name)!

/** Refus : `[code]`, et `.polenta/schema.yaml` inchangé octet pour octet. */
async function expectRefused(objectType: Record<string, unknown>, code: string, nodeName = 'root') {
  const before = await fsP.readFile(schemaFile())
  const res = await addType(objectType, nodeName)
  expect(res.isError).toBe(true)
  expect(res.content[0].text).toMatch(new RegExp(`^\\[${code}\\]`))
  expect((await fsP.readFile(schemaFile())).equals(before)).toBe(true)
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh377-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'user.name', value: 'Alice' })
  await git.setConfig({ fs, dir, path: 'user.email', value: 'a@x' })
  await new GitService().writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = {
    registerTool: (name: string, def: { inputSchema: z.ZodRawShape }, handler: Handler) => {
      tools[name] = (args) => handler(z.object(def.inputSchema).parse(args))
    },
  } as never
  registerSchemaMutationTools(server, mcp)
  registerVersionTools(server, mcp)
  registerValidationTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('création des types version et validation (nominaux)', () => {
  it('version sans statuts : défauts de l\'éditeur, puis create_version (1)', async () => {
    const schema = await call<ProjectSchema>('add_object_type', { nodeName: 'root', objectType: { name: 'version', prefix: 'PV', category: 'version' } })
    expect(typeOf(schema, 'version').statuses).toEqual([
      { name: 'en_cours', label: 'En cours', color: '#2563eb' },
      { name: 'released', label: 'Released', color: '#16a34a', isApproval: true },
      { name: 'abandonnee', label: 'Abandonnée', color: '#6b7280', isTerminal: true },
    ])
    expect(await fsP.readFile(schemaFile(), 'utf8')).toContain('name: released')
    const v = await call<{ id: string; status: string }>('create_version', { title: '1.0' })
    expect(v.id).toMatch(/^PV-/)
    expect(v.status).toBe('en_cours')
  })

  it('validation sans statuts ni décisions : défauts, puis create_validation sur une version released (2)', async () => {
    await call('add_object_type', { nodeName: 'root', objectType: { name: 'version', prefix: 'PV', category: 'version' } })
    const schema = await call<ProjectSchema>('add_object_type', { nodeName: 'root', objectType: { name: 'washer_val', prefix: 'WASHER_VAL', category: 'validation' } })
    const type = typeOf(schema, 'washer_val')
    expect(type.statuses!.map(s => s.name)).toEqual(['en_cours', 'signee', 'annulee'])
    expect(type.decisions).toEqual([
      { name: 'en_attente', label: 'En attente', isPending: true },
      { name: 'conforme', label: 'Conforme' },
      { name: 'non_conforme', label: 'Non conforme', proposesIssue: true },
      { name: 'hors_scope', label: 'Hors scope' },
      { name: 'derogation', label: 'Dérogation', proposesIssue: true },
    ])
    const req = (await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: {} } as never)).id
    await commitAll('éléments')
    const v = await call<{ id: string }>('create_version', { title: '1.0' })
    await call('include_in_version', { id: v.id, elementIds: [req] })
    await call('release_version', { id: v.id, tag: 'produit-1.0' })
    const val = await call<{ id: string; status: string }>('create_validation', { versionId: v.id, title: 'Validation 1.0' })
    expect(val.id).toMatch(/^WASHER_VAL-/)
    expect(val.status).toBe('en_cours')
  })

  it('statuts et décisions fournis : pris tels quels, sans fusion (3)', async () => {
    const statuses = [{ name: 'ouverte' }, { name: 'ok', isApproval: true }, { name: 'ko', isTerminal: true }]
    const decisions = [{ name: 'tbd', isPending: true }, { name: 'go' }]
    const schema = await call<ProjectSchema>('add_object_type', { nodeName: 'root', objectType: { name: 'val', prefix: 'VAL', category: 'validation', statuses, decisions } })
    expect(typeOf(schema, 'val').statuses).toEqual(statuses)
    expect(typeOf(schema, 'val').decisions).toEqual(decisions)
    const v = await call<ProjectSchema>('add_object_type', { nodeName: 'root', objectType: { name: 'ver', prefix: 'VER', category: 'version', statuses: [{ name: 'a' }, { name: 'b', isApproval: true }] } })
    expect(typeOf(v, 'ver').statuses).toEqual([{ name: 'a' }, { name: 'b', isApproval: true }])
  })

  it('entryFields : sans trackHistory ni defaultVisible, requiredWhen sur une décision par défaut accepté (4)', async () => {
    const schema = await call<ProjectSchema>('add_object_type', {
      nodeName: 'root', objectType: {
        name: 'val', prefix: 'VAL', category: 'validation', entryFields: [
          { name: 'justification', type: 'textarea', trackHistory: true, defaultVisible: true, requiredWhen: { decision: ['non_conforme'] } },
          { name: 'gravite', type: 'enum', values: ['mineure', 'majeure'] },
          { name: 'analyse', type: 'text', requiredWhen: { gravite: ['majeure'] } },
        ],
      },
    })
    expect(typeOf(schema, 'val').entryFields).toEqual([
      { name: 'justification', type: 'textarea', requiredWhen: { decision: ['non_conforme'] } },
      { name: 'gravite', type: 'enum', values: ['mineure', 'majeure'] },
      { name: 'analyse', type: 'text', requiredWhen: { gravite: ['majeure'] } },
    ])
  })
})

describe('refus, sans écriture', () => {
  const val = (extra: Record<string, unknown> = {}) => ({ name: 'val', prefix: 'VAL', category: 'validation', ...extra })
  const ver = (extra: Record<string, unknown> = {}) => ({ name: 'ver', prefix: 'VER', category: 'version', ...extra })

  it('type validation mal formé (5)', async () => {
    await expectRefused(val({ decisions: [{ name: 'a', isPending: true }, { name: 'b', isPending: true }] }), 'VALIDATION_TYPE_INVALID')
    await expectRefused(val({ decisions: [] }), 'VALIDATION_TYPE_INVALID')
    await expectRefused(val({ statuses: [{ name: 'a' }, { name: 'b', isTerminal: true }] }), 'VALIDATION_TYPE_INVALID')
    await expectRefused(val({ statuses: [{ name: 's', isApproval: true }, { name: 'b', isTerminal: true }] }), 'VALIDATION_TYPE_INVALID')
    await expectRefused(val({ trackStatusHistory: false }), 'VALIDATION_TYPE_INVALID')
  })

  it('type version sans ou avec deux statuts released (6)', async () => {
    await expectRefused(ver({ statuses: [{ name: 'a' }] }), 'VERSION_TYPE_INVALID')
    await expectRefused(ver({ statuses: [] }), 'VERSION_TYPE_INVALID')
    await expectRefused(ver({ statuses: [{ name: 'a', isApproval: true }, { name: 'b', isApproval: true }] }), 'VERSION_TYPE_INVALID')
  })

  it('second type, ou déclaration sur un composant local (7)', async () => {
    await expectRefused(ver(), 'VERSION_TYPE_INVALID', 'moteur')
    await expectRefused(val(), 'VALIDATION_TYPE_INVALID', 'moteur')
    await call('add_object_type', { nodeName: 'root', objectType: ver() })
    await call('add_object_type', { nodeName: 'root', objectType: val() })
    await expectRefused(ver({ name: 'ver2', prefix: 'VER2' }), 'VERSION_TYPE_INVALID')
    await expectRefused(val({ name: 'val2', prefix: 'VAL2' }), 'VALIDATION_TYPE_INVALID')
  })

  it('préfixe absent ou vide (8)', async () => {
    await expectRefused({ name: 'ver', category: 'version' }, 'VERSION_TYPE_INVALID')
    await expectRefused(val({ prefix: '  ' }), 'VALIDATION_TYPE_INVALID')
  })

  it('entryFields invalides (9)', async () => {
    await expectRefused(val({ entryFields: [{ name: 'decision', type: 'text' }] }), 'FIELD_NAME_TAKEN')
    await expectRefused(val({ entryFields: [{ name: 'a', type: 'text' }, { name: 'a', type: 'textarea' }] }), 'FIELD_NAME_TAKEN')
    await expectRefused(val({ entryFields: [{ name: 'a', type: 'text', requiredWhen: { decision: ['inconnue'] } }] }), 'REQUIRED_WHEN_INVALID')
    await expectRefused(val({ entryFields: [{ name: 'a', type: 'text', requiredWhen: { absent: ['x'] } }] }), 'REQUIRED_WHEN_INVALID')
  })

  it('decisions ou entryFields hors type validation (10)', async () => {
    await expectRefused({ name: 'e2', prefix: 'E2', category: 'requirement', decisions: [{ name: 'a', isPending: true }] }, 'VALIDATION_TYPE_INVALID')
    await expectRefused({ name: 'e2', prefix: 'E2', category: 'requirement', entryFields: [] }, 'VALIDATION_TYPE_INVALID')
    await expectRefused(ver({ decisions: [{ name: 'a', isPending: true }] }), 'VALIDATION_TYPE_INVALID')
  })
})

describe('non-régression', () => {
  it('type requirement sans statuts : écrit sans statuts (11)', async () => {
    const schema = await call<ProjectSchema>('add_object_type', { nodeName: 'root', objectType: { name: 'exi2', prefix: 'EX2', category: 'requirement' } })
    const type: ObjectTypeDefinition = typeOf(schema, 'exi2')
    expect(type.statuses).toBeUndefined()
    expect(type.decisions).toBeUndefined()
  })

  it('l\'éditeur garde les mêmes défauts (12)', () => {
    const editable = (name: string, label: string, color: string, isApproval = false, isTerminal = false) => ({ name, label, color, isApproval, isTerminal })
    expect(DEFAULT_VERSION_STATUSES).toEqual([
      editable('en_cours', 'En cours', '#2563eb'), editable('released', 'Released', '#16a34a', true), editable('abandonnee', 'Abandonnée', '#6b7280', false, true),
    ])
    expect(DEFAULT_VALIDATION_STATUSES).toEqual([
      editable('en_cours', 'En cours', '#2563eb'), editable('signee', 'Signée', '#16a34a', true), editable('annulee', 'Annulée', '#6b7280', false, true),
    ])
    expect(DEFAULT_VALIDATION_DECISIONS.map(d => d.name)).toEqual(['en_attente', 'conforme', 'non_conforme', 'hors_scope', 'derogation'])
  })
})
