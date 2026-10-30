import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { DEFAULT_CHANGE_STATUSES } from '@polenta/types'
import { ApprovedLockedError } from './approved-lock.util'
import { ChangeTrackingService, trackingOn } from './change-tracking.service'
import { ChangesService } from './changes.service'
import { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH200 sprint 1 — verrou de l'approuvé, assignation à la création / réouverture (specs/GH200-tests.md U1–U12).

const STATUSES = [
  { name: 'draft', label: 'Brouillon' },
  { name: 'approved', label: 'Approuvé', isApproval: true },
  { name: 'obsolete', label: 'Obsolète', isTerminal: true },
]
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses: category === 'changeset' ? DEFAULT_CHANGE_STATUSES : STATUSES })
const schemaWith = (types: ObjectTypeDefinition[], preferences?: ProjectSchema['preferences']) => ({
  version: 1, linkTypes: [], ...(preferences && { preferences }),
  nodes: [{ name: 'root', label: 'Produit', objectTypes: types }],
} as unknown as ProjectSchema)
const SCHEMA = schemaWith([type('exigence', 'SYS', 'requirement'), type('test', 'TEST', 'test'), type('nc', 'NC', 'changeset')])

const T0 = Date.UTC(2026, 9, 1) / 1000

let dir: string
let gitSvc: GitService
let schema: ProjectSchema
let changes: ChangesService
let requirements: RequirementsService
let tests: TestsService

async function commitAll(message: string, time: number) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: time, timezoneOffset: 0 } })
}
const head = () => git.resolveRef({ fs, dir, ref: 'HEAD' })
const toModify = async (id: string) => (await changes.get(dir, id)).toModify
const newChange = (title: string) => changes.create(dir, { objectTypeRef: 'root::nc', title, component: 'root' })

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh200-tracking-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  gitSvc = new GitService()
  schema = SCHEMA
  await gitSvc.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma', T0)
  const schemaStub = { get: async () => schema, resolveComponentRepoPath: async () => null } as unknown as SchemaService
  changes = new ChangesService(gitSvc, schemaStub)
  const tracking = new ChangeTrackingService(gitSvc, schemaStub, changes)
  requirements = new RequirementsService(gitSvc, new RequirementsIndexService(gitSvc), schemaStub)
  tests = new TestsService(gitSvc, new TestsIndexService(gitSvc), schemaStub)
  requirements.setModificationTracker(tracking)
  tests.setModificationTracker(tracking)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Exigence approuvée et publiée, version 3 (écrite avant la première lecture de l'index). */
async function approvedRequirement(): Promise<string> {
  await gitSvc.writeYaml(dir, 'requirements/SYS-0001.yaml', {
    id: 'SYS-0001', projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: 'R',
    status: 'approved', version: 3, fields: {}, jiraLinks: [],
  })
  await commitAll('approbation', T0 + 10)
  return 'SYS-0001'
}

describe('U1 — règle active', () => {
  it('type changeset absent → off ; présent → on ; préférence off / on', () => {
    expect(trackingOn(schemaWith([type('exigence', 'SYS', 'requirement')]))).toBe(false)
    expect(trackingOn(SCHEMA)).toBe(true)
    expect(trackingOn(schemaWith([type('nc', 'NC', 'changeset')], { changeTracking: 'off' }))).toBe(false)
    expect(trackingOn(schemaWith([type('nc', 'NC', 'changeset')], { changeTracking: 'on' }))).toBe(true)
    expect(trackingOn(schemaWith([type('exigence', 'SYS', 'requirement')], { changeTracking: 'on' }))).toBe(false)
  })
})

describe('U2–U4 — verrou de l\'approuvé', () => {
  it('titre d\'une exigence approuvée refusé ; brouillon accepté', async () => {
    const id = await approvedRequirement()
    await expect(requirements.update(dir, id, { title: 'X' })).rejects.toBeInstanceOf(ApprovedLockedError)
    expect((await requirements.findOne(dir, id)).title).toBe('R')
    const draft = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'D', fields: {} })
    expect((await requirements.update(dir, draft.id, { title: 'D2' })).title).toBe('D2')
  })

  it('test approuvé : contenu refusé ; statut brouillon + contenu dans la même écriture accepté (réouverture)', async () => {
    const tc = await tests.create(dir, { objectTypeRef: 'root::test', title: 'T', status: 'approved', steps: [] })
    await expect(tests.update(dir, tc.id, { title: 'X' })).rejects.toBeInstanceOf(ApprovedLockedError)
    const reopened = await tests.update(dir, tc.id, { status: 'draft', title: 'X' })
    expect(reopened.title).toBe('X')
    expect(reopened.status).toBe('draft')
  })
})

describe('U5–U6 — création', () => {
  it('un seul changeset ouvert : assignation automatique, sans base', async () => {
    await newChange('A')
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: {} })
    expect(await toModify('NC-0001')).toEqual([{ id: r.id, state: 'planned' }])
  })

  it('deux ouverts sans changesetId : non assigné ; avec : assigné à celui-là ; changeset inconnu refusé avant écriture', async () => {
    await newChange('A')
    await newChange('B')
    const r1 = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R1', fields: {} })
    expect(await toModify('NC-0001')).toEqual([])
    expect(await toModify('NC-0002')).toEqual([])
    const r2 = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R2', fields: {}, changesetId: 'NC-0002' })
    expect((await toModify('NC-0002')).map(t => t.id)).toEqual([r2.id])
    await expect(requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R3', fields: {}, changesetId: 'NC-0099' })).rejects.toThrow(/NC-0099/)
    expect(r1.id).not.toBe(r2.id)
    expect(await gitSvc.fileExists(dir, 'requirements/SYS-0003.yaml')).toBe(false)
  })
})

describe('U7–U10 — réouverture et passage terminal', () => {
  it('U7 : base = dernier commit du fichier, version avant réouverture', async () => {
    const id = await approvedRequirement()
    const sha = await head()
    await newChange('A')
    await requirements.openDraft(dir, id, 'draft')
    expect(await toModify('NC-0001')).toEqual([{ id, state: 'planned', base: { sha, version: 3 } }])
  })

  it('U8 : déjà planifié sans base dans un changeset ouvert : pas de nouvelle assignation, base complétée', async () => {
    const id = await approvedRequirement()
    await changes.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id, state: 'planned' }] })
    await newChange('B')
    await requirements.transition(dir, id, { toStatus: 'draft' })
    expect((await toModify('NC-0001'))[0].base?.version).toBe(3)
    expect(await toModify('NC-0002')).toEqual([])
  })

  it('U9 : son seul changeset est clos → nouvelle assignation', async () => {
    const id = await approvedRequirement()
    await changes.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id, state: 'planned' }] })
    await changes.update(dir, 'NC-0001', { status: 'clos' })
    await newChange('B')
    await requirements.openDraft(dir, id, 'draft')
    expect((await toModify('NC-0002')).map(t => t.id)).toEqual([id])
  })

  it('U10 : approuvé → obsolète assigné ; brouillon → obsolète non', async () => {
    const id = await approvedRequirement()
    await newChange('A')
    await requirements.transition(dir, id, { toStatus: 'obsolete' })
    expect((await toModify('NC-0001')).map(t => t.id)).toEqual([id])
  })

  it('U11 : règle off → aucune assignation, verrou maintenu', async () => {
    const id = await approvedRequirement()
    schema = { ...SCHEMA, preferences: { changeTracking: 'off' } }
    await newChange('A')
    await expect(requirements.update(dir, id, { title: 'X' })).rejects.toBeInstanceOf(ApprovedLockedError)
    await requirements.openDraft(dir, id, 'draft')
    expect(await toModify('NC-0001')).toEqual([])
  })

  it('U12 : test rouvert par changement de statut → base', async () => {
    const tc = await tests.create(dir, { objectTypeRef: 'root::test', title: 'T', status: 'approved', steps: [] })
    await commitAll('test approuvé', T0 + 20)
    const sha = await head()
    await newChange('A')
    await tests.update(dir, tc.id, { status: 'draft' })
    expect(await toModify('NC-0001')).toEqual([{ id: tc.id, state: 'planned', base: { sha, version: 1 } }])
  })
})

describe('ChangesService — trace conservée', () => {
  it('update de toModify sans base : base de la ligne existante gardée', async () => {
    const id = await approvedRequirement()
    await newChange('A')
    await requirements.openDraft(dir, id, 'draft')
    const [line] = await toModify('NC-0001')
    await changes.update(dir, 'NC-0001', { toModify: [{ id, state: 'planned' }] })
    expect((await toModify('NC-0001'))[0].base).toEqual(line.base)
  })
})
