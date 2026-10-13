import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCampaign, TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { HistoryService, readEffectiveHistory } from './history.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { RevalidationService } from './revalidation.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { createMcpContainer } from '../../mcp-server/container'

// GH77 — alimentation de l'historique par les écritures réelles des services (scénarios W1–W15,
// L1–L2 de specs/GH77-tests.md). Vrai GitService sur un dossier temporaire (pas un repo git :
// aucun commit, donc dates de repli absentes).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        fields: [
          { name: 'priority', type: 'enum', values: ['high', 'low'], trackHistory: true },
          { name: 'statement', type: 'richtext', trackHistory: true },
          { name: 'owner', type: 'user' },
        ],
        statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
      },
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
        statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
      },
      {
        name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign',
        fields: [{ name: 'lot', type: 'text', trackHistory: true }],
      },
    ],
  }],
  linkTypes: [],
}

const NOW = new Date('2026-10-13T10:00:00Z')
const AT = '2026-10-13T10:00:00Z'

let dir: string
let git: GitService
let reqIndex: RequirementsIndexService
let testsIndex: TestsIndexService
let history: HistoryService
let requirements: RequirementsService
let tests: TestsService
let campaigns: CampaignsService
let revalidation: RevalidationService

const schemaStub = {
  resolveComponentRepoPath: async () => null,
  get: async () => SCHEMA,
} as unknown as SchemaService

const onDisk = <T>(file: string) => git.readYaml<T>(dir, file) as Promise<T>

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh77-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  reqIndex = new RequirementsIndexService(git)
  testsIndex = new TestsIndexService(git)
  history = new HistoryService(git, async () => ({ by: 'lolive' }), () => NOW)
  revalidation = new RevalidationService(git, reqIndex, testsIndex, schemaStub, undefined, history)
  requirements = new RequirementsService(git, reqIndex, schemaStub, undefined, revalidation, history)
  tests = new TestsService(git, testsIndex, schemaStub, undefined, revalidation, history)
  campaigns = new CampaignsService(git, tests, undefined, history)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

const newReq = (fields: Record<string, unknown> = {}) =>
  requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields } as never)
const newTest = () =>
  tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [{ order: 1, action: 'a', expectedResult: 'b' }] } as never)

describe('exigences', () => {
  it('W1 — création : statut draft et champs suivis, by = acteur', async () => {
    const req = await newReq({ priority: 'high' })
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history).toEqual({
      status: [{ value: 'draft', at: AT, by: 'lolive' }],
      priority: [{ value: 'high', at: AT, by: 'lolive' }],
    })
  })

  it('W2 — transition, openDraft, update d\'un champ suivi : une entrée chacun', async () => {
    const req = await newReq()
    await requirements.transition(dir, req.id, { toStatus: 'approved' } as never)
    await requirements.openDraft(dir, req.id, 'draft')
    await requirements.update(dir, req.id, { fields: { priority: 'low', statement: '<p>s</p>' } } as never)
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.status.map(e => e.value)).toEqual(['draft', 'approved', 'draft'])
    expect(file.history?.priority).toEqual([{ value: 'low', at: AT, by: 'lolive' }])
    expect(file.history?.statement).toEqual([{ at: AT, by: 'lolive' }])
  })

  it('W3 — update sans changement (autosave) ou sur un champ non suivi : aucune entrée', async () => {
    const req = await newReq({ priority: 'high' })
    await requirements.update(dir, req.id, { fields: { priority: 'high' } } as never)
    await requirements.update(dir, req.id, { fields: { owner: 'mdupont' } } as never)
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.status).toHaveLength(1)
    expect(file.history?.priority).toHaveLength(1)
    expect(file.history?.owner).toBeUndefined()
  })

  it('acteur résolu seulement quand une entrée est ajoutée', async () => {
    let calls = 0
    const counting = new HistoryService(git, async () => { calls++; return { by: 'lolive' } }, () => NOW)
    const reqs = new RequirementsService(git, reqIndex, schemaStub, undefined, undefined, counting)
    const req = await reqs.create(dir, { objectTypeRef: 'root::exigence', title: 'R' } as never)
    expect(calls).toBe(1)
    await reqs.update(dir, req.id, { fields: { owner: 'x' } } as never)
    expect(calls).toBe(1)
  })

  it('W10 — retargetObjectTypeRef : aucune entrée', async () => {
    const req = await newReq()
    await requirements.retargetObjectTypeRef(dir, 'root::exigence', 'root::exigence')
    expect((await onDisk<Requirement>(`requirements/${req.id}.yaml`)).history?.status).toHaveLength(1)
  })

  it('W14 — fichier pré-GH77 sans history : l\'historique démarre par la valeur avant (source schema)', async () => {
    await git.writeYaml(dir, 'requirements/SYS-0001.yaml', {
      id: 'SYS-0001', projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: 'Ancienne',
      status: 'review', version: 1, fields: {}, jiraLinks: [],
    })
    await requirements.transition(dir, 'SYS-0001', { toStatus: 'approved' } as never)
    const file = await onDisk<Requirement>('requirements/SYS-0001.yaml')
    expect(file.history?.status).toEqual([
      { value: 'review', at: AT, source: 'schema' },
      { value: 'approved', at: AT, by: 'lolive' },
    ])
  })

  it('W15 — écritures concurrentes sur la même exigence : aucune entrée perdue', async () => {
    const req = await newReq()
    await Promise.all([
      requirements.update(dir, req.id, { fields: { priority: 'high' } } as never),
      requirements.transition(dir, req.id, { toStatus: 'review' } as never),
    ])
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.priority).toHaveLength(1)
    expect(file.history?.status.map(e => e.value)).toEqual(['draft', 'review'])
  })

  it('W9 — levée de needsRevalidation : aucune entrée', async () => {
    const req = await newReq()
    await git.writeYaml(dir, `requirements/${req.id}.yaml`, { ...(await onDisk<object>(`requirements/${req.id}.yaml`)), needsRevalidation: true })
    reqIndex.invalidate(dir)
    await reqIndex.findAll(dir, {})
    const result = await revalidation.clear(dir, [req.id])
    expect(result.cleared).toEqual([req.id])
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.needsRevalidation).toBeUndefined()
    expect(file.history?.status).toHaveLength(1)
  })
})

describe('tests', () => {
  it('W4 — création, changement de statut direct, openDraft', async () => {
    const tc = await newTest()
    await tests.update(dir, tc.id, { status: 'approved' } as never)
    await tests.openDraft(dir, tc.id, 'draft')
    const file = await onDisk<TestCase>(`tests/${tc.id}.yaml`)
    expect(file.history?.status.map(e => e.value)).toEqual(['draft', 'approved', 'draft'])
  })
})

describe('campagnes', () => {
  const newCampaign = async (testCaseIds: string[] = []) =>
    campaigns.create(dir, { title: 'C', objectTypeRef: 'root::campagne', fields: { lot: 'L1' }, testCaseIds } as never)

  it('W5 — création : planned (+ champ suivi)', async () => {
    const c = await newCampaign()
    const file = await onDisk<TestCampaign>(`campaigns/${c.id}.yaml`)
    expect(file.history).toEqual({
      status: [{ value: 'planned', at: AT, by: 'lolive' }],
      lot: [{ value: 'L1', at: AT, by: 'lolive' }],
    })
  })

  it('W6/W7 — premier résultat → in_progress (une seule fois), clôture → completed', async () => {
    const tc = await newTest()
    const c = await newCampaign([tc.id])
    const entryId = c.runs[0].entryId
    await campaigns.updateRun(dir, c.id, entryId, 'PASS')
    await campaigns.updateRun(dir, c.id, entryId, 'FAIL')
    await campaigns.close(dir, c.id, 'completed')
    const file = await onDisk<TestCampaign>(`campaigns/${c.id}.yaml`)
    expect(file.history?.status.map(e => e.value)).toEqual(['planned', 'in_progress', 'completed'])
  })

  it('W8 — update d\'un champ personnalisé suivi', async () => {
    const c = await newCampaign()
    const updated = await campaigns.update(dir, c.id, { fields: { lot: 'L2' } } as never)
    expect(updated.history?.lot.map(e => e.value)).toEqual(['L1', 'L2'])
  })

  it('W13 — la copie testSnapshot ne porte jamais history', async () => {
    const tc = await newTest()
    const c = await newCampaign([tc.id])
    await campaigns.addTests(dir, c.id, [tc.id])
    const file = await onDisk<TestCampaign>(`campaigns/${c.id}.yaml`)
    expect(file.runs.length).toBeGreaterThan(0)
    for (const run of file.runs) expect(run.testSnapshot && 'history' in run.testSnapshot).toBe(false)
  })
})

describe('lecture effective', () => {
  it('L1 — YAML modifié à la main : entrée implicite en dernier, rien d\'écrit', async () => {
    const req = await newReq()
    const raw = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    await git.writeYaml(dir, `requirements/${req.id}.yaml`, { ...raw, status: 'approved' })
    reqIndex.invalidate(dir)
    const h = await readEffectiveHistory({ history, requirements, tests, campaigns }, dir, 'requirement', req.id)
    expect(h.status.at(-1)).toMatchObject({ value: 'approved', implicit: true })
    expect((await onDisk<Requirement>(`requirements/${req.id}.yaml`)).history?.status).toHaveLength(1)
  })

  it('L2 — campagne sans écart : pas de lecture git', async () => {
    const c = await newCampaign()
    let calls = 0
    const original = git.fileHistory.bind(git)
    git.fileHistory = async (...args) => { calls++; return original(...args) }
    const h = await readEffectiveHistory({ history, requirements, tests, campaigns }, dir, 'campaign', c.id)
    expect(h.status).toHaveLength(1)
    expect(calls).toBe(0)
  })

  async function newCampaign() {
    return campaigns.create(dir, { title: 'C', objectTypeRef: 'root::campagne', fields: {}, testCaseIds: [] } as never)
  }
})

describe('serveur MCP', () => {
  it('W11 — création via le conteneur MCP : by = --user, source mcp', async () => {
    const mcp = createMcpContainer(dir, undefined, 'alice')
    const req = await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R' } as never)
    const file = await onDisk<Requirement>(`requirements/${req.id}.yaml`)
    expect(file.history?.status).toEqual([expect.objectContaining({ value: 'draft', by: 'alice', source: 'mcp' })])
  })

  it('W11 — sans --user : by = local', async () => {
    const mcp = createMcpContainer(dir)
    const tc = await mcp.tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [] } as never)
    const file = await onDisk<TestCase>(`tests/${tc.id}.yaml`)
    expect(file.history?.status[0]).toMatchObject({ by: 'local', source: 'mcp' })
  })
})
