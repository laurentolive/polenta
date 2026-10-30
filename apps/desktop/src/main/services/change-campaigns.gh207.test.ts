import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Change, ChangeImpactRow, ObjectLink, TestCampaign } from '@polenta/types'
import { DEFAULT_CHANGE_STATUSES } from '@polenta/types'
import { computeTestsToRun, linkedCampaigns } from './change-tests.util'
import type { ImpactSnapshot } from './traceability.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { GitService } from './git.service'

// GH207 — tests à exécuter d'un changeset et lien campagne ↔ changeset (specs/GH207-tests.md T1–T6).

const change = (toModify: string[], campaigns: string[] = []): Change => ({
  id: 'NC-0004', projectId: '', branchId: '', objectTypeRef: 'root::nc', title: 'NC', status: 'ouvert', version: 1, fields: {},
  component: 'root', mode: 'request', toModify: toModify.map(id => ({ id, state: 'planned' })), impacted: [],
  origin: { runs: [], decisions: [] }, integratedIn: null, campaigns,
})
const row = (id: string, status: ChangeImpactRow['status']): ChangeImpactRow =>
  ({ id, elementType: null, title: null, status, source: 'computed', reached: true })
const link = (sourceId: string, targetId: string): ObjectLink => ({ id: `${sourceId}-${targetId}`, type: 'verification', sourceId, targetId } as ObjectLink)
const snapshot = (reqs: string[], tests: string[], links: ObjectLink[]): ImpactSnapshot => ({
  rootRepoPath: '/r',
  requirements: new Map(reqs.map(id => [id, { title: id, repoPath: '/r' }])),
  tests: new Map(tests.map(id => [id, { title: id, repoPath: '/r' }])),
  links, repoNames: new Map(),
})

describe('computeTestsToRun', () => {
  const snap = snapshot(['SW-0042', 'SYS-0012', 'SW-0050'], ['TEST-0007', 'TEST-0009'], [link('TEST-0007', 'SW-0042'), link('SW-0050', 'TEST-0007')])

  it('T1 : à modifier couvert + test impacté « à tester »', () => {
    const r = computeTestsToRun(change(['SW-0042']), [row('TEST-0009', 'impact_a_tester')], snap)
    expect(r.tests).toEqual([
      { testId: 'TEST-0007', requirementIds: ['SW-0042'], sources: ['SW-0042'] },
      { testId: 'TEST-0009', requirementIds: [], sources: ['TEST-0009'] },
    ])
    expect(r.uncovered).toEqual([])
  })

  it('T2 : tous les identifiés proposés, sauf « pas d\'impact réel » — même amené par un élément à modifier', () => {
    expect(computeTestsToRun(change([]), [row('TEST-0009', 'impact_non_verifie')], snap).tests.map(x => x.testId)).toEqual(['TEST-0009'])
    expect(computeTestsToRun(change(['SW-0042']), [row('TEST-0007', 'pas_d_impact_reel'), row('TEST-0009', 'pas_d_impact_reel')], snap).tests).toEqual([])
  })

  it('T3 / T4 : exigence sans test → non couverte ; lien dans l\'autre sens compté', () => {
    const r = computeTestsToRun(change([]), [row('SYS-0012', 'modification_a_tester'), row('SW-0050', 'impact_a_tester')], snap)
    expect(r.uncovered).toEqual(['SYS-0012'])
    expect(r.tests).toEqual([{ testId: 'TEST-0007', requirementIds: ['SW-0050'], sources: ['SW-0050'] }])
  })

  it('T6 : à ajouter = absents des campagnes liées ouvertes', () => {
    const tests = computeTestsToRun(change(['SW-0042']), [row('TEST-0009', 'impact_a_tester')], snap).tests
    const camp = (id: string, status: TestCampaign['status'], testIds: string[]) =>
      ({ id, title: id, status, runs: testIds.map(t => ({ entryId: t, testCaseId: t, status: 'PASS' })) } as unknown as TestCampaign)
    const open = linkedCampaigns(change([], ['CAMP-1']), tests, [camp('CAMP-1', 'in_progress', ['TEST-0007'])])
    expect(open.toAdd).toEqual(['TEST-0009'])
    expect(open.linked[0]).toMatchObject({ passed: 1, total: 1, changesetTests: 1, missing: false })
    expect(linkedCampaigns(change([], ['CAMP-1']), tests, [camp('CAMP-1', 'completed', ['TEST-0007'])]).toAdd).toEqual(['TEST-0007', 'TEST-0009'])
    expect(linkedCampaigns(change([], ['CAMP-9']), tests, []).linked[0].missing).toBe(true)
  })
})

describe('T5 — campagne créée depuis un changeset', () => {
  let dir: string
  let mcp: McpContainer
  beforeEach(async () => {
    dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh207-'))
    await new GitService().writeYaml(dir, '.polenta/schema.yaml', {
      version: 1, linkTypes: [],
      nodes: [{ name: 'root', label: 'Produit', objectTypes: [
        { name: 'nc', label: 'NC', prefix: 'NC', category: 'changeset', fields: [], statuses: DEFAULT_CHANGE_STATUSES },
      ] }],
    })
    mcp = createMcpContainer(dir, undefined, 'alice')
  })
  afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

  it('lien écrit des deux côtés ; changeset clos ou inconnu refusé avant l\'ID', async () => {
    await mcp.changes.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root' })
    const c = await mcp.campaigns.create(dir, { title: 'Non-régression', testCaseIds: [], changeset: 'NC-0001' })
    expect(c.changeset).toBe('NC-0001')
    expect((await mcp.changes.get(dir, 'NC-0001')).campaigns).toEqual([c.id])
    await expect(mcp.campaigns.create(dir, { title: 'X', testCaseIds: [], changeset: 'NC-0099' })).rejects.toThrow(/NC-0099/)
    await mcp.changes.update(dir, 'NC-0001', { status: 'clos' })
    await expect(mcp.campaigns.create(dir, { title: 'Y', testCaseIds: [], changeset: 'NC-0001' })).rejects.toThrow(/clos/)
    expect((await mcp.campaigns.list(dir)).map(x => x.id)).toEqual([c.id])
  })
})
