import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, TestCampaign, TestRun } from '@polenta/types'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { GitService } from './git.service'
import { ResultsImportError, gitUserName } from './results-import.service'

// GH129 — import JUnit sans interface : service (specs/GH129-tests.md, scénarios 7–19).

const TEST_TYPE: ObjectTypeDefinition = {
  name: 'test-auto', label: 'Test auto', prefix: 'TA', category: 'test',
  fields: [{ name: 'automationId', label: 'Automation ID', type: 'text' }],
  statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }, { name: 'obsolete', isTerminal: true }],
} as ObjectTypeDefinition

const schemaWith = (extra: Partial<ProjectSchema> = {}, types: ObjectTypeDefinition[] = []): ProjectSchema => ({
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft' }] },
      TEST_TYPE,
      ...types,
    ],
  }],
  linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
  ...extra,
} as unknown as ProjectSchema)

let dir: string
let xmlDir: string
let c: McpContainer

async function writeXml(name: string, body: string, timestamp: string | null = '2026-11-07T10:00:00Z'): Promise<string> {
  const file = path.join(xmlDir, name)
  await fsP.writeFile(file, `<?xml version="1.0"?><testsuite name="s"${timestamp ? ` timestamp="${timestamp}"` : ''}>${body}</testsuite>`)
  return file
}
const tc = (classname: string, name: string, inner = '', reqs: string[] = []) =>
  `<testcase classname="${classname}" name="${name}" time="1.4">${reqs.length ? `<properties>${reqs.map(r => `<property name="requirement" value="${r}"/>`).join('')}</properties>` : ''}${inner}</testcase>`

async function createTest(title: string, automationId?: string, objectTypeRef = 'root::test-auto', status?: string): Promise<string> {
  const t = await c.tests.create(dir, {
    title, objectTypeRef, fields: automationId ? { automationId } : {},
    steps: [{ order: 1, action: 'a', expectedResult: 'b', notes: '' }],
    ...(status && { status }),
  } as never)
  return t.id
}
async function createReq(title: string): Promise<string> {
  return (await c.requirements.create(dir, { objectTypeRef: 'root::exigence', title, fields: {} } as never)).id
}
const runsOf = async (id: string): Promise<TestRun[]> => {
  const files = await fsP.readdir(path.join(dir, 'test-runs', id)).catch(() => [] as string[])
  return Promise.all(files.map(async f => (await c.git.readYaml<TestRun>(dir, `test-runs/${id}/${f}`))!))
}
const run = (files: string[], extra: Partial<Parameters<McpContainer['resultsImport']['importJunit']>[0]> = {}) =>
  c.resultsImport.importJunit({ repoPath: dir, files, dryRun: false, executedBy: 'ci', ...extra })

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh129-'))
  xmlDir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh129-xml-'))
  await new GitService().writeYaml(dir, '.polenta/schema.yaml', schemaWith())
  c = createMcpContainer(dir)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
  await fsP.rm(xmlDir, { recursive: true, force: true })
})

describe('correspondance par automationId', () => {
  it('classname.name puis name : run écrit, origine, verdict, sans étapes, durée ; skipped ignoré (7)', async () => {
    const full = await createTest('Plein', 'tests.test_a.test_one')
    const short = await createTest('Court', 'test_two')
    const file = await writeXml('a.xml',
      tc('tests.test_a', 'test_one') + tc('tests.test_a', 'test_two', '<failure message="boom"/>') + tc('tests.test_a', 'test_skip', '<skipped/>'))
    const report = await run([file])
    expect(report.exitCode).toBe(0)
    expect(report.counts).toMatchObject({ results: 3, imported: 2, skipped: 1, unmapped: 0 })
    const [r1] = await runsOf(full)
    expect(r1).toMatchObject({ result: 'PASS', origin: 'junit-import', stepResults: [], duration: 1, executedBy: 'ci', executedAt: '2026-11-07T10:00:00.000Z' })
    expect(r1.campaignEntry).toBeUndefined()
    expect(r1.notes).toContain('tests.test\\_a.test\\_one')
    expect((await runsOf(short))[0]).toMatchObject({ result: 'FAIL' })
  })

  it('error → BLOCKED ; testcase inconnu → unmapped, code 1', async () => {
    const id = await createTest('E', 'test_err')
    const file = await writeXml('a.xml', tc('k', 'test_err', '<error message="setup"/>') + tc('k', 'nobody'))
    const report = await run([file])
    expect((await runsOf(id))[0].result).toBe('BLOCKED')
    expect(report.exitCode).toBe(1)
    expect(report.notImported).toEqual([{ file, testcase: 'k.nobody', reason: 'unmapped' }])
  })

  it('même automationId sur deux tests → ambiguous, aucun run (8)', async () => {
    const a = await createTest('A', 'dup')
    const b = await createTest('B', 'dup')
    const report = await run([await writeXml('a.xml', tc('k', 'dup'))])
    expect(report.notImported[0]).toMatchObject({ reason: 'ambiguous', candidates: [a, b].sort() })
    expect(report.exitCode).toBe(1)
    expect(await runsOf(a)).toHaveLength(0)
  })

  it('test obsolète (statut terminal) exclu', async () => {
    const id = await createTest('Vieux', 'old', 'root::test-auto', 'obsolete')
    const report = await run([await writeXml('a.xml', tc('k', 'old'))])
    expect(report.notImported[0].reason).toBe('unmapped')
    expect(await runsOf(id)).toHaveLength(0)
  })
})

describe('secours par la propriété requirement (9)', () => {
  it('un seul test sans automationId couvrant l\'exigence, lien dans les deux sens', async () => {
    const req1 = await createReq('R1')
    const req2 = await createReq('R2')
    const t1 = await createTest('T1')
    const t2 = await createTest('T2')
    await c.reqIndex.createLink(dir, { type: 'verification', sourceId: t1, targetId: req1 })
    await c.reqIndex.createLink(dir, { type: 'verification', sourceId: req2, targetId: t2 })
    const report = await run([await writeXml('a.xml', tc('k', 'x', '', [req1]) + tc('k', 'y', '', [req2, 'FAN-SYS-01']))])
    expect(report.counts.imported).toBe(2)
    expect(await runsOf(t1)).toHaveLength(1)
    expect(await runsOf(t2)).toHaveLength(1)
    expect(report.warnings.filter(w => w.code === 'mapped_by_requirement').map(w => w.testId).sort()).toEqual([t1, t2].sort())
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'unknown_requirement', detail: 'FAN-SYS-01' }))
  })

  it('deux candidats → ambiguous ; un test qui a un automationId n\'est pas candidat', async () => {
    const req = await createReq('R')
    const a = await createTest('A')
    const b = await createTest('B')
    const automated = await createTest('C', 'other')
    for (const t of [a, b, automated]) await c.reqIndex.createLink(dir, { type: 'verification', sourceId: t, targetId: req })
    const report = await run([await writeXml('a.xml', tc('k', 'x', '', [req]))])
    expect(report.notImported[0]).toMatchObject({ reason: 'ambiguous', candidates: [a, b].sort() })
  })
})

describe('agrégation (10)', () => {
  it('deux fichiers, même test → un run, verdict le pire, une ligne par source, date la plus récente', async () => {
    const id = await createTest('T', 'test_x')
    const f1 = await writeXml('sim32.xml', tc('k', 'test_x'), '2026-11-07T10:00:00Z')
    const f2 = await writeXml('sim64.xml', tc('k', 'test_x', '<failure message="drift"/>'), '2026-11-07T11:00:00Z')
    const report = await run([f1, f2])
    const runs = await runsOf(id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ result: 'FAIL', executedAt: '2026-11-07T11:00:00.000Z', duration: 3 })
    expect(runs[0].notes).toContain('sim32.xml')
    expect(runs[0].notes).toContain('sim64.xml')
    expect(report.imported[0].sources).toHaveLength(2)
  })
})

describe('campagne (11–13)', () => {
  it('entrée mise à jour, run rattaché, campagne in_progress ; test hors campagne → not_in_campaign', async () => {
    const inside = await createTest('In', 'in')
    await createTest('Out', 'out')
    const camp = await c.campaigns.create(dir, { title: 'C', testCaseIds: [inside] } as never)
    const report = await run([await writeXml('a.xml', tc('k', 'in', '<failure/>') + tc('k', 'out'))], { campaignId: camp.id })
    expect(report.notImported).toEqual([expect.objectContaining({ testcase: 'k.out', reason: 'not_in_campaign' })])
    const [r] = await runsOf(inside)
    expect(r.campaignEntry).toEqual({ campaignId: camp.id, entryId: camp.runs[0].entryId })
    const after = (await c.git.readYaml<TestCampaign>(dir, `campaigns/${camp.id}.yaml`))!
    expect(after.status).toBe('in_progress')
    expect(after.runs[0]).toMatchObject({ status: 'FAIL', runId: r.id, executedBy: 'ci', executedAt: '2026-11-07T10:00:00.000Z' })
  })

  it('deux entrées du même test départagées par requirementId', async () => {
    const id = await createTest('Param', 'p')
    const camp = await c.campaigns.create(dir, { title: 'C', testCaseIds: [id, id] } as never)
    const file = await c.git.readYaml<TestCampaign>(dir, `campaigns/${camp.id}.yaml`)
    file!.runs[0].requirementId = 'SYS-0007'
    file!.runs[1].requirementId = 'SYS-0008'
    await c.git.writeYaml(dir, `campaigns/${camp.id}.yaml`, file)
    const ambiguous = await run([await writeXml('a.xml', tc('k', 'p'))], { campaignId: camp.id, dryRun: true })
    expect(ambiguous.notImported[0].reason).toBe('ambiguous')
    const report = await run([await writeXml('b.xml', tc('k', 'p', '', ['SYS-0008']))], { campaignId: camp.id })
    expect(report.imported[0].entryId).toBe(file!.runs[1].entryId)
    expect((await runsOf(id))[0].requirementId).toBe('SYS-0008')
  })

  it('campagne inconnue ou clôturée → erreur globale, rien écrit (12)', async () => {
    const id = await createTest('T', 't')
    const camp = await c.campaigns.create(dir, { title: 'C', testCaseIds: [id] } as never)
    const file = await writeXml('a.xml', tc('k', 't'))
    await expect(run([file], { campaignId: 'CAMP-9999' })).rejects.toMatchObject({ code: 'campaign_not_found' })
    const closed = (await c.git.readYaml<TestCampaign>(dir, `campaigns/${camp.id}.yaml`))!
    await c.git.writeYaml(dir, `campaigns/${camp.id}.yaml`, { ...closed, status: 'completed' })
    await expect(run([file], { campaignId: camp.id })).rejects.toBeInstanceOf(ResultsImportError)
    await expect(run([file], { campaignId: camp.id })).rejects.toMatchObject({ code: 'campaign_closed' })
    expect(await runsOf(id)).toHaveLength(0)
  })

  it('version sélectionnable : obligatoire ; ID → testedConfig ; texte inconnu → écart (13)', async () => {
    const versionType = {
      name: 'version', label: 'Version', prefix: 'PV', category: 'version', fields: [],
      statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
    } as unknown as ObjectTypeDefinition
    await c.git.writeYaml(dir, '.polenta/schema.yaml', schemaWith({}, [versionType]))
    c = createMcpContainer(dir)
    await c.git.writeYaml(dir, 'versions/PV-0001.yaml', { id: 'PV-0001', objectTypeRef: 'root::version', title: '1.2.0', status: 'en_cours', version: 1, fields: {} })
    const id = await createTest('T', 't')
    const camp = await c.campaigns.create(dir, { title: 'C', testCaseIds: [id] } as never)
    const file = await writeXml('a.xml', tc('k', 't'))
    await expect(run([file], { campaignId: camp.id })).rejects.toMatchObject({ code: 'tested_version_required' })
    expect(await runsOf(id)).toHaveLength(0)

    const undocumented = await run([file], { campaignId: camp.id, testedVersion: 'build-42', dryRun: true })
    expect(undocumented.warnings).toContainEqual(expect.objectContaining({ code: 'tested_version_undocumented' }))

    await run([file], { campaignId: camp.id, testedVersion: '1.2.0' })
    expect((await runsOf(id))[0].testedConfig).toMatchObject({ ref: 'PV-0001', label: '1.2.0' })
  })
})

describe('dry run, réimport, contrôles (14–19)', () => {
  it('dry run : même rapport, aucun fichier (14) ; réimport : déjà importé, code 0 (15)', async () => {
    const id = await createTest('T', 't')
    const file = await writeXml('a.xml', tc('k', 't'))
    const dry = await run([file], { dryRun: true })
    expect(await runsOf(id)).toHaveLength(0)
    const real = await run([file])
    expect({ ...dry, dryRun: false, imported: dry.imported.map(i => ({ ...i, runId: real.imported[0].runId })) }).toEqual(real)
    const again = await run([file])
    expect(again.counts).toMatchObject({ imported: 0, alreadyImported: 1 })
    expect(again.exitCode).toBe(0)
    expect(await runsOf(id)).toHaveLength(1)
  })

  it('résultats datés et non datés : la date du rapport daté est retenue', async () => {
    const id = await createTest('T', 't')
    const dated = await writeXml('a.xml', tc('k', 't'), '2026-11-07T08:00:00Z')
    const undated = await writeXml('b.xml', tc('k', 't'), null)
    await run([dated, undated])
    expect((await runsOf(id))[0].executedAt).toBe('2026-11-07T08:00:00.000Z')
    expect((await run([dated, undated])).counts.alreadyImported).toBe(1)
  })

  it('run déjà écrit, entrée de campagne restée en attente : l\'entrée est complétée', async () => {
    const id = await createTest('T', 't')
    const camp = await c.campaigns.create(dir, { title: 'C', testCaseIds: [id] } as never)
    const entryId = camp.runs[0].entryId
    // Import interrompu entre les deux écritures : run écrit, entrée non mise à jour.
    const written = await c.tests.execute(dir, id, {
      stepResults: [], result: 'PASS', executedAt: '2026-11-07T10:00:00.000Z', origin: 'junit-import',
      campaignEntry: { campaignId: camp.id, entryId },
    })
    const report = await run([await writeXml('a.xml', tc('k', 't'))], { campaignId: camp.id })
    expect(report.counts.alreadyImported).toBe(1)
    const after = (await c.git.readYaml<TestCampaign>(dir, `campaigns/${camp.id}.yaml`))!
    expect(after.runs[0]).toMatchObject({ status: 'PASS', runId: written.id })
  })

  it('sans timestamp : avertissement, réimport non détecté', async () => {
    const id = await createTest('T', 't')
    const file = await writeXml('a.xml', tc('k', 't'), null)
    const report = await run([file])
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'no_timestamp', file }))
    expect(await runsOf(id)).toHaveLength(1)
  })

  it('aucun type ne déclare automationId (16)', async () => {
    const s = schemaWith()
    s.nodes[0].objectTypes = s.nodes[0].objectTypes!.map(t => ({ ...t, fields: [] }))
    await c.git.writeYaml(dir, '.polenta/schema.yaml', s)
    c = createMcpContainer(dir)
    const report = await run([await writeXml('a.xml', tc('k', 't'))])
    expect(report.warnings[0].code).toBe('no_automation_field')
    expect(report.counts.unmapped).toBe(1)
  })

  it('champ d\'exécution obligatoire → required_field_missing, les autres importés (17)', async () => {
    const strict = { ...TEST_TYPE, name: 'test-strict', prefix: 'TS', runFields: [{ name: 'report', label: 'Rapport', type: 'text', required: true }] } as ObjectTypeDefinition
    await c.git.writeYaml(dir, '.polenta/schema.yaml', schemaWith({}, [strict]))
    c = createMcpContainer(dir)
    const refused = await createTest('S', 'strict', 'root::test-strict')
    const fine = await createTest('F', 'fine')
    const report = await run([await writeXml('a.xml', tc('k', 'strict') + tc('k', 'fine'))])
    expect(report.notImported).toEqual([expect.objectContaining({ reason: 'required_field_missing', field: 'report', candidates: [refused] })])
    expect(await runsOf(refused)).toHaveLength(0)
    expect(await runsOf(fine)).toHaveLength(1)
  })

  it('nœud readonly → readonly_node (18)', async () => {
    const id = await createTest('T', 't')
    const s = schemaWith()
    s.nodes[0].readonly = true
    await c.git.writeYaml(dir, '.polenta/schema.yaml', s)
    c = createMcpContainer(dir)
    const report = await run([await writeXml('a.xml', tc('k', 't'))])
    expect(report.notImported[0]).toMatchObject({ reason: 'readonly_node', candidates: [id] })
    expect(await runsOf(id)).toHaveLength(0)
  })

  it('test non approuvé : avertissement seulement', async () => {
    await createTest('T', 't')
    const report = await run([await writeXml('a.xml', tc('k', 't'))])
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'test_not_approved' }))
    expect(report.exitCode).toBe(0)
  })

  it('executedBy : user.name git du dépôt englobant (19)', async () => {
    await git.init({ fs, dir, defaultBranch: 'main' })
    await git.setConfig({ fs, dir, path: 'user.name', value: 'Robot CI' })
    const sub = path.join(dir, 'polenta')
    await fsP.mkdir(sub)
    expect(await gitUserName(sub)).toBe('Robot CI')
    const id = await createTest('T', 't')
    await c.resultsImport.importJunit({ repoPath: dir, files: [await writeXml('a.xml', tc('k', 't'))], dryRun: false })
    expect((await runsOf(id))[0].executedBy).toBe('Robot CI')
  })

  it('fichier illisible ou XML invalide → erreur globale', async () => {
    await expect(run([path.join(xmlDir, 'absent.xml')])).rejects.toMatchObject({ code: 'file_unreadable' })
    const bad = path.join(xmlDir, 'bad.xml')
    await fsP.writeFile(bad, '<testsuite><testcase></testsuite>')
    await expect(run([bad])).rejects.toMatchObject({ code: 'invalid_xml' })
    await expect(run([])).rejects.toMatchObject({ code: 'no_files' })
  })
})
