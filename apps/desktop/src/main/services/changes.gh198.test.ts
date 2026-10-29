import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Change, ObjectTypeDefinition, ProjectSchema, Requirement, TestCase } from '@polenta/types'
import { DEFAULT_CHANGE_STATUSES } from '@polenta/types'
import { ChangesService } from './changes.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'

// GH198 — objet change (specs/GH198-tests.md, scénarios 1 à 6).

const NC: ObjectTypeDefinition = {
  name: 'non-conformite', label: 'Non-conformité', prefix: 'NC', category: 'change', fields: [], statuses: DEFAULT_CHANGE_STATUSES,
}
const schemaOf = (nodes: unknown[]) => ({ version: 1, nodes, linkTypes: [] }) as unknown as ProjectSchema
const ONE = schemaOf([{ name: 'root', label: 'Produit', objectTypes: [NC] }])
const TWO = schemaOf([{ name: 'root', label: 'Produit', objectTypes: [NC], children: [{ name: 'bms', label: 'BMS', objectTypes: [] }] }])

const REQ_TYPE = { name: 'exigence', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] }
const reqs = [
  { id: 'SYS-1', title: 'rouverte', objectTypeRef: 'root::exigence', status: 'draft', version: 2 },
  { id: 'SYS-2', title: 'jamais approuvée', objectTypeRef: 'root::exigence', status: 'draft', version: 1 },
  { id: 'SYS-3', title: 'approuvée', objectTypeRef: 'root::exigence', status: 'approved', version: 1 },
  { id: 'SYS-4', title: 'rouverte (historique)', objectTypeRef: 'root::exigence', status: 'draft', version: 1,
    history: { status: [{ value: 'approved', at: '2026-10-01T00:00:00Z', by: 'a' }, { value: 'draft', at: '2026-10-02T00:00:00Z', by: 'a' }] } },
] as unknown as Requirement[]

let dir: string
let git: GitService
const make = (schema: ProjectSchema) => new ChangesService(
  git,
  { get: async () => schema, resolveComponentRepoPath: async () => null } as unknown as SchemaService,
  { findAll: async () => reqs },
  { findAll: async () => [] as TestCase[] },
)

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh198-'))
  git = new GitService()
})
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

describe('ChangesService', () => {
  it('création : ID préfixé, statut initial, composant déduit, fichier changes/', async () => {
    const svc = make(ONE)
    const c = await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'Surcharge', toModify: [{ id: 'SW-1', state: 'planned' }, { id: 'SW-1', state: 'planned' }] })
    expect(c).toMatchObject({ id: 'NC-0001', status: 'ouvert', component: 'root', mode: 'request', toModify: [{ id: 'SW-1', state: 'planned' }] })
    const onDisk = await git.readYaml<Change>(dir, 'changes/NC-0001.yaml')
    expect(onDisk?.title).toBe('Surcharge')
    expect((await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'B' })).id).toBe('NC-0002')
  })

  it('composant : obligatoire si plusieurs composants locaux, inconnu refusé', async () => {
    const svc = make(TWO)
    await expect(svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X' })).rejects.toThrow(/obligatoire/)
    await expect(svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X', component: 'ghost' })).rejects.toThrow(/inconnu/)
    expect((await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X', component: 'bms' })).component).toBe('bms')
  })

  it('titre vide refusé sans consommer d\'ID', async () => {
    const svc = make(ONE)
    await expect(svc.create(dir, { objectTypeRef: 'root::non-conformite', title: '   ' })).rejects.toThrow(/Titre obligatoire/)
    expect((await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'A' })).id).toBe('NC-0001')
  })

  it('composant externe (nœud sans types) refusé : L7', async () => {
    const svc = make(schemaOf([{ name: 'root', label: 'Produit', objectTypes: [NC] }, { name: 'motor', label: 'Moteur', url: 'git@x:motor.git' }]))
    await expect(svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X', component: 'motor' })).rejects.toThrow(/inconnu/)
    expect((await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X' })).component).toBe('root')
  })

  it('type hors catégorie change refusé', async () => {
    await expect(make(ONE).create(dir, { objectTypeRef: 'root::exigence', title: 'X' })).rejects.toThrow(/Type de change/)
  })

  it('mise à jour : statut, listes nettoyées ; composant figé après le statut initial', async () => {
    const svc = make(TWO)
    await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'X', component: 'root' })
    const u = await svc.update(dir, 'NC-0001', {
      impacted: [{ id: 'SYS-1', status: 'impact_a_tester', comment: 'à rejouer', source: 'declared' }, { id: 'SYS-2', status: 'bogus' as never, source: 'declared' }],
      component: 'bms',
    })
    expect(u.component).toBe('bms')
    expect(u.impacted).toEqual([
      { id: 'SYS-1', status: 'impact_a_tester', comment: 'à rejouer', source: 'declared' },
      { id: 'SYS-2', status: 'impact_non_verifie', source: 'declared' },
    ])
    await svc.update(dir, 'NC-0001', { status: 'analyse' })
    await expect(svc.update(dir, 'NC-0001', { component: 'root' })).rejects.toThrow(/statut initial/)
    await expect(svc.update(dir, 'NC-0001', { status: 'inconnu' })).rejects.toThrow(/Statut inconnu/)
  })

  it('suppression : jamais commité → supprimé + pierre tombale ; commité → refus', async () => {
    const svc = make(ONE)
    await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'A' })
    await svc.delete(dir, 'NC-0001')
    expect(await git.fileExists(dir, 'changes/NC-0001.yaml')).toBe(false)
    expect(await git.fileExists(dir, '.polenta/tombstones/NC-0001')).toBe(true)

    await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'B' })
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args])
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'init')
    await expect(svc.delete(dir, 'NC-0002')).rejects.toThrow(/déjà été commité/)
  })

  it('candidats « repassés en brouillon » : déjà approuvés puis rouverts, hors liste', async () => {
    const schema = schemaOf([{ name: 'root', label: 'Produit', objectTypes: [NC, REQ_TYPE] }])
    const svc = make(schema)
    await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'A', toModify: [{ id: 'SYS-4', state: 'planned' }] })
    const candidates = await svc.reopenedCandidates(dir, 'NC-0001')
    expect(candidates.map(c => c.id)).toEqual(['SYS-1'])            // SYS-4 déjà listé, SYS-2 jamais approuvée, SYS-3 approuvée
  })

  it('liste : résumé avec repo de stockage', async () => {
    const svc = make(ONE)
    await svc.create(dir, { objectTypeRef: 'root::non-conformite', title: 'A', impacted: [{ id: 'SYS-1', status: 'impact_a_tester', source: 'declared' }] })
    const list = await svc.list(dir)
    expect(list).toEqual([expect.objectContaining({ id: 'NC-0001', repoPath: dir, impactedCount: 1, toModifyCount: 0 })])
  })
})
