import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Issue, Requirement, TestCampaign, TestCase } from '@polenta/types'
import { applyAudit, auditForWrite, contentChanged, readAuditFields } from './audit-fields.util'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { HistoryService } from './history.service'
import { IssuesService } from './issues.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { RevalidationService } from './revalidation.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH340 — dates de création / modification stockées dans le YAML, posées par l'application
// (scénarios W1–W13, R1–R5 de specs/GH340-tests.md). Vrai GitService sur un dossier temporaire.

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        fields: [{ name: 'priority', type: 'enum', values: ['high', 'low'], trackHistory: true }, { name: 'owner', type: 'user' }],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
      { name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [], statuses: [{ name: 'draft' }] },
      { name: 'bug', label: 'Bug', prefix: 'PI', category: 'issue', fields: [{ name: 'note', type: 'text' }], statuses: [{ name: 'ouverte' }] },
      { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [] },
    ],
  }],
  linkTypes: [],
}

const T0 = '2026-11-01T08:00:00Z'
const T1 = '2026-11-02T09:30:00Z'

let dir: string
let git: GitService
let clock: Date
let who: string
let reqIndex: RequirementsIndexService
let testsIndex: TestsIndexService
let requirements: RequirementsService
let tests: TestsService
let issues: IssuesService
let campaigns: CampaignsService
let revalidation: RevalidationService

const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => SCHEMA } as unknown as SchemaService
const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>
const raw = (file: string) => fsP.readFile(path.join(dir, file), 'utf-8')
/** Avance l'horloge et change d'auteur : la prochaine écriture se distingue de la création. */
const later = () => { clock = new Date(T1); who = 'sdupont' }

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh340-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  clock = new Date(T0)
  who = 'lolive'
  reqIndex = new RequirementsIndexService(git)
  testsIndex = new TestsIndexService(git)
  const history = new HistoryService(git, async () => ({ by: who }), () => clock)
  revalidation = new RevalidationService(git, reqIndex, testsIndex, schemaStub, undefined, history)
  requirements = new RequirementsService(git, reqIndex, schemaStub, revalidation, history)
  tests = new TestsService(git, testsIndex, schemaStub, revalidation, history)
  issues = new IssuesService(git, schemaStub, history)
  campaigns = new CampaignsService(git, tests, undefined, undefined, history)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

const newReq = (fields: Record<string, unknown> = {}) =>
  requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields } as never)
const newTest = () =>
  tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [{ order: 1, action: 'a', expectedResult: 'b' }] } as never)
const newIssue = () => issues.create(dir, { objectTypeRef: 'root::bug', title: 'I', fields: {} })

const CREATED = { createdAt: T0, createdBy: 'lolive', updatedAt: T0, updatedBy: 'lolive' }
const UPDATED = { createdAt: T0, createdBy: 'lolive', updatedAt: T1, updatedBy: 'sdupont' }

describe('audit-fields.util', () => {
  it('contentChanged ignore les clés de l\'application', () => {
    const a = { id: 'X', title: 't', fields: { a: 1 }, version: 1, history: {}, needsRevalidation: true, objectTypeRef: 'r::a', updatedAt: T0 }
    expect(contentChanged(a, { ...a, version: 2, history: { status: [] }, needsRevalidation: undefined, objectTypeRef: 'r::b', updatedAt: T1 })).toBe(false)
    expect(contentChanged(a, { ...a, fields: { a: 2 } })).toBe(true)
    expect(contentChanged(a, { ...a, status: 'review' })).toBe(true)
  })

  it('applyAudit : création, contenu changé, contenu identique', () => {
    expect(applyAudit(null, { id: 'X' }, 'lolive', T0)).toMatchObject(CREATED)
    const before = { id: 'X', title: 'a', ...CREATED }
    expect(applyAudit(before, { ...before, title: 'b' }, 'sdupont', T1)).toMatchObject(UPDATED)
    expect(applyAudit(before, { ...before, updatedAt: null }, 'sdupont', T1)).toMatchObject(CREATED)
  })

  it('R3 — date non quotée (Date au chargement) normalisée ; absente → null', () => {
    expect(readAuditFields({ createdAt: new Date(T0), updatedBy: 'x' })).toEqual({ createdAt: T0, createdBy: null, updatedAt: null, updatedBy: 'x' })
  })

  it('auditForWrite ne garde jamais une date inconnue', () => {
    expect(auditForWrite({ id: 'X', createdAt: null, createdBy: null, updatedAt: T1, updatedBy: 'x' })).toEqual({ id: 'X', updatedAt: T1, updatedBy: 'x' })
  })
})

describe('écriture', () => {
  it('W1 — création d\'une exigence, d\'un test, d\'une issue : les quatre champs dans le fichier', async () => {
    const req = await newReq()
    const tc = await newTest()
    const issue = await newIssue()
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject(CREATED)
    expect(await onDisk<TestCase>(`tests/${tc.id}.yaml`)).toMatchObject(CREATED)
    expect(await onDisk<Issue>(`issues/${issue.id}.yaml`)).toMatchObject(CREATED)
  })

  it('W2 — modification d\'un champ : la modification avance, la création reste', async () => {
    const req = await newReq()
    later()
    const updated = await requirements.update(dir, req.id, { fields: { owner: 'x' } } as never)
    expect(updated).toMatchObject(UPDATED)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject(UPDATED)
  })

  it('W3 — transition de statut : la modification avance', async () => {
    const req = await newReq()
    later()
    await requirements.transition(dir, req.id, { toStatus: 'approved' } as never)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject(UPDATED)
  })

  it('W3b — une même sauvegarde : entrée d\'historique et updatedAt au même instant, même auteur', async () => {
    let ticks = 0
    const ticking = new HistoryService(git, async () => ({ by: 'sdupont' }), () => new Date(Date.parse(T1) + 1000 * ticks++))
    const reqs = new RequirementsService(git, reqIndex, schemaStub, undefined, ticking)
    const req = await newReq()
    await reqs.transition(dir, req.id, { toStatus: 'approved' } as never)
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    const last = file.history?.status.at(-1)
    expect(last).toMatchObject({ value: 'approved', by: 'sdupont' })
    expect(file.updatedAt).toBe(last?.at)
    expect(file.updatedBy).toBe(last?.by)
  })

  it('W4 — réenregistrement à l\'identique : fichier inchangé à l\'octet près', async () => {
    const req = await newReq({ owner: 'x' })
    const before = await raw(`requirements/${req.id}.yaml`)
    later()
    await requirements.update(dir, req.id, { fields: { owner: 'x' } } as never)
    expect(await raw(`requirements/${req.id}.yaml`)).toBe(before)
  })

  it('W5 — commentaire de modification sans changement de champ : dates inchangées', async () => {
    const req = await newReq({ owner: 'x' })
    later()
    await requirements.update(dir, req.id, { fields: { owner: 'x' }, modificationComment: 'rien' } as never)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject(CREATED)
  })

  it('W6 — levée de needsRevalidation : dates inchangées', async () => {
    const req = await newReq()
    await git.writeYaml(dir, `requirements/${req.id}.yaml`, { ...(await onDisk<object>(`requirements/${req.id}.yaml`)), needsRevalidation: true })
    reqIndex.invalidate(dir)
    later()
    expect((await revalidation.clear(dir, [req.id])).cleared).toEqual([req.id])
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.needsRevalidation).toBeUndefined()
    expect(file).toMatchObject(CREATED)
  })

  it('W7 — changement de type (déplacement) : dates inchangées', async () => {
    const req = await newReq()
    const tc = await newTest()
    later()
    await requirements.retargetObjectTypeRef(dir, 'root::exigence', 'root::exigence-bis')
    await tests.update(dir, tc.id, { objectTypeRef: 'root::test-bis' } as never)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject({ objectTypeRef: 'root::exigence-bis', ...CREATED })
    expect(await onDisk<TestCase>(`tests/${tc.id}.yaml`)).toMatchObject(CREATED)
  })

  it('W8 — renommage de champ (exigence, issue) : dates inchangées et toujours écrites', async () => {
    const req = await newReq({ owner: 'x' })
    const issue = await issues.update(dir, (await newIssue()).id, { fields: { note: 'n' } })
    const issueDates = { createdAt: issue.createdAt, updatedAt: issue.updatedAt }
    later()
    const result = { migrated: [], skipped: [], failed: [] }
    await requirements.renameFieldKeys(dir, 'root::exigence', [{ from: 'owner', to: 'responsable' }], result)
    await issues.renameFieldKeys(dir, 'root::bug', [{ from: 'note', to: 'remarque' }], result)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject({ fields: { responsable: 'x' }, ...CREATED })
    expect(await onDisk<Issue>(`issues/${issue.id}.yaml`)).toMatchObject({ fields: { remarque: 'n' }, ...issueDates })
  })

  it('W9 — reprise d\'historique (updateHistory) : dates inchangées', async () => {
    const req = await newReq()
    later()
    await requirements.updateHistory(dir, req.id, cur => ({ ...cur.history, status: [{ value: 'draft', at: '2026-01-01T00:00:00Z', by: 'git', source: 'git' }] }))
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject(CREATED)
  })

  it('W10 — run ou décision ajouté à une issue : la modification avance', async () => {
    const issue = await newIssue()
    later()
    await issues.addRun(dir, issue.id, 'RUN-1')
    expect(await onDisk<Issue>(`issues/${issue.id}.yaml`)).toMatchObject(UPDATED)
  })

  it('W12 — objet non repris (sans dates) modifié : updatedAt seul, jamais de null écrit', async () => {
    const req = await newReq()
    const { createdAt: _a, createdBy: _b, updatedAt: _c, updatedBy: _d, ...bare } = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    await git.writeYaml(dir, `requirements/${req.id}.yaml`, bare)
    reqIndex.invalidate(dir)
    later()
    await requirements.update(dir, req.id, { fields: { owner: 'y' } } as never)
    const text = await raw(`requirements/${req.id}.yaml`)
    expect(text).not.toMatch(/createdAt|createdBy|null/)
    expect(await onDisk<Requirement>(`requirements/${req.id}.yaml`)).toMatchObject({ updatedAt: T1, updatedBy: 'sdupont' })
  })
})

describe('lecture', () => {
  it('R1 / R2 — index construit depuis le YAML, sans lecture de l\'historique git ; absent → null', async () => {
    const req = await newReq()
    const bare = { id: 'SYS-0099', projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: 'Ancienne', status: 'draft', version: 1, fields: {}, jiraLinks: [] }
    await git.writeYaml(dir, 'requirements/SYS-0099.yaml', bare)
    const log = vi.spyOn(git, 'fileHistory')
    const freshReq = new RequirementsIndexService(git)
    const freshTests = new TestsIndexService(git)
    const [reqs] = await Promise.all([freshReq.findAll(dir, {}), freshTests.findAll(dir), new IssuesService(git, schemaStub).findAll(dir)])
    expect(log).not.toHaveBeenCalled()
    expect(reqs.find(r => r.id === req.id)).toMatchObject(CREATED)
    expect(reqs.find(r => r.id === 'SYS-0099')).toMatchObject({ createdAt: null, createdBy: null, updatedAt: null, updatedBy: null })
  })

  it('R5 — la copie testSnapshot d\'une campagne ne porte pas les dates du test', async () => {
    const tc = await newTest()
    const c = await campaigns.create(dir, { title: 'C', objectTypeRef: 'root::campagne', fields: {}, testCaseIds: [tc.id] } as never)
    const file = await onDisk<TestCampaign>(`campaigns/${c.id}.yaml`)
    expect(file.runs.length).toBeGreaterThan(0)
    for (const run of file.runs) {
      for (const k of ['createdAt', 'createdBy', 'updatedAt', 'updatedBy']) expect(run.testSnapshot).not.toHaveProperty(k)
    }
  })
})
