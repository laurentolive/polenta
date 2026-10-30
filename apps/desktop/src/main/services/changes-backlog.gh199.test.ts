import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { DEFAULT_CHANGE_STATUSES } from '@polenta/types'
import { ChangesService } from './changes.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'

// GH199 §8bis — backlog, assignation, déplacement, contrôle d'approbation (specs/GH199-tests.md, 14 à 16).

const STATUSES = [
  { name: 'draft', label: 'Brouillon' },
  { name: 'approved', label: 'Approuvé', isApproval: true },
  { name: 'obsolete', label: 'Obsolète', isTerminal: true },
]
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses: category === 'change' ? DEFAULT_CHANGE_STATUSES : STATUSES })
const NC = type('nc', 'NC', 'change')
const SCHEMA = {
  version: 1, linkTypes: [],
  nodes: [{ name: 'root', label: 'Produit', objectTypes: [type('exigence', 'SYS', 'requirement'), type('test', 'TEST', 'test'), NC],
    children: [{ name: 'bms', label: 'BMS', objectTypes: [type('exigence-bms', 'BMS', 'requirement')] }] }],
} as unknown as ProjectSchema

let dir: string
let git: GitService
let svc: ChangesService

const req = (id: string, status: string, node = 'root', t = 'exigence') =>
  git.writeYaml(dir, `requirements/${id}.yaml`, { id, title: `Titre ${id}`, status, objectTypeRef: `${node}::${t}`, fields: {} })
const ids = async () => Object.fromEntries((await svc.backlog(dir)).map(b => [b.component, b.items.map(i => i.id)]))

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh199-backlog-'))
  git = new GitService()
  svc = new ChangesService(git, { get: async () => SCHEMA } as unknown as SchemaService)
  await req('SYS-1', 'draft')
  await req('SYS-2', 'approved')
  await req('SYS-3', 'obsolete')
  await req('SYS-4', 'draft')
  await req('BMS-1', 'draft', 'bms', 'exigence-bms')
  await git.writeYaml(dir, 'tests/TEST-1.yaml', { id: 'TEST-1', title: 'T', status: 'draft', objectTypeRef: 'root::test', steps: [] })
})
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

describe('backlog', () => {
  it('à traiter non assignés, par composant ; approuvés et terminaux absents', async () => {
    expect(await ids()).toEqual({ root: ['SYS-1', 'SYS-4', 'TEST-1'], bms: ['BMS-1'] })
  })

  it('assigné à un change ouvert : absent ; change clos : de retour', async () => {
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id: 'SYS-1', state: 'planned' }] })
    expect((await ids()).root).toEqual(['SYS-4', 'TEST-1'])
    await svc.update(dir, 'NC-0001', { status: 'clos' })
    expect((await ids()).root).toEqual(['SYS-1', 'SYS-4', 'TEST-1'])
  })
})

describe('assign / move', () => {
  it('assign : ajout planned sans doublon ; change clos refusé', async () => {
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id: 'SYS-1', state: 'modified' }] })
    const c = await svc.assign(dir, 'NC-0001', ['SYS-1', 'SYS-4'])
    expect(c.toModify).toEqual([{ id: 'SYS-1', state: 'modified' }, { id: 'SYS-4', state: 'planned' }])
    await svc.update(dir, 'NC-0001', { status: 'clos' })
    await expect(svc.assign(dir, 'NC-0001', ['TEST-1'])).rejects.toThrow(/clos/)
  })

  it('move : retiré de la source, ajouté à la cible avec son état', async () => {
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id: 'SYS-1', state: 'modified' }, { id: 'SYS-4', state: 'planned' }] })
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'B', component: 'root' })
    await svc.move(dir, 'NC-0001', 'NC-0002', ['SYS-1'])
    expect((await svc.get(dir, 'NC-0001')).toModify).toEqual([{ id: 'SYS-4', state: 'planned' }])
    expect((await svc.get(dir, 'NC-0002')).toModify).toEqual([{ id: 'SYS-1', state: 'modified' }])
  })

  it('move : déjà dans la cible, « modifié » l\'emporte ; absent de la source, cible intacte ; source close refusée', async () => {
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id: 'SYS-1', state: 'planned' }] })
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'B', component: 'root', toModify: [{ id: 'SYS-1', state: 'modified' }, { id: 'SYS-4', state: 'planned' }] })
    await svc.move(dir, 'NC-0001', 'NC-0002', ['SYS-1', 'SYS-4'])
    expect((await svc.get(dir, 'NC-0001')).toModify).toEqual([])
    expect((await svc.get(dir, 'NC-0002')).toModify).toEqual([{ id: 'SYS-1', state: 'modified' }, { id: 'SYS-4', state: 'planned' }])
    await svc.update(dir, 'NC-0002', { status: 'clos' })
    await expect(svc.move(dir, 'NC-0002', 'NC-0001', ['SYS-4'])).rejects.toThrow(/clos/)
    expect((await svc.get(dir, 'NC-0001')).toModify).toEqual([])
  })
})

describe('approvalCheck', () => {
  const sys1 = { id: 'SYS-1', objectTypeRef: 'root::exigence', category: 'requirement' as const }

  it('vers isApproval, non assigné : assignation proposée, changes ouverts et composant', async () => {
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root' })
    const check = await svc.approvalCheck(dir, sys1, 'approved')
    expect(check.needsAssignment).toBe(true)
    expect(check.component).toBe('root')
    expect(check.openChanges.map(c => c.id)).toEqual(['NC-0001'])
  })

  it('assigné, déjà approuvé ou statut non approuvé : rien à proposer', async () => {
    expect((await svc.approvalCheck(dir, sys1, 'draft')).needsAssignment).toBe(false)
    expect((await svc.approvalCheck(dir, { ...sys1, id: 'SYS-2' }, 'approved')).needsAssignment).toBe(false)
    await svc.create(dir, { objectTypeRef: 'root::nc', title: 'A', component: 'root', toModify: [{ id: 'SYS-1', state: 'planned' }] })
    expect((await svc.approvalCheck(dir, sys1, 'approved')).needsAssignment).toBe(false)
  })

  it('composant d\'un élément de sous-composant', async () => {
    const check = await svc.approvalCheck(dir, { id: 'BMS-1', objectTypeRef: 'bms::exigence-bms', category: 'requirement' }, 'approved')
    expect(check).toMatchObject({ needsAssignment: true, component: 'bms' })
  })
})
