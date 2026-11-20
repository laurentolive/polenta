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
  registerTools()
})

/** Conteneur MCP neuf (cache de schéma et index vides) et ses outils de mutation du schéma. */
function registerTools(): void {
  tools = new Map()
  const server = { registerTool: (name: string, config: { inputSchema: Tool['schema'] }, handler: Tool['handler']) => { tools.set(name, { schema: config.inputSchema, handler }) } } as unknown as McpServer
  registerSchemaMutationTools(server, createMcpContainer(dir))
}

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('A — add_field entryFields', () => {
  it('A1/A5 — ajoute en fin d\'entryFields, requiredWhen sur une décision connue accepté', async () => {
    await call('add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'commentaire_qualite', type: 'text', requiredWhen: { decision: ['conforme'] }, trackHistory: true, defaultVisible: true } })
    const entryFields = (await typeOnDisk('validation')).entryFields!
    expect(entryFields.map(f => f.name)).toEqual(['motif', 'commentaire_qualite'])
    // Ni historique ni colonne pour un champ d'entrée (comme add_object_type, GH377).
    expect(entryFields[1]).toEqual({ name: 'commentaire_qualite', type: 'text', requiredWhen: { decision: ['conforme'] } })
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

// ── Sprint 2 — statuts avec migration ─────────────────────────────────────────

const OLD = '2026-09-01T00:00:00Z'
const base = { projectId: '', branchId: '', title: 'X', version: 1, jiraLinks: [] }
type Obj = { status: string; history?: { status?: Array<{ value?: string }> }; runs?: Array<{ testSnapshot?: { status: string } }> }
const readObj = (file: string) => git.readYaml<Obj>(dir, file) as Promise<Obj>
const historyOf = (...values: string[]) => ({ status: values.map(value => ({ value, at: OLD, by: 'lolive' })) })
const OBJECT_FILES = ['requirements/REQ-0001.yaml', 'requirements/REQ-0002.yaml', 'requirements/REQ-0003.yaml', 'tests/TST-0001.yaml', 'campaigns/CMP-0001.yaml']
const filesBytes = () => Promise.all(OBJECT_FILES.map(f => fsP.readFile(path.join(dir, f), 'utf-8')))

async function writeObjects() {
  await git.writeYaml(dir, 'requirements/REQ-0001.yaml', { ...base, id: 'REQ-0001', objectTypeRef: 'root::exigence', status: 'review', fields: {}, history: historyOf('draft', 'review') })
  await git.writeYaml(dir, 'requirements/REQ-0002.yaml', { ...base, id: 'REQ-0002', objectTypeRef: 'root::exigence', status: 'review', fields: {}, history: historyOf('review') })
  await git.writeYaml(dir, 'requirements/REQ-0003.yaml', { ...base, id: 'REQ-0003', objectTypeRef: 'root::exigence', status: 'approved', fields: {}, history: historyOf('review', 'approved') })
  await git.writeYaml(dir, 'tests/TST-0001.yaml', {
    ...base, id: 'TST-0001', objectTypeRef: 'root::test', status: 'ready', steps: [], preconditions: '', postconditions: '', equipment: [], fields: {}, history: historyOf('ready'),
  })
  await git.writeYaml(dir, 'campaigns/CMP-0001.yaml', {
    id: 'CMP-0001', title: 'C', objectTypeRef: 'root::campagne', status: 'planned', testCaseIds: ['TST-0001'], createdAt: OLD, fields: {},
    runs: [{ entryId: 'TST-0001-1', testCaseId: 'TST-0001', status: 'pending', testSnapshot: { id: 'TST-0001', objectTypeRef: 'root::test', title: 'T', status: 'ready', fields: {}, steps: [] } }],
  })
}

type Migrated = { type: ObjectTypeDefinition; schema?: ProjectSchema; migration: { migrated: string[]; skipped: unknown[]; failed: unknown[]; snapshots?: number } }
type Preview = { dryRun: true; type: ObjectTypeDefinition; schema?: ProjectSchema; preview: { withOld: number; withNew: number } }

describe('C — update_status', () => {
  beforeEach(writeObjects)

  it('C1 — dryRun : aperçu, aucun fichier écrit', async () => {
    const before = await filesBytes()
    const schemaBefore = await schemaBytes()
    const res = await call<Preview>('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', to: 'relecture', dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.preview).toEqual({ withOld: 2, withNew: 0 })
    // GH384 — seul le type modifié, pas le schéma complet.
    expect(res.type.statuses!.map(s => s.name)).toEqual(['draft', 'relecture', 'approved'])
    expect(res.schema).toBeUndefined()
    expect(await filesBytes()).toEqual(before)
    expect(await schemaBytes()).toBe(schemaBefore)
  })

  it('C2 — renommage : objets (statut, historique), transitions et requiredWhen migrés', async () => {
    const res = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', to: 'relecture' })
    expect(res.migration.migrated.sort()).toEqual(['REQ-0001', 'REQ-0002', 'REQ-0003'])
    expect(res.migration.failed).toEqual([])
    const r1 = await readObj('requirements/REQ-0001.yaml')
    expect(r1.status).toBe('relecture')
    expect(r1.history!.status!.map(e => e.value)).toEqual(['draft', 'relecture'])
    expect((await readObj('requirements/REQ-0003.yaml')).history!.status!.map(e => e.value)).toEqual(['relecture', 'approved'])
    const t = await typeOnDisk('exigence')
    expect(t.statuses!.map(s => s.name)).toEqual(['draft', 'relecture', 'approved'])
    expect(t.transitions).toEqual([{ from: 'draft', to: 'relecture', requires: { fieldsFilled: 'warn' } }])
    expect(t.fields.find(f => f.name === 'justif')!.requiredWhen).toEqual({ status: ['relecture'] })
  })

  it('C3 — type de test : copie testSnapshot de la campagne migrée', async () => {
    const res = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'test', name: 'ready', to: 'pret' })
    expect(res.migration.snapshots).toBe(1)
    expect((await readObj('tests/TST-0001.yaml')).status).toBe('pret')
    expect((await readObj('campaigns/CMP-0001.yaml')).runs![0].testSnapshot!.status).toBe('pret')
  })

  it('C4 — nom cible déjà pris : STATUS_NAME_TAKEN', async () => {
    await expectRefused('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', to: 'approved' }, 'STATUS_NAME_TAKEN')
  })

  it('C5 — label, color, marques posés puis retirés, sans toucher aux objets', async () => {
    const before = await filesBytes()
    const res = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', label: 'Relecture', color: '#f80', isApproval: true, isTerminal: true })
    expect(res.migration).toEqual({ migrated: [], skipped: [], failed: [] })
    expect((await typeOnDisk('exigence')).statuses![1]).toEqual({ name: 'review', label: 'Relecture', color: '#f80', isApproval: true, isTerminal: true })
    await call('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', label: null, color: null, isApproval: false, isTerminal: false })
    expect((await typeOnDisk('exigence')).statuses![1]).toEqual({ name: 'review' })
    expect(await filesBytes()).toEqual(before)
    await expect(raw('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review' })).rejects.toThrow(/Input validation error/)
  })

  it('C6 — type validation avec des validations : statut signée figé', async () => {
    await expectRefused('update_status', { nodeName: 'root', typeName: 'validation', name: 'signee', to: 'signe' }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('update_status', { nodeName: 'root', typeName: 'validation', name: 'signee', isApproval: false }, 'VALIDATION_TYPE_INVALID')
    await expectRefused('update_status', { nodeName: 'root', typeName: 'validation', name: 'signee', to: 'signe', dryRun: true }, 'VALIDATION_TYPE_INVALID')
    // Statut non marqué : libre.
    await call('update_status', { nodeName: 'root', typeName: 'validation', name: 'en_cours', label: 'En cours' })
  })

  it('C7 — type version avec des versions : statut released figé', async () => {
    await git.writeYaml(dir, 'versions/PV-0001.yaml', { id: 'PV-0001', objectTypeRef: 'root::version', title: '1.0', status: 'en_cours', fields: {} })
    await expectRefused('update_status', { nodeName: 'root', typeName: 'version', name: 'released', to: 'livree' }, 'VERSION_TYPE_INVALID')
  })

  it('C8 — type validation sans validation : deux statuts signée refusés', async () => {
    await fsP.rm(path.join(dir, 'validations'), { recursive: true })
    await expectRefused('update_status', { nodeName: 'root', typeName: 'validation', name: 'annulee', isApproval: true, isTerminal: false }, 'VALIDATION_TYPE_INVALID')
    await call('update_status', { nodeName: 'root', typeName: 'validation', name: 'signee', to: 'signe' })
    expect((await typeOnDisk('validation')).statuses!.map(s => s.name)).toEqual(['en_cours', 'signe', 'annulee'])
  })

  it('C9 — statut inconnu ; campagne', async () => {
    await expectRefused('update_status', { nodeName: 'root', typeName: 'exigence', name: 'nope', label: 'x' }, 'STATUS_NOT_FOUND')
    await expectRefused('update_status', { nodeName: 'root', typeName: 'campagne', name: 'planned', label: 'x' }, 'STATUS_LIST_INVALID')
  })
})

describe('D — remove_status', () => {
  beforeEach(writeObjects)

  it('D1 — statut porté sans replaceWith : STATUS_IN_USE, nombre et IDs', async () => {
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review' }, 'STATUS_IN_USE', /2 objet\(s\) \(REQ-0001, REQ-0002\)/)
  })

  it('D2 — dryRun avec replaceWith : aperçu, rien d\'écrit', async () => {
    const before = await filesBytes()
    const schemaBefore = await schemaBytes()
    const res = await call<Preview>('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'approved', dryRun: true })
    expect(res.preview).toEqual({ withOld: 2, withNew: 1 })
    expect(await filesBytes()).toEqual(before)
    expect(await schemaBytes()).toBe(schemaBefore)
  })

  it('D3 — replaceWith : objets fusionnés, statut retiré, références réécrites', async () => {
    const res = await call<Migrated>('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'approved' })
    expect(res.migration.migrated.sort()).toEqual(['REQ-0001', 'REQ-0002', 'REQ-0003'])
    const r1 = await readObj('requirements/REQ-0001.yaml')
    expect(r1.status).toBe('approved')
    expect(r1.history!.status!.map(e => e.value)).toEqual(['draft', 'approved'])
    const t = await typeOnDisk('exigence')
    expect(t.statuses!.map(s => s.name)).toEqual(['draft', 'approved'])
    expect(t.transitions).toEqual([{ from: 'draft', to: 'approved', requires: { fieldsFilled: 'warn' } }])
    expect(t.fields.find(f => f.name === 'justif')!.requiredWhen).toEqual({ status: ['approved'] })
  })

  it('D3b — fusion qui rend une règle invalide (draft → draft) : TRANSITION_INVALID, rien d\'écrit', async () => {
    const before = await filesBytes()
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'draft' }, 'TRANSITION_INVALID')
    expect(await filesBytes()).toEqual(before)
  })

  it('D4 — statut non porté mais cité : TRANSITION_INVALID / REQUIRED_WHEN_INVALID', async () => {
    await call('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', to: 'relecture' }) // REQ-0001/2 → relecture
    await call('add_status', { nodeName: 'root', typeName: 'exigence', status: { name: 'review' } })
    await call('add_field', { nodeName: 'root', typeName: 'exigence', field: { name: 'motif', type: 'text', requiredWhen: { status: ['review'] } } })
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review' }, 'REQUIRED_WHEN_INVALID', /motif/)
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'relecture', replaceWith: 'draft' }, 'TRANSITION_INVALID')
    await call('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'draft' })
    expect((await typeOnDisk('exigence')).fields.find(f => f.name === 'motif')!.requiredWhen).toEqual({ status: ['draft'] })
  })

  it('D4 — statut non porté cité par une transition, sans replaceWith : TRANSITION_INVALID', async () => {
    await call('update_status', { nodeName: 'root', typeName: 'exigence', name: 'review', to: 'relecture' })
    await call('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'relecture', replaceWith: 'approved' })
    // `draft → approved` cite maintenant `approved`, porté par les trois exigences : on vide `draft`.
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'draft' }, 'TRANSITION_INVALID', /draft → approved/)
  })

  it('D5 — statut non porté, non cité : retiré (le premier statut compris)', async () => {
    await call('add_status', { nodeName: 'root', typeName: 'test', status: { name: 'obsolete' } })
    const res = await call<Migrated>('remove_status', { nodeName: 'root', typeName: 'test', name: 'obsolete' })
    expect(res.migration).toEqual({ migrated: [], skipped: [], failed: [] })
    await call('remove_status', { nodeName: 'root', typeName: 'test', name: 'draft' })
    expect((await typeOnDisk('test')).statuses!.map(s => s.name)).toEqual(['ready'])
  })

  it('D6 — replaceWith inconnu ou identique ; dernier statut', async () => {
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'nope' }, 'STATUS_NOT_FOUND')
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'nope' }, 'STATUS_NOT_FOUND')
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'review' }, 'STATUS_LIST_INVALID')
    await call('remove_status', { nodeName: 'root', typeName: 'test', name: 'draft' })
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'test', name: 'ready', replaceWith: 'ready' }, 'STATUS_LIST_INVALID')
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'test', name: 'ready' }, 'STATUS_LIST_INVALID', /dernier/)
  })

  it('D7 — statut signée avec des validations : refusé, validations intactes', async () => {
    const vals = await fsP.readFile(path.join(dir, 'validations', 'VAL-0002.yaml'), 'utf-8')
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'validation', name: 'signee' }, 'STATUS_IN_USE', /VAL-0002/)
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'validation', name: 'signee', replaceWith: 'en_cours' }, 'VALIDATION_TYPE_INVALID')
    expect(await fsP.readFile(path.join(dir, 'validations', 'VAL-0002.yaml'), 'utf-8')).toBe(vals)
  })

  it('D8 — objet écrit hors MCP après un premier appel : compté (index rafraîchi)', async () => {
    await call('add_status', { nodeName: 'root', typeName: 'exigence', status: { name: 'gel' } })
    await call<Preview>('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'gel', dryRun: true }) // index construit
    await git.writeYaml(dir, 'requirements/REQ-0004.yaml', { ...base, id: 'REQ-0004', objectTypeRef: 'root::exigence', status: 'gel', fields: {} })
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'gel' }, 'STATUS_IN_USE', /REQ-0004/)
  })

  it('G1/G2 — nœud readonly, nœud ou type inconnus', async () => {
    for (const [name, dto] of [['update_status', { name: 'a', label: 'x' }], ['remove_status', { name: 'a' }]] as const) {
      await expectRefused(name, { nodeName: 'lecture', typeName: 'ext', ...dto }, 'NODE_READONLY')
      await expectRefused(name, { nodeName: 'nope', typeName: 'ext', ...dto }, 'NODE_NOT_FOUND')
      await expectRefused(name, { nodeName: 'root', typeName: 'nope', ...dto }, 'TYPE_NOT_FOUND')
    }
  })
})

describe('G4 — appels pipelinés', () => {
  const steps: Array<[string, Record<string, unknown>]> = [
    ...[1, 2, 3, 4, 5].map((i): [string, Record<string, unknown>] => ['add_decision', { nodeName: 'root', typeName: 'validation', decision: { name: `d${i}` } }]),
    ['update_status', { nodeName: 'root', typeName: 'exigence', name: 'draft', label: 'Brouillon' }],
    ['reorder_statuses', { nodeName: 'root', typeName: 'exigence', order: ['review', 'draft', 'approved'] }],
    ['update_object_type', { nodeName: 'root', typeName: 'exigence', label: 'Exigence' }],
    ['add_field', { nodeName: 'root', typeName: 'validation', list: 'entryFields', field: { name: 'note', type: 'text' } }],
    ['update_decision', { nodeName: 'root', typeName: 'validation', name: 'd3', label: 'D3' }],
  ]

  it('dix appels sans attente = mêmes appels séquentiels', async () => {
    await Promise.all(steps.map(([name, dto]) => call(name, dto)))
    const pipelined = await onDiskSchema()
    await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
    registerTools()
    for (const [name, dto] of steps) await call(name, dto)
    expect(pipelined).toEqual(await onDiskSchema())
    expect((await typeOnDisk('validation')).decisions!.map(d => d.name)).toEqual(['en_attente', 'conforme', 'refuse', 'non_conforme', 'd1', 'd2', 'd3', 'd4', 'd5'])
  })
})

// ── GH381 — statuts non marqués du type version : les versions sont migrées ───

describe('V — GH381 : versions migrées par update_status / remove_status', () => {
  const PV1 = 'versions/PV-0001.yaml'
  const PV2 = 'versions/PV-0002.yaml'
  const versionsBytes = () => Promise.all([PV1, PV2].map(f => fsP.readFile(path.join(dir, f), 'utf-8')))

  beforeEach(async () => {
    // Statut non marqué supplémentaire : `qualif`, cible de fusion.
    await call('add_status', { nodeName: 'root', typeName: 'version', status: { name: 'qualif' } })
    await git.writeYaml(dir, PV1, { id: 'PV-0001', objectTypeRef: 'root::version', title: '1.1', status: 'en_cours', fields: {}, history: historyOf('en_cours') })
    await git.writeYaml(dir, PV2, {
      id: 'PV-0002', objectTypeRef: 'root::version', title: '1.0', status: 'released', fields: {},
      freeze: { tag: 'v1.0', sha: 'abc', at: OLD }, history: historyOf('en_cours', 'released'),
    })
  })

  it('V1 — renommage : statut courant et history.status des versions, released comprise', async () => {
    const res = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'version', name: 'en_cours', to: 'ouverte' })
    expect(res.migration.migrated.sort()).toEqual(['PV-0001', 'PV-0002'])
    expect(res.migration.failed).toEqual([])
    const v1 = await readObj(PV1)
    expect(v1.status).toBe('ouverte')
    expect(v1.history!.status!.map(e => e.value)).toEqual(['ouverte'])
    const v2 = (await git.readYaml<Obj & { freeze: unknown }>(dir, PV2))!
    expect(v2.status).toBe('released')
    expect(v2.history!.status!.map(e => e.value)).toEqual(['ouverte', 'released'])
    expect(v2.freeze).toEqual({ tag: 'v1.0', sha: 'abc', at: OLD })
  })

  it('V2 — dryRun : versions comptées, rien d\'écrit', async () => {
    const before = await versionsBytes()
    const res = await call<Preview>('update_status', { nodeName: 'root', typeName: 'version', name: 'en_cours', to: 'ouverte', dryRun: true })
    expect(res.preview).toEqual({ withOld: 1, withNew: 0 })
    expect(await versionsBytes()).toEqual(before)
  })

  it('V3 — remove_status : STATUS_IN_USE sans replaceWith, migration avec', async () => {
    await expectRefused('remove_status', { nodeName: 'root', typeName: 'version', name: 'en_cours' }, 'STATUS_IN_USE', /1 objet\(s\) \(PV-0001\)/)
    const res = await call<Migrated>('remove_status', { nodeName: 'root', typeName: 'version', name: 'en_cours', replaceWith: 'qualif' })
    expect(res.migration.migrated.sort()).toEqual(['PV-0001', 'PV-0002'])
    expect((await readObj(PV1)).status).toBe('qualif')
    expect((await readObj(PV2)).history!.status!.map(e => e.value)).toEqual(['qualif', 'released'])
    expect((await typeOnDisk('version')).statuses!.map(s => s.name)).toEqual(['released', 'abandonnee', 'qualif'])
  })
})

describe('GH384 — réponse de update_status / remove_status', () => {
  beforeEach(writeObjects)

  it('S1 — type modifié seul ; includeSchema rend le schéma complet', async () => {
    const res = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'exigence', name: 'draft', to: 'brouillon', dryRun: true })
    expect(Object.keys(res).sort()).toEqual(['dryRun', 'preview', 'type'])
    expect(res.type.name).toBe('exigence')
    const full = await call<Migrated>('remove_status', { nodeName: 'root', typeName: 'exigence', name: 'review', replaceWith: 'approved', dryRun: true, includeSchema: true })
    expect(full.type).toBeUndefined()
    expect(full.schema!.nodes.map(n => n.name)).toEqual(['root', 'lecture'])
    const written = await call<Migrated>('update_status', { nodeName: 'root', typeName: 'exigence', name: 'draft', label: 'Brouillon' })
    expect(Object.keys(written).sort()).toEqual(['migration', 'type'])
    expect(written.type.statuses![0]).toEqual({ name: 'draft', label: 'Brouillon' })
  })
})
