import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { versionBump } from './approved-lock.util'
import { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH243 §1 — règle de version unique : `version + 1` quand le statut quitte un statut `isApproval`,
// quel que soit le chemin (`openDraft`, `transition`, `update({ status })`) ; inchangée sinon.

const STATUSES = [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }, { name: 'obsolete', isTerminal: true }]
const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'sys', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [], statuses: STATUSES },
      { name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [], statuses: STATUSES },
    ],
  }],
  linkTypes: [],
}
const TYPE = SCHEMA.nodes[0].objectTypes[0] as unknown as ObjectTypeDefinition

let dir: string
let requirements: RequirementsService
let tests: TestsService

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh243-'))
  const git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => SCHEMA } as unknown as SchemaService
  requirements = new RequirementsService(git, new RequirementsIndexService(git), schemaStub)
  tests = new TestsService(git, new TestsIndexService(git), schemaStub)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('versionBump', () => {
  it('U1 — approuvé → brouillon / review / obsolète : version + 1', () => {
    for (const to of ['draft', 'review', 'obsolete']) {
      expect(versionBump(TYPE, { status: 'approved', version: 3 }, to)).toEqual({ version: 4 })
    }
  })
  it('U2 — brouillon → review, review → approuvé, même statut : inchangée', () => {
    expect(versionBump(TYPE, { status: 'draft', version: 3 }, 'review')).toEqual({})
    expect(versionBump(TYPE, { status: 'review', version: 3 }, 'approved')).toEqual({})
    expect(versionBump(TYPE, { status: 'approved', version: 3 }, 'approved')).toEqual({})
  })
  it('U2bis — entre deux statuts isApproval : inchangée', () => {
    const twoApprovals = { ...TYPE, statuses: [...STATUSES, { name: 'released', isApproval: true }] } as unknown as ObjectTypeDefinition
    expect(versionBump(twoApprovals, { status: 'approved', version: 3 }, 'released')).toEqual({})
  })
})

describe('identifiants', () => {
  it('U13 — un ancien fichier changesets/ garde son ID si un nouveau type reprend son préfixe', async () => {
    const git = new GitService()
    await git.writeYaml(dir, 'changesets/SYS-0007.yaml', { id: 'SYS-0007' })
    const req = await requirements.create(dir, { objectTypeRef: 'root::sys', title: 'R', fields: {} })
    expect(req.id).toBe('SYS-0008')
  })
})

describe('exigences', () => {
  it('U3 / U4 — openDraft : + 1 depuis l’approuvé, plus d’incrément depuis un brouillon', async () => {
    const req = await requirements.create(dir, { objectTypeRef: 'root::sys', title: 'R', fields: {} })
    await requirements.transition(dir, req.id, { toStatus: 'approved' })
    expect((await requirements.openDraft(dir, req.id, 'draft')).version).toBe(2)
    expect((await requirements.openDraft(dir, req.id, 'draft')).version).toBe(2)
  })
  it('U5 — transition approuvé → obsolète : + 1', async () => {
    const req = await requirements.create(dir, { objectTypeRef: 'root::sys', title: 'R', fields: {} })
    await requirements.transition(dir, req.id, { toStatus: 'approved' })
    expect((await requirements.transition(dir, req.id, { toStatus: 'obsolete' })).version).toBe(2)
  })
})

describe('tests', () => {
  it('U6 — update({ status }) approuvé → brouillon : + 1 ; openDraft sur un brouillon : inchangée', async () => {
    const tc = await tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [] } as never)
    const v0 = tc.version ?? 0
    await tests.update(dir, tc.id, { status: 'approved' })
    expect((await tests.update(dir, tc.id, { status: 'draft' })).version).toBe(v0 + 1)
    expect((await tests.openDraft(dir, tc.id, 'draft')).version).toBe(v0 + 1)
  })
})

describe('schéma', () => {
  it('U11 — type de l’ancienne catégorie changeset et préférence changeTracking ignorés à la lecture', async () => {
    const git = new GitService()
    await git.writeYaml(dir, '.polenta/schema.yaml', {
      ...SCHEMA,
      preferences: { autoPropagatePin: false, changeTracking: 'off' },
      nodes: [{ ...SCHEMA.nodes[0], objectTypes: [...SCHEMA.nodes[0].objectTypes, { name: 'nc', label: 'NC', prefix: 'NC', category: 'changeset', fields: [] }] }],
    })
    const schema = await new SchemaService({} as never).get(dir)
    expect(schema.nodes[0].objectTypes?.map(t => t.name)).toEqual(['sys', 'test'])
    expect(schema.preferences).toEqual({ autoPropagatePin: false })
  })
})
