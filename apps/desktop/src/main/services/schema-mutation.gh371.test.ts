import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { GitService } from './git.service'
import { createMcpContainer } from '../../mcp-server/container'
import { registerSchemaMutationTools } from '../../mcp-server/tools/schema-mutation.tools'

// GH371 — outils MCP de modification d'un type existant (scénarios de specs/GH371-tests.md).
// Conteneur MCP réel sur un dossier temporaire, handlers appelés comme le SDK (zod champ par champ).

const SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [
    {
      name: 'root', label: 'Produit', objectTypes: [
        {
          name: 'exigence', prefix: 'REQ', category: 'requirement',
          fields: [
            { name: 'justif', type: 'text', requiredWhen: { status: ['review'] } },
            { name: 'ref', type: 'text' },
            { name: 'desc', type: 'richtext' },
          ],
          statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
          transitions: [{ from: 'draft', to: 'review', requires: { fieldsFilled: 'warn' } }],
        },
        { name: 'test', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'ready' }] },
        { name: 'campagne', prefix: 'CMP', category: 'campaign', fields: [] },
        {
          name: 'version', prefix: 'PV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
        },
        {
          name: 'validation', prefix: 'VAL', category: 'validation', fields: [],
          statuses: [{ name: 'en_cours' }, { name: 'signee', isApproval: true }, { name: 'annulee', isTerminal: true }],
          decisions: [
            { name: 'en_attente', isPending: true },
            { name: 'conforme', label: 'Conforme', color: '#0a0' },
            { name: 'refuse' },
            { name: 'non_conforme', proposesIssue: true },
          ],
          entryFields: [{ name: 'motif', type: 'text', requiredWhen: { decision: ['non_conforme'] } }],
        },
      ],
    },
    { name: 'lecture', label: 'Lecture', readonly: true, objectTypes: [{ name: 'ext', prefix: 'EXT', category: 'requirement', fields: [], statuses: [{ name: 'a' }, { name: 'b' }] }] },
  ],
}

const validationFile = (id: string, status: string, decision: string, proposed = false) => ({
  id, objectTypeRef: 'root::validation', title: id, status, versionId: 'PV-0001', fields: {},
  entries: [{ requirementId: 'REQ-0001', decision, contentHash: 'h', ...(proposed && { proposed: true }) }],
})

let dir: string
let git: GitService
type Tool = { schema: Record<string, { parse(v: unknown): unknown }>; handler: (dto: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }
let tools: Map<string, Tool>

/** Valide le dto comme le SDK MCP (champ par champ du schéma d'entrée) puis appelle le tool. */
async function raw(name: string, dto: Record<string, unknown>) {
  const tool = tools.get(name)!
  const parsed = Object.fromEntries(Object.entries(tool.schema).map(([k, s]) => [k, s.parse(dto[k])]).filter(([, v]) => v !== undefined))
  return tool.handler(parsed)
}
/** Succès : réponse JSON ; refus : `[CODE] message`. */
async function call<T = ProjectSchema>(name: string, dto: Record<string, unknown>): Promise<T> {
  const res = await raw(name, dto)
  if (res.isError) throw new Error(res.content[0].text)
  return JSON.parse(res.content[0].text) as T
}
const schemaBytes = () => fsP.readFile(path.join(dir, '.polenta', 'schema.yaml'), 'utf-8')
const onDiskSchema = async () => yaml.load(await schemaBytes()) as ProjectSchema
const typeOnDisk = async (name: string, node = 'root') =>
  (await onDiskSchema()).nodes.find(n => n.name === node)!.objectTypes!.find(t => t.name === name)! as ObjectTypeDefinition

/** Refus attendu, sans aucune écriture du schéma. */
async function expectRefused(name: string, dto: Record<string, unknown>, code: string, also?: RegExp): Promise<string> {
  const before = await schemaBytes()
  const res = await raw(name, dto)
  expect(res.isError, res.content[0].text).toBe(true)
  expect(res.content[0].text).toMatch(new RegExp(`^\\[${code}\\]`))
  if (also) expect(res.content[0].text).toMatch(also)
  expect(await schemaBytes()).toBe(before)
  return res.content[0].text
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh371-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await git.writeYaml(dir, 'validations/VAL-0001.yaml', validationFile('VAL-0001', 'en_cours', 'conforme', true))
  await git.writeYaml(dir, 'validations/VAL-0002.yaml', validationFile('VAL-0002', 'signee', 'refuse'))
  tools = new Map()
  const server = { registerTool: (name: string, config: { inputSchema: Tool['schema'] }, handler: Tool['handler']) => { tools.set(name, { schema: config.inputSchema, handler }) } } as unknown as McpServer
  registerSchemaMutationTools(server, createMcpContainer(dir))
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('A — add_field entryFields', () => {
  it('A1/A5 — ajoute en fin d\'entryFields, requiredWhen sur une décision connue accepté', async () => {
    await call('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'commentaire_qualite', type: 'text', requiredWhen: { decision: ['conforme'] } } })
    expect((await typeOnDisk('validation')).entryFields!.map(f => f.name)).toEqual(['motif', 'commentaire_qualite'])
  })

  it('A2 — type requirement : VALIDATION_TYPE_INVALID, schéma inchangé', async () => {
    await expectRefused('add_field', { nodeName: 'root', typeName: 'exigence', list: 'entryFields', field: { name: 'x', type: 'text' } }, 'VALIDATION_TYPE_INVALID')
  })

  it('A3 — nom réservé `decision` ou déjà présent : FIELD_NAME_TAKEN', async () => {
    await expectRefused('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'decision', type: 'text' } }, 'FIELD_NAME_TAKEN')
    await expectRefused('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'motif', type: 'text' } }, 'FIELD_NAME_TAKEN')
  })

  it('A4 — décision ou champ de référence inconnus : REQUIRED_WHEN_INVALID', async () => {
    await expectRefused('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'x', type: 'text', requiredWhen: { decision: ['inconnue'] } } }, 'REQUIRED_WHEN_INVALID')
    await expectRefused('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'x', type: 'text', requiredWhen: { autre: ['v'] } } }, 'REQUIRED_WHEN_INVALID')
  })

  it('A6 — list absent : champ de l\'objet, comme avant', async () => {
    await call('add_field', { nodeName: 'root', typeName: 'validation', field: { name: 'obs', type: 'text' } })
    const t = await typeOnDisk('validation')
    expect(t.fields.map(f => f.name)).toEqual(['obs'])
    expect(t.entryFields!.map(f => f.name)).toEqual(['motif'])
  })
})

describe('B — décisions', () => {
  it('B1 — add_decision ajoute en fin (proposesIssue conservé, isPending false non écrit)', async () => {
    await call('add_decision', { nodeName: 'root', typeName: 'validation', decision: { name: 'reserve', proposesIssue: true, isPending: false } })
    const d = (await typeOnDisk('validation')).decisions!
    expect(d.at(-1)).toEqual({ name: 'reserve', proposesIssue: true })
  })

  it('B2 — seconde décision en attente ; nom pris', async () => {
    await expectRefused('add_decision', { nodeName: 'root', typeName: 'validation', decision: { name: 'x', isPending: true } }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('add_decision', { nodeName: 'root', typeName: 'validation', decision: { name: 'conforme' } }, 'DECISION_NAME_TAKEN')
  })

  it('B3 — isPending déplace la marque sur une décision non utilisée', async () => {
    await call('update_decision', { nodeName: 'root', typeName: 'validation', name: 'non_conforme', isPending: true })
    const d = (await typeOnDisk('validation')).decisions!
    expect(d.filter(x => x.isPending).map(x => x.name)).toEqual(['non_conforme'])
    expect(d.find(x => x.name === 'en_attente')).toEqual({ name: 'en_attente' })
  })

  it('B4 — isPending sur une décision portée par une entrée proposée : DECISION_IN_USE', async () => {
    await expectRefused('update_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme', isPending: true }, 'DECISION_IN_USE', /VAL-0001/)
  })

  it('B5 — renommer une décision portée par une validation signée : DECISION_IN_USE, aucun fichier modifié', async () => {
    const val = await fsP.readFile(path.join(dir, 'validations', 'VAL-0002.yaml'), 'utf-8')
    await expectRefused('update_decision', { nodeName: 'root', typeName: 'validation', name: 'refuse', to: 'rejet' }, 'DECISION_IN_USE', /VAL-0002/)
    expect(await fsP.readFile(path.join(dir, 'validations', 'VAL-0002.yaml'), 'utf-8')).toBe(val)
  })

  it('B6 — renommer une décision libre : schéma et requiredWhen des entryFields réécrits, validations intactes', async () => {
    const vals = await Promise.all(['VAL-0001', 'VAL-0002'].map(id => fsP.readFile(path.join(dir, 'validations', `${id}.yaml`), 'utf-8')))
    await call('update_decision', { nodeName: 'root', typeName: 'validation', name: 'non_conforme', to: 'refus_qualite' })
    const t = await typeOnDisk('validation')
    expect(t.decisions!.map(d => d.name)).toEqual(['en_attente', 'conforme', 'refuse', 'refus_qualite'])
    expect(t.decisions![3]).toEqual({ name: 'refus_qualite', proposesIssue: true })
    expect(t.entryFields![0].requiredWhen).toEqual({ decision: ['refus_qualite'] })
    expect(await Promise.all(['VAL-0001', 'VAL-0002'].map(id => fsP.readFile(path.join(dir, 'validations', `${id}.yaml`), 'utf-8')))).toEqual(vals)
  })

  it('B7 — nom cible pris ; décision inconnue', async () => {
    await expectRefused('update_decision', { nodeName: 'root', typeName: 'validation', name: 'non_conforme', to: 'conforme' }, 'DECISION_NAME_TAKEN')
    await expectRefused('update_decision', { nodeName: 'root', typeName: 'validation', name: 'nope', label: 'X' }, 'DECISION_NOT_FOUND')
  })

  it('B8 — null / false retirent label, color, proposesIssue ; décision utilisée : libellé modifiable', async () => {
    await call('update_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme', label: null, color: null })
    await call('update_decision', { nodeName: 'root', typeName: 'validation', name: 'non_conforme', proposesIssue: false, label: 'NC' })
    const d = (await typeOnDisk('validation')).decisions!
    expect(d.find(x => x.name === 'conforme')).toEqual({ name: 'conforme' })
    expect(d.find(x => x.name === 'non_conforme')).toEqual({ name: 'non_conforme', label: 'NC' })
  })

  it('B9 — aucune propriété, ou isPending: false : erreur d\'entrée', async () => {
    await expect(raw('update_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme' })).rejects.toThrow(/Input validation error/)
    await expect(raw('update_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme', isPending: false })).rejects.toThrow()
  })

  it('B10 — remove_decision : utilisée, en attente, citée, libre', async () => {
    await expectRefused('remove_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme' }, 'DECISION_IN_USE', /VAL-0001/)
    await expectRefused('remove_decision', { nodeName: 'root', typeName: 'validation', name: 'en_attente' }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('remove_decision', { nodeName: 'root', typeName: 'validation', name: 'non_conforme' }, 'REQUIRED_WHEN_INVALID', /motif/)
    await call('add_decision', { nodeName: 'root', typeName: 'validation', decision: { name: 'libre' } })
    await call('remove_decision', { nodeName: 'root', typeName: 'validation', name: 'libre' })
    expect((await typeOnDisk('validation')).decisions!.map(d => d.name)).toEqual(['en_attente', 'conforme', 'refuse', 'non_conforme'])
  })

  it('B11 — décisions sur un type non validation : VALIDATION_TYPE_INVALID', async () => {
    await expectRefused('add_decision', { nodeName: 'root', typeName: 'exigence', decision: { name: 'x' } }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('update_decision', { nodeName: 'root', typeName: 'exigence', name: 'x', label: 'y' }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('remove_decision', { nodeName: 'root', typeName: 'exigence', name: 'x' }, 'VALIDATION_TYPE_INVALID')
  })

  it('message : 5 IDs au plus, puis « … et N autres »', async () => {
    for (let i = 3; i <= 9; i++) await git.writeYaml(dir, `validations/VAL-000${i}.yaml`, validationFile(`VAL-000${i}`, 'en_cours', 'conforme'))
    const text = await expectRefused('remove_decision', { nodeName: 'root', typeName: 'validation', name: 'conforme' }, 'DECISION_IN_USE')
    expect(text).toContain('VAL-0001, VAL-0003, VAL-0004, VAL-0005, VAL-0006 … et 3 autres')
  })
})

describe('E — reorder_statuses', () => {
  it('E1 — réordonne', async () => {
    await call('reorder_statuses', { nodeName: 'root', typeName: 'exigence', order: ['approved', 'draft', 'review'] })
    expect((await typeOnDisk('exigence')).statuses!.map(s => s.name)).toEqual(['approved', 'draft', 'review'])
  })

  it('E2 — permutation incomplète, doublon, inconnu : STATUS_LIST_INVALID', async () => {
    await expectRefused('reorder_statuses', { nodeName: 'root', typeName: 'exigence', order: ['draft', 'review'] }, 'STATUS_LIST_INVALID', /manquant.*approved/)
    await expectRefused('reorder_statuses', { nodeName: 'root', typeName: 'exigence', order: ['draft', 'review', 'review'] }, 'STATUS_LIST_INVALID', /double/)
    await expectRefused('reorder_statuses', { nodeName: 'root', typeName: 'exigence', order: ['draft', 'review', 'approved', 'x'] }, 'STATUS_LIST_INVALID', /inconnu/)
  })

  it('E3 — signée en tête du type validation : VALIDATION_TYPE_INVALID ; campagne : STATUS_LIST_INVALID', async () => {
    await expectRefused('reorder_statuses', { nodeName: 'root', typeName: 'validation', order: ['signee', 'en_cours', 'annulee'] }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('reorder_statuses', { nodeName: 'root', typeName: 'campagne', order: [] }, 'STATUS_LIST_INVALID')
  })
})

describe('F — update_object_type', () => {
  it('F1 — displayIdField title, champ text, puis null', async () => {
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', displayIdField: 'title' })
    expect((await typeOnDisk('exigence')).displayIdField).toBe('title')
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', displayIdField: 'ref' })
    expect((await typeOnDisk('exigence')).displayIdField).toBe('ref')
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', displayIdField: null })
    expect('displayIdField' in (await typeOnDisk('exigence'))).toBe(false)
  })

  it('F2 — champ richtext ou inconnu : DISPLAY_ID_FIELD_INVALID', async () => {
    await expectRefused('update_object_type', { nodeName: 'root', typeName: 'exigence', displayIdField: 'desc' }, 'DISPLAY_ID_FIELD_INVALID')
    await expectRefused('update_object_type', { nodeName: 'root', typeName: 'exigence', displayIdField: 'nope' }, 'DISPLAY_ID_FIELD_INVALID')
  })

  it('F3/F4 — trackStatusHistory', async () => {
    await expectRefused('update_object_type', { nodeName: 'root', typeName: 'validation', trackStatusHistory: false }, 'VALIDATION_TYPE_INVALID')
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', trackStatusHistory: false })
    expect((await typeOnDisk('exigence')).trackStatusHistory).toBe(false)
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', trackStatusHistory: true })
    expect('trackStatusHistory' in (await typeOnDisk('exigence'))).toBe(false)
  })

  it('F5 — label / color posés puis retirés ; aucune propriété : erreur d\'entrée', async () => {
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', label: 'Exigence', color: '#123456' })
    expect(await typeOnDisk('exigence')).toMatchObject({ label: 'Exigence', color: '#123456' })
    await call('update_object_type', { nodeName: 'root', typeName: 'exigence', label: null, color: null })
    const t = await typeOnDisk('exigence')
    expect('label' in t || 'color' in t).toBe(false)
    await expect(raw('update_object_type', { nodeName: 'root', typeName: 'exigence' })).rejects.toThrow(/Input validation error/)
  })
})

describe('G — communs', () => {
  it('G1/G2 — nœud readonly, nœud ou type inconnus', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['add_decision', { decision: { name: 'x' } }],
      ['update_decision', { name: 'x', label: 'y' }],
      ['remove_decision', { name: 'x' }],
      ['reorder_statuses', { order: ['a', 'b'] }],
      ['update_object_type', { label: 'x' }],
    ]
    for (const [name, dto] of calls) {
      await expectRefused(name, { nodeName: 'lecture', typeName: 'ext', ...dto }, 'NODE_READONLY')
      await expectRefused(name, { nodeName: 'nope', typeName: 'ext', ...dto }, 'NODE_NOT_FOUND')
      await expectRefused(name, { nodeName: 'root', typeName: 'nope', ...dto }, 'TYPE_NOT_FOUND')
    }
  })
})
