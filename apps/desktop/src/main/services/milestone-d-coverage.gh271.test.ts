import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CreateRequirementSchema } from '@polenta/zod-schemas'
import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerBulkImportTools } from '../../mcp-server/tools/bulk-import.tools'
import { registerIssueTools } from '../../mcp-server/tools/issues.tools'
import { registerUpdateTools } from '../../mcp-server/tools/update.tools'
import { registerValidationTools } from '../../mcp-server/tools/validations.tools'
import { registerVersionTools } from '../../mcp-server/tools/versions.tools'

// GH271 — scénarios du milestone D annoncés sans test (revue du 2026-11-04) : outils MCP des versions et
// validations, collections du graphe, lecture seule, signature d'une version abandonnée. Conteneur MCP
// réel sur un vrai repo git : c'est le câblage qui est vérifié, pas seulement les services.

const SCHEMA = {
  version: 1,
  linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
      { name: 'essai', label: 'Essai', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
      { name: 'bug', label: 'Bug', prefix: 'ISS', category: 'issue', fields: [], statuses: [{ name: 'ouverte' }, { name: 'close' }] },
      {
        name: 'version', label: 'Version', prefix: 'PV', category: 'version', fields: [],
        statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
      },
      {
        name: 'validation', label: 'Validation', prefix: 'VAL', category: 'validation', fields: [],
        statuses: [{ name: 'en_cours' }, { name: 'signee', isApproval: true }, { name: 'annulee', isTerminal: true }],
        decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }],
      },
    ],
  }],
}

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let gitSvc: GitService
let mcp: McpContainer
let tools: Record<string, Handler>
let tick = 0
const T0 = Date.UTC(2026, 10, 1) / 1000

async function commitAll(message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const newReq = async (title = 'R') => (await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title, fields: {} } as never)).id
const newTest = async () => (await mcp.tests.create(dir, { objectTypeRef: 'root::essai', title: 'T', steps: [], fields: {} } as never)).id

/** Version released qui inclut `ids`. */
async function released(title: string, ids: string[]) {
  await commitAll('éléments')
  const v = await mcp.versions.create(dir, { title } as never)
  await mcp.versions.include(dir, v.id, ids)
  await commitAll('version')
  return mcp.versions.release(dir, v.id, `produit-${title}`)
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh271-'))
  gitSvc = new GitService()
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'user.name', value: 'Alice' })
  await git.setConfig({ fs, dir, path: 'user.email', value: 'a@x' })
  await gitSvc.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } } as never
  registerVersionTools(server, mcp)
  registerValidationTools(server, mcp)
  registerIssueTools(server, mcp)
  registerUpdateTools(server, mcp)
  registerBulkImportTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('outils MCP (GH201 L16, GH245 critère 8)', () => {
  it('le MCP lit les versions : mêmes résultats que les services', async () => {
    const reqId = await newReq()
    const testId = await newTest()
    await mcp.requirements.createLink(dir, { type: 'verification', sourceId: testId, targetId: reqId })
    const v = await released('1.0', [reqId])
    const later = await newReq('Après')

    const [node] = await call<Array<{ versionType: string; versions: Array<{ id: string; state: string }>; backlogCount: number }>>('list_versions')
    expect(node.versionType).toBe('root::version')
    expect(node.versions.map(x => [x.id, x.state])).toEqual([[v.id, 'released']])
    expect(node.backlogCount).toBeGreaterThan(0)

    const page = await call<{ state: string; changes: Array<{ id: string }>; version: { freeze: { tag: string } } }>('get_version', { id: v.id })
    expect(page.state).toBe('released')
    expect(page.version.freeze.tag).toBe('produit-1.0')
    expect(page.changes.map(c => c.id)).toEqual([reqId])

    const backlog = await call<unknown[]>('get_version_backlog')
    expect(JSON.stringify(backlog)).toContain(later)
    expect(backlog).toEqual(JSON.parse(JSON.stringify(await mcp.versions.backlog(dir))))

    const impact = await call<{ frozen: boolean; roots: Array<{ id: string }> }>('get_version_impact', { id: v.id })
    expect(impact.frozen).toBe(true)
    expect(impact.roots.map(r => r.id)).toEqual([reqId])

    const toRun = await call<{ tests: Array<{ testId: string }>; uncovered: unknown[] }>('get_version_tests', { id: v.id })
    expect(toRun.tests.map(t => t.testId)).toEqual([testId])
    expect(toRun.uncovered).toEqual([])
  })

  it('le MCP ne passe pas une version released et ne signe pas : aucun outil, et une proposition bloque la signature', async () => {
    const names = Object.keys(tools)
    expect(names.filter(n => /version/.test(n)).sort()).toEqual(['get_version', 'get_version_backlog', 'get_version_impact', 'get_version_tests', 'list_versions'])
    expect(names.filter(n => /validation/.test(n)).sort()).toEqual(['get_validation', 'list_validations', 'propose_validation_decision'])
    expect(names.filter(n => /release|sign|confirm/.test(n))).toEqual([])

    const reqId = await newReq()
    const v = await released('1.0', [reqId])
    const val = await mcp.validations.create(dir, { versionId: v.id, title: 'V', fields: {} })
    const entry = await call<{ proposed: boolean; proposedBy: string }>('propose_validation_decision', { id: val.id, requirementId: reqId, decision: 'conforme' })
    expect(entry).toMatchObject({ proposed: true, proposedBy: 'alice' })
    await expect(mcp.validations.sign(dir, val.id)).rejects.toThrow(/DECISION_PROPOSED/)
    expect((await call<Array<{ id: string; status: string }>>('list_validations')).map(x => [x.id, x.status])).toEqual([[val.id, 'en_cours']])
  })
})

describe('graphe (GH243 U12, GH244 G1, GH245 G1, GH202 scénario 10, GH204 U13)', () => {
  it('expose versions, issues, validations et version testée ; plus de changesets', async () => {
    const reqId = await newReq()
    const otherId = await newReq('Sans décision de design')
    const testId = await newTest()
    await mcp.requirements.createLink(dir, { type: 'verification', sourceId: testId, targetId: reqId })
    const issue = await mcp.issues.create(dir, { objectTypeRef: 'root::bug', title: 'Bug', fields: {}, origin: { runs: ['RUN-A'] } } as never)
    const v = await released('1.0', [reqId])
    const val = await mcp.validations.create(dir, { versionId: v.id, title: 'V', fields: {} })
    await mcp.validations.decide(dir, val.id, { requirementId: reqId, decision: 'conforme' })
    await mcp.validations.decide(dir, val.id, { requirementId: otherId, decision: 'conforme' })
    await mcp.validations.sign(dir, val.id)
    await mcp.campaigns.create(dir, { title: 'C', testCaseIds: [testId] } as never)

    const runDir = path.join(dir, 'test-runs', testId)
    await fsP.mkdir(runDir, { recursive: true })
    const run = (id: string, extra: string[]) => [
      `id: ${id}`, `testCaseId: ${testId}`, 'result: PASS', 'executedAt: 2026-10-01T10:00:00.000Z', 'executedBy: q', 'duration: 1',
      'equipmentUsed: []', 'stepResults: []', 'notes: ""', ...extra, '',
    ].join('\n')
    await fsP.writeFile(path.join(runDir, 'RUN-A.yaml'), run('RUN-A', ['testedConfig:', '  component: produit', `  ref: ${v.id}`, '  label: "1.0"']))
    await fsP.writeFile(path.join(runDir, 'RUN-B.yaml'), run('RUN-B', []))

    // Conteneur neuf : les fichiers de run ci-dessus sont écrits hors du service, après la construction de l'index.
    const { graph } = await createMcpContainer(dir, undefined, 'alice').graph.build(dir) as unknown as { graph: Record<string, Array<Record<string, unknown>>> }

    const version = graph.versions.find(x => x.id === v.id)!
    expect(version).toMatchObject({ state: 'released', freeze: { tag: 'produit-1.0' } })
    const analysis = version.analysis as { computedAt: string; rows: Array<{ id: string; sources: Array<{ rootId: string }> }> }
    expect(analysis.computedAt).toBeTruthy()
    expect(analysis.rows.find(r => r.id === testId)?.sources.map(x => x.rootId)).toEqual([reqId])
    expect(Array.isArray(version.impacted)).toBe(true)

    expect(graph.issues.find(x => x.id === issue.id)).toMatchObject({ title: 'Bug', origin: { runs: ['RUN-A'] } })

    const validation = graph.validations.find(x => x.id === val.id)!
    expect(validation).toMatchObject({ versionId: v.id, state: 'signed' })
    expect((validation.entries as Array<{ requirementId: string }>).map(e => e.requirementId).sort()).toEqual([reqId, otherId].sort())

    const reqs = graph.requirements
    expect(reqs.find(x => x.id === reqId)?.designVersion).toBe(v.id)
    expect(reqs.find(x => x.id === otherId)?.designVersion).toBeNull()

    const runs = graph.runs
    expect(runs.find(r => r.id === 'RUN-A')?.testedConfig).toMatchObject({ ref: v.id })
    expect(runs.find(r => r.id === 'RUN-B')?.testedConfig).toBeNull()

    expect(graph).not.toHaveProperty('changesets')
    expect(graph.campaigns[0]).not.toHaveProperty('baselineRef')
    expect(graph.campaigns[0]).not.toHaveProperty('changeset')
  })
})

describe('écritures refusées', () => {
  it('GH204, cas limite — décision prise sur une version en cours, exigence modifiée, puis release : décision à revoir, signature refusée', async () => {
    const reqId = await newReq()
    await commitAll('éléments')
    const v = await mcp.versions.create(dir, { title: '1.0' } as never)
    await mcp.versions.include(dir, v.id, [reqId])
    const val = await mcp.validations.create(dir, { versionId: v.id, title: 'V', fields: {} })
    await mcp.validations.decide(dir, val.id, { requirementId: reqId, decision: 'conforme' })
    await mcp.requirements.update(dir, reqId, { title: 'Modifiée après la décision' })
    await commitAll('modification')
    await mcp.versions.release(dir, v.id, 'produit-1.0')
    const page = await mcp.validations.page(dir, val.id)
    expect(page.rows.find(r => r.requirementId === reqId)).toMatchObject({ decision: 'conforme', review: 'content' })
    await expect(mcp.validations.sign(dir, val.id)).rejects.toThrow(/DECISION_TO_REVIEW/)
  })

  it('GH243 U9 — `changesetId` retiré : ignoré par le schéma d\'import, jamais écrit', async () => {
    const dto = CreateRequirementSchema.parse({ objectTypeRef: 'root::exigence', title: 'R', fields: {}, changesetId: 'NC-0001' })
    expect(dto).not.toHaveProperty('changesetId')
    const created = await mcp.requirements.create(dir, dto as never)
    expect(await gitSvc.readYaml(dir, `requirements/${created.id}.yaml`)).not.toHaveProperty('changesetId')
  })

  it('GH201 L9, critère 11 — repo en lecture seule (HEAD détachée) : version refusée en création et en écriture', async () => {
    const reqId = await newReq()
    await commitAll('éléments')
    const v = await mcp.versions.create(dir, { title: '1.0' } as never)
    await commitAll('version')
    await git.checkout({ fs, dir, ref: await git.resolveRef({ fs, dir, ref: 'HEAD' }) })
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])
    expect(await code(mcp.versions.create(dir, { title: '2.0' } as never))).toBe('READONLY_REPO')
    expect(await code(mcp.versions.update(dir, v.id, { title: 'x' }))).toBe('READONLY_REPO')
    expect(await code(mcp.versions.include(dir, v.id, [reqId]))).toBe('READONLY_REPO')
    expect(await code(mcp.versions.release(dir, v.id, 'tag'))).toBe('READONLY_REPO')
  })

  it('GH204 U15 — version abandonnée : validation en cours non signable', async () => {
    const reqId = await newReq()
    const v = await released('1.0', [reqId])
    const val = await mcp.validations.create(dir, { versionId: v.id, title: 'V', fields: {} })
    await mcp.validations.decide(dir, val.id, { requirementId: reqId, decision: 'conforme' })
    await mcp.versions.update(dir, v.id, { status: 'abandonnee' })
    await expect(mcp.validations.sign(dir, val.id)).rejects.toThrow(/VERSION_NOT_RELEASED|VERSION_ABANDONED/)
    expect((await mcp.validations.get(dir, val.id)).status).toBe('en_cours')
  })

  it('GH243 U8 — MCP : statut brouillon et titre sur une approuvée : rouverte (version + 1), puis titre écrit', async () => {
    const reqId = await newReq()
    await mcp.requirements.transition(dir, reqId, { toStatus: 'approved' })
    const res = await call<{ errors: unknown[]; updated: Array<{ version: number }> }>('update_requirements', { entries: [{ id: reqId, status: 'draft', title: 'Nouveau' }], dryRun: false })
    expect(res.errors).toEqual([])
    const after = await mcp.requirements.findOne(dir, reqId)
    expect(after).toMatchObject({ status: 'draft', title: 'Nouveau', version: 2 })
  })
})
