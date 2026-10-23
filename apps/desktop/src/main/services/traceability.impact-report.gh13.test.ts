import { describe, expect, it } from 'vitest'
import type { ObjectLink, Requirement, TestCase } from '@polenta/types'
import { TraceabilityService } from './traceability.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { GitService } from './git.service'
import type { SyncService } from './sync.service'

// GH13 — rapport d'impact d'une exigence : un test lié apparaît quel que soit le sens du lien.

const ROOT = '/ws/produit'

const req = (id: string): Requirement => ({ id, title: `Titre ${id}` }) as unknown as Requirement
const tc = (id: string): TestCase => ({ id, title: `Titre ${id}` }) as unknown as TestCase
const link = (sourceId: string, targetId: string, type = 'verification'): ObjectLink =>
  ({ id: `${sourceId}-${targetId}`, sourceId, targetId, type }) as unknown as ObjectLink

function makeService(links: ObjectLink[]) {
  const reqs = new Map(['SYS-0001', 'SYS-0002'].map((id) => [id, req(id)]))
  const tests = [tc('TEST-0001')]
  const reqIndex = {
    findById: async (_rp: string, id: string) => reqs.get(id) ?? null,
    findLinks: async (_rp: string, id: string) => links.filter((l) => l.sourceId === id || l.targetId === id),
    findAllLinks: async () => links,
  } as unknown as RequirementsIndexService
  const testsIndex = {
    findAll: async () => tests,
    findById: async (_rp: string, id: string) => tests.find((t) => t.id === id) ?? null,
    getRunsMap: async () => new Map(),
  } as unknown as TestsIndexService
  const git = { listFiles: async () => [] } as unknown as GitService
  return new TraceabilityService(reqIndex, testsIndex, git, {} as SyncService)
}

const itemIds = (items: Array<{ elementId: string; elementType: string }>) =>
  items.map((i) => `${i.elementType}:${i.elementId}`).sort()

describe('GH13 — getImpactReport', () => {
  it('liste le test lié par un lien test → exigence', async () => {
    const report = await makeService([link('TEST-0001', 'SYS-0001')]).getImpactReport(ROOT, 'SYS-0001')
    expect(itemIds(report.items)).toEqual(['test_case:TEST-0001'])
  })

  it('liste le test lié par un lien exigence → test', async () => {
    const report = await makeService([link('SYS-0001', 'TEST-0001')]).getImpactReport(ROOT, 'SYS-0001')
    expect(itemIds(report.items)).toEqual(['test_case:TEST-0001'])
  })

  it('conserve les exigences dépendantes à côté du test', async () => {
    const report = await makeService([
      link('TEST-0001', 'SYS-0001'),
      link('SYS-0002', 'SYS-0001', 'implementation'),
    ]).getImpactReport(ROOT, 'SYS-0001')
    expect(itemIds(report.items)).toEqual(['requirement:SYS-0002', 'test_case:TEST-0001'])
  })
})
