import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCase } from '@polenta/types'
import { initialStatus, isUnknownStatus } from '@polenta/types'
import { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'
import { validateBulkEntries } from './bulk-import-validation.util'

// GH149 — statut à la création : premier statut du type dans le schéma, pas `draft` en dur.

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [],
        statuses: [{ name: 'brouillon' }, { name: 'a-valider' }, { name: 'valide', isApproval: true }],
      },
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [],
        statuses: [{ name: 'a-ecrire' }, { name: 'pret', isApproval: true }],
      },
      { name: 'sans-statuts', label: 'Sans statuts', prefix: 'NS', category: 'requirement', fields: [] },
    ],
  }],
  linkTypes: [],
}

let dir: string
let git: GitService
let requirements: RequirementsService
let tests: TestsService

const schemaStub = {
  resolveComponentRepoPath: async () => null,
  get: async () => SCHEMA,
} as unknown as SchemaService

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh149-'))
  git = new GitService()
  await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  requirements = new RequirementsService(git, new RequirementsIndexService(git), schemaStub)
  tests = new TestsService(git, new TestsIndexService(git), schemaStub)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('initialStatus / isUnknownStatus', () => {
  it('premier statut du type, repli sur draft', () => {
    expect(initialStatus({ statuses: [{ name: 'brouillon' }, { name: 'valide' }] })).toBe('brouillon')
    expect(initialStatus({ statuses: [] })).toBe('draft')
    expect(initialStatus(null)).toBe('draft')
  })

  it('statut inconnu seulement si le type déclare des statuts', () => {
    expect(isUnknownStatus({ statuses: [{ name: 'brouillon' }] }, 'draft')).toBe(true)
    expect(isUnknownStatus({ statuses: [{ name: 'brouillon' }] }, 'brouillon')).toBe(false)
    expect(isUnknownStatus({}, 'draft')).toBe(false)
    expect(isUnknownStatus(null, 'draft')).toBe(false)
  })
})

describe('création', () => {
  it('exigence : premier statut du type', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: {} })
    expect(r.status).toBe('brouillon')
    expect((await git.readYaml<Requirement>(dir, `requirements/${r.id}.yaml`))?.status).toBe('brouillon')
  })

  it('exigence : statut demandé conservé, statut inconnu refusé', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', status: 'a-valider', fields: {} })
    expect(r.status).toBe('a-valider')
    await expect(requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', status: 'draft', fields: {} }))
      .rejects.toThrow(/Statut inconnu/)
  })

  it('type sans statuts : draft', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::sans-statuts', title: 'R', fields: {} })
    expect(r.status).toBe('draft')
  })

  it('test : premier statut du type', async () => {
    const t = await tests.create(dir, { objectTypeRef: 'root::test', title: 'T', steps: [] })
    expect(t.status).toBe('a-ecrire')
    expect((await git.readYaml<TestCase>(dir, `tests/${t.id}.yaml`))?.status).toBe('a-ecrire')
  })
})

describe('bulk_import : validation du statut', () => {
  const preview = () => 'X'

  it('statut absent ou connu : valide ; inconnu : erreur sur le champ status', () => {
    const { valid, errors } = validateBulkEntries(SCHEMA as never, [
      { objectTypeRef: 'root::exigence', fields: {} },
      { objectTypeRef: 'root::exigence', status: 'valide', fields: {} },
      { objectTypeRef: 'root::exigence', status: 'draft', fields: {} },
    ], preview)
    expect(valid.map(v => v.index)).toEqual([0, 1])
    expect(errors).toEqual([expect.objectContaining({ index: 2, field: 'status' })])
  })
})
