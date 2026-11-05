import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import type { TestsService } from './tests.service'

// GH255 — une campagne ne contient que les tests de son repo.

let dir: string
let service: CampaignsService
const tests = new Map<string, TestCase>()
const testCase = (id: string, objectTypeRef: string) => ({
  id, title: id, projectId: '', branchId: '', objectTypeRef, status: 'approved', version: 1,
  preconditions: '', postconditions: '', equipment: [], fields: {}, steps: [],
}) as unknown as TestCase

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh255-'))
  tests.clear()
  tests.set('PT-0001', testCase('PT-0001', 'root::test'))
  tests.set('MT-0001', testCase('MT-0001', 'moteur::test'))
  const testsService = { findOne: async (_r: string, id: string) => structuredClone(tests.get(id)!) } as unknown as TestsService
  const schema = {
    resolveComponentRepoPath: async (_r: string, ref: string) => ref.startsWith('moteur::') ? path.join(dir, '..', 'moteur') : null,
    get: async () => ({ version: 1, nodes: [], linkTypes: [] }),
  } as unknown as SchemaService
  service = new CampaignsService(new GitService(), testsService, undefined, schema)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('GH255 — tests d\'un autre repo', () => {
  it('refusés à la création comme à l\'ajout, avec leur ID ; les tests du repo passent', async () => {
    await expect(service.create(dir, { title: 'C', testCaseIds: ['PT-0001', 'MT-0001'] })).rejects.toThrow(/TEST_OTHER_REPO: MT-0001/)
    const c = await service.create(dir, { title: 'C', testCaseIds: ['PT-0001'] })
    await expect(service.addTests(dir, c.id, ['MT-0001'])).rejects.toThrow(/TEST_OTHER_REPO/)
    expect((await service.get(dir, c.id)).testCaseIds).toEqual(['PT-0001'])
  })
})
