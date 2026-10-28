import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH164 — un test qui quitte son statut d'approbation par `update({ status })` (colonne Statut,
// `update_tests` MCP) voit sa version incrémentée, comme une exigence (T150).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [{
      name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
      statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
    }],
  }],
  linkTypes: [],
}

let dir: string
let tests: TestsService

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh164-'))
  const git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService
  tests = new TestsService(git, new TestsIndexService(git), schemaStub)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

it('approved → draft : version +1 ; autres changements de statut : inchangée', async () => {
  const tc = await tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [] } as never)
  const v0 = tc.version ?? 0
  expect((await tests.update(dir, tc.id, { status: 'review' })).version ?? 0).toBe(v0)
  expect((await tests.update(dir, tc.id, { status: 'approved' })).version ?? 0).toBe(v0)
  expect((await tests.update(dir, tc.id, { status: 'approved' })).version ?? 0).toBe(v0)
  expect((await tests.update(dir, tc.id, { status: 'draft' })).version).toBe(v0 + 1)
})
