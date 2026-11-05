import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  evaluateTransition, matchingConditions, renameTransitionRefs, transitionRuleIssues, validatorError,
} from '@polenta/types'
import type { ObjectTypeDefinition, ProjectSchema, Requirement, TransitionRule } from '@polenta/types'
import { GitService } from './git.service'
import { SchemaService } from './schema.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'

// GH206 — contraintes de transition à niveaux (specs/GH206-tests.md). Évaluateur pur, puis écritures
// réelles par le conteneur MCP (services câblés avec le garde), schéma et outils MCP.

const EARS = 'THE system SHALL start'
const STATUSES = [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }, { name: 'obsolete', isTerminal: true }]

const reqType = (transitions?: TransitionRule[]): ObjectTypeDefinition => ({
  name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
  fields: [
    { name: 'statement', label: 'Énoncé', type: 'richtext', validator: 'EARS', required: true },
    { name: 'rationale', label: 'Justification', type: 'text', requiredWhen: { status: ['approved'] } },
    { name: 'code', label: 'Code', type: 'text', validator: 'regex:^[A-Z]' },
  ],
  statuses: STATUSES,
  ...(transitions ? { transitions } : {}),
})

const schemaWith = (transitions?: TransitionRule[], testTransitions?: TransitionRule[], issueTransitions?: TransitionRule[]) => ({
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      reqType(transitions),
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test',
        fields: [{ name: 'objective', label: 'Objectif', type: 'text', required: true }],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
        ...(testTransitions ? { transitions: testTransitions } : {}),
      },
      {
        name: 'bug', label: 'Bug', prefix: 'BUG', category: 'issue',
        fields: [{ name: 'fix', label: 'Correctif', type: 'text', required: true }],
        statuses: [{ name: 'ouverte' }, { name: 'corrigee' }],
        ...(issueTransitions ? { transitions: issueTransitions } : {}),
      },
    ],
  }],
  linkTypes: [{
    name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par',
    sourceRefs: ['test'], targetRefs: ['requirement'],
  }],
}) as unknown as ProjectSchema

const covered = () => true
const uncovered = () => false

describe('GH206 — évaluateur pur', () => {
  it('E1 — sans règle : aucune condition', () => {
    expect(matchingConditions(reqType(), 'draft', 'approved').size).toBe(0)
    expect(evaluateTransition(reqType(), 'draft', { status: 'approved', fields: {} }, uncovered)).toEqual({ blocked: false, issues: [] })
  })

  it('E2/E3 — `from` ciblé ; création : toutes les règles vers le statut', () => {
    const t = reqType([{ from: 'review', to: 'approved', requires: { hasCoverageLink: 'block' } }])
    expect([...matchingConditions(t, 'review', 'approved')]).toEqual([['hasCoverageLink', 'block']])
    expect(matchingConditions(t, 'draft', 'approved').size).toBe(0)
    expect([...matchingConditions(t, null, 'approved')]).toEqual([['hasCoverageLink', 'block']])
  })

  it('E4/E5 — niveau le plus fort ; `off` ignoré', () => {
    const t = reqType([
      { to: 'approved', requires: { hasCoverageLink: 'warn', fieldsFilled: 'off' } },
      { from: 'review', to: 'approved', requires: { hasCoverageLink: 'block' } },
    ])
    expect([...matchingConditions(t, 'review', 'approved')]).toEqual([['hasCoverageLink', 'block']])
    expect([...matchingConditions(t, 'draft', 'approved')]).toEqual([['hasCoverageLink', 'warn']])
  })

  it('E6 — fieldsFilled : required et requiredWhen actifs au statut d\'arrivée', () => {
    const t = reqType([{ to: 'approved', requires: { fieldsFilled: 'block' } }, { to: 'review', requires: { fieldsFilled: 'block' } }])
    const toApproved = evaluateTransition(t, 'draft', { status: 'approved', fields: { statement: EARS } }, covered)
    expect(toApproved.blocked).toBe(true)
    expect(toApproved.issues[0]).toMatchObject({ condition: 'fieldsFilled', fields: ['rationale'] })
    expect(toApproved.issues[0].message).toContain('Justification')
    expect(evaluateTransition(t, 'draft', { status: 'review', fields: { statement: EARS } }, covered).issues).toEqual([])
    expect(evaluateTransition(t, 'draft', { status: 'review', fields: {} }, covered).issues[0].fields).toEqual(['statement'])
  })

  it('E7 — validatorsPass : EARS, vide ignoré, regex', () => {
    const t = reqType([{ to: 'review', requires: { validatorsPass: 'block' } }])
    expect(evaluateTransition(t, 'draft', { status: 'review', fields: { statement: 'Le système démarre' } }, covered).issues[0].fields).toEqual(['statement'])
    expect(evaluateTransition(t, 'draft', { status: 'review', fields: {} }, covered).issues).toEqual([])
    expect(evaluateTransition(t, 'draft', { status: 'review', fields: { statement: EARS, code: 'abc' } }, covered).issues[0].fields).toEqual(['code'])
    expect(validatorError({ name: 'x', validator: 'regex:[' }, 'a')).toBeNull()
  })

  it('S5 (pur) — bloquants en tête, notifiés ensuite', () => {
    const t = reqType([{ to: 'approved', requires: { hasCoverageLink: 'warn', fieldsFilled: 'block' } }])
    const r = evaluateTransition(t, 'draft', { id: 'SYS-0001', status: 'approved', fields: {} }, uncovered)
    expect(r.blocked).toBe(true)
    expect(r.issues.map(i => [i.condition, i.level])).toEqual([['fieldsFilled', 'block'], ['hasCoverageLink', 'warn']])
    expect(r.issues[1].message).toContain('SYS-0001')
  })

  it('E8 — cohérence du bloc', () => {
    const errors = (transitions: unknown, category: ObjectTypeDefinition['category'] = 'requirement') =>
      transitionRuleIssues({ ...reqType(), category, transitions: transitions as TransitionRule[] }).filter(i => i.level === 'error')
    expect(errors([{ to: 'approved', requires: { fieldsFilled: 'warn' } }], 'version')).toHaveLength(1)
    expect(errors([{ to: 'ghost', requires: { fieldsFilled: 'warn' } }])[0].message).toContain('ghost')
    expect(errors([{ from: 'review', to: 'review', requires: { fieldsFilled: 'warn' } }])).toHaveLength(1)
    expect(errors([{ to: 'approved', requires: {} }])).toHaveLength(1)
    expect(errors([{ to: 'approved', requires: { hasCoverageLink: 'warn' } }], 'test')).toHaveLength(1)
    expect(errors([{ to: 'approved', requires: { fieldsFilled: 'strict' } }])).toHaveLength(1)
    expect(errors([{ to: 'approved', requires: { fieldsFilled: 'warn' } }, { to: 'approved', requires: { hasCoverageLink: 'block' } }])).toHaveLength(1)
    expect(errors([{ to: 'approved', requires: { fieldsFilled: 'warn' } }, { from: 'review', to: 'approved', requires: { hasCoverageLink: 'block' } }])).toEqual([])
  })

  it('E9 — blocage d\'une sortie d\'approbation : avertissement seulement', () => {
    const issues = (rule: TransitionRule) => transitionRuleIssues({ ...reqType(), transitions: [rule] })
    expect(issues({ from: 'approved', to: 'draft', requires: { fieldsFilled: 'block' } }).map(i => i.level)).toEqual(['warning'])
    expect(issues({ to: 'draft', requires: { fieldsFilled: 'block' } }).map(i => i.level)).toEqual(['warning'])
    expect(issues({ to: 'draft', requires: { fieldsFilled: 'warn' } })).toEqual([])
    expect(issues({ to: 'approved', requires: { fieldsFilled: 'block' } })).toEqual([])
  })

  it('E10 — renommage d\'un statut', () => {
    const rules = renameTransitionRefs([{ from: 'approved', to: 'draft', requires: { fieldsFilled: 'warn' } }, { to: 'approved', requires: { fieldsFilled: 'warn' } }],
      [{ target: { kind: 'status' }, from: 'approved', to: 'valide' }])
    expect(rules.map(r => [r.from, r.to])).toEqual([['valide', 'draft'], [undefined, 'valide']])
  })
})

describe('GH206 — écritures, schéma, MCP', () => {
  let dir: string
  let git: GitService
  let mcp: McpContainer
  type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>
  let tools: Record<string, Handler>

  async function setup(schema: ProjectSchema) {
    await git.writeYaml(dir, '.polenta/schema.yaml', schema)
    mcp = createMcpContainer(dir, undefined, 'alice')
    tools = {}
    const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } }
    registerUpdateTools(server as never, mcp)
    registerBulkImportTools(server as never, mcp)
  }
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await tools[name](args)).content[0].text)
  const newReq = (fields: Record<string, unknown> = { statement: EARS, rationale: 'r' }) =>
    mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields } as never)
  const newTest = () => mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [], fields: { objective: 'o' } } as never)
  const onDisk = (id: string) => git.readYaml<Requirement>(dir, `requirements/${id}.yaml`) as Promise<Requirement>

  beforeEach(async () => {
    dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh206-'))
    git = new GitService()
  })
  afterEach(async () => {
    await fsP.rm(dir, { recursive: true, force: true })
  })

  it('U1 — sans bloc : passage libre, aucune notification', async () => {
    await setup(schemaWith())
    const r = await newReq()
    const out = await mcp.requirements.transition(dir, r.id, { toStatus: 'approved' })
    expect(out.status).toBe('approved')
    expect(out.transitionWarnings).toBeUndefined()
  })

  it('S1/S2 — blocage tant qu\'aucun test ne couvre, dans les deux sens de lien', async () => {
    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'block' } }]))
    const r = await newReq()
    await expect(mcp.requirements.transition(dir, r.id, { toStatus: 'approved' })).rejects.toThrow(/^TRANSITION_BLOCKED: Aucun test ne couvre/)
    expect((await onDisk(r.id)).status).toBe('draft')
    const t = await newTest()
    await mcp.requirements.createLink(dir, { type: 'verification', sourceId: r.id, targetId: t.id })
    expect((await mcp.requirements.transition(dir, r.id, { toStatus: 'approved' })).status).toBe('approved')
  })

  it('S4 — notification : écrit, avertissement rendu, rien dans le fichier', async () => {
    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'warn' } }]))
    const r = await newReq()
    const out = await mcp.requirements.transition(dir, r.id, { toStatus: 'approved' })
    expect(out.status).toBe('approved')
    expect(out.transitionWarnings?.map(w => w.condition)).toEqual(['hasCoverageLink'])
    expect(await onDisk(r.id)).not.toHaveProperty('transitionWarnings')
    expect(await mcp.requirements.findOne(dir, r.id)).not.toHaveProperty('transitionWarnings')
  })

  it('S6 — statut inchangé renvoyé : aucun contrôle', async () => {
    await setup(schemaWith(undefined, [{ to: 'draft', requires: { fieldsFilled: 'block' } }]))
    const t = await newTest()
    const out = await mcp.tests.update(dir, t.id, { status: 'draft', fields: { objective: '' } } as never)
    expect(out.status).toBe('draft')
  })

  it('S7 — création directe dans un statut contrôlé', async () => {
    await setup(schemaWith(undefined, [{ from: 'draft', to: 'approved', requires: { fieldsFilled: 'block' } }]))
    await expect(mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [], status: 'approved', fields: {} } as never))
      .rejects.toThrow(/TRANSITION_BLOCKED: Champs obligatoires vides : Objectif/)
  })

  it('S8 — issue : refus puis acceptation une fois le champ rempli', async () => {
    await setup(schemaWith(undefined, undefined, [{ to: 'corrigee', requires: { fieldsFilled: 'block' } }]))
    const i = await mcp.issues.create(dir, { objectTypeRef: 'root::bug', title: 'B' } as never)
    await expect(mcp.issues.update(dir, i.id, { status: 'corrigee' } as never)).rejects.toThrow(/TRANSITION_BLOCKED/)
    expect((await mcp.issues.update(dir, i.id, { status: 'corrigee', fields: { fix: 'ok' } } as never)).status).toBe('corrigee')
  })

  it('S11 — pré-contrôle : un résultat par statut, courant exclu', async () => {
    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'block' } }, { to: 'review', requires: { validatorsPass: 'warn' } }]))
    const r = await newReq({ statement: 'pas EARS', rationale: 'r' })
    const typeDef = reqType([{ to: 'approved', requires: { hasCoverageLink: 'block' } }, { to: 'review', requires: { validatorsPass: 'warn' } }])
    const preview = await mcp.transitionGuard.preview(dir, typeDef, r)
    expect(Object.keys(preview)).toEqual(['review', 'approved', 'obsolete'])
    expect(preview.approved.blocked).toBe(true)
    expect(preview.review).toMatchObject({ blocked: false, issues: [{ condition: 'validatorsPass', level: 'warn' }] })
    expect(preview.obsolete.issues).toEqual([])
  })

  it('C1/C2 — schéma : règle incohérente et statut cité retiré refusés', async () => {
    const svc = new SchemaService({} as never)
    await expect(svc.save(dir, schemaWith([{ to: 'ghost', requires: { fieldsFilled: 'warn' } }]))).rejects.toMatchObject({ code: 'TRANSITION_INVALID' })
    const valid = schemaWith([{ to: 'approved', requires: { fieldsFilled: 'warn' } }])
    await expect(svc.save(dir, valid)).resolves.toBeUndefined()
    const withoutApproved = structuredClone(valid) as unknown as { nodes: Array<{ objectTypes: ObjectTypeDefinition[] }> }
    withoutApproved.nodes[0].objectTypes[0].statuses = STATUSES.filter(s => s.name !== 'approved')
    await expect(svc.save(dir, withoutApproved as unknown as ProjectSchema)).rejects.toThrow(/\* → approved/)
  })

  it('M1/M2 — update_requirements : même résultat en dryRun et au réel, sans écriture partielle', async () => {
    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'block' } }]))
    const r = await newReq()
    const entry = { id: r.id, status: 'approved', fields: { statement: 'THE system SHALL stop' } }
    const dry = await call('update_requirements', { entries: [entry], dryRun: true })
    const real = await call('update_requirements', { entries: [entry], dryRun: false })
    expect(dry.errors[0].reason).toMatch(/^TRANSITION_BLOCKED/)
    expect(real.errors[0].reason).toBe(dry.errors[0].reason)
    expect(real.errors[0].partial).toBeUndefined()
    expect((await onDisk(r.id)).fields.statement).toBe(EARS)

    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'warn' } }]))
    const dryWarn = await call('update_requirements', { entries: [entry], dryRun: true })
    const realWarn = await call('update_requirements', { entries: [entry], dryRun: false })
    expect(dryWarn.preview[0].transitionWarnings).toHaveLength(1)
    expect(realWarn.updated[0].transitionWarnings).toEqual(dryWarn.preview[0].transitionWarnings)
    expect((await onDisk(r.id)).status).toBe('approved')
  })

  it('M3 — bulk_import_requirements : statut de création refusé en dryRun comme au réel', async () => {
    await setup(schemaWith([{ to: 'approved', requires: { hasCoverageLink: 'block' } }]))
    const entries = [{ objectTypeRef: 'root::exigence', title: 'R', status: 'approved', fields: { statement: EARS, rationale: 'r' } }]
    const dry = await call('bulk_import_requirements', { entries, dryRun: true })
    const real = await call('bulk_import_requirements', { entries, dryRun: false })
    expect(dry.errors[0].reason).toMatch(/^TRANSITION_BLOCKED/)
    expect(real.errors[0].reason).toBe(dry.errors[0].reason)
    expect(real.created).toEqual([])
  })
})
