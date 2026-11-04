import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, ProductVersion } from '@polenta/types'
import { validationTypeError } from '@polenta/types'
import { GitService } from './git.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import type { AuthService } from './auth.service'
import type { TraceabilityService } from './traceability.service'
import type { HistoryService } from './history.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import { ValidationsService } from './validations.service'
import { signatureProblems } from './validation-rows.util'
import { FieldRenameService } from './field-rename.service'
import { TypeRenameService } from './type-rename.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH204 sprint 1 — validation d'une version (specs/GH204-tests.md, U3 à U11, U14, U15).

const STATUSES = [
  { name: 'draft', label: 'Brouillon' },
  { name: 'approved', label: 'Approuvé', isApproval: true },
  { name: 'obsolete', label: 'Obsolète', isTerminal: true },
]
const VERSION_STATUSES = [
  { name: 'en_cours', label: 'En cours' },
  { name: 'released', label: 'Released', isApproval: true },
  { name: 'abandonnee', label: 'Abandonnée', isTerminal: true },
]
const VALIDATION_TYPE: ObjectTypeDefinition = {
  name: 'validation', label: 'Validation', prefix: 'VAL', category: 'validation', fields: [],
  statuses: [
    { name: 'en_cours', label: 'En cours' },
    { name: 'signee', label: 'Signée', isApproval: true },
    { name: 'annulee', label: 'Annulée', isTerminal: true },
  ],
  decisions: [
    { name: 'en_attente', isPending: true }, { name: 'conforme' }, { name: 'non_conforme', proposesIssue: true }, { name: 'hors_scope' },
  ],
  entryFields: [{ name: 'motif', label: 'Motif', type: 'text', requiredWhen: { decision: ['non_conforme'] } }],
} as unknown as ObjectTypeDefinition
const SCHEMA = {
  version: 1, linkTypes: [],
  nodes: [{
    name: 'root', label: 'Produit',
    objectTypes: [
      { name: 'exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: STATUSES },
      { name: 'version', prefix: 'VER', category: 'version', fields: [], statuses: VERSION_STATUSES },
      VALIDATION_TYPE,
    ],
  }],
} as unknown as ProjectSchema

const auth = { getAuthor: async () => ({ name: 'Alice', email: 'a@x' }), getHttpsCredentials: async () => null } as unknown as AuthService

let dir: string
let gitSvc: GitService
let versions: VersionsService
let validations: ValidationsService
let coverage: Record<string, string>
let readonly: boolean
let analysis: ProductVersion['analysis'] | null
let tick = 0

async function commitAll(message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: Date.UTC(2026, 9, 1) / 1000 + ++tick, timezoneOffset: 0 } })
}
const writeReq = (id: string, extra: Record<string, unknown> = {}) => gitSvc.writeYaml(dir, `requirements/${id}.yaml`, {
  id, projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: `Titre ${id}`, status: 'draft', version: 1, fields: {}, ...extra,
})
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])

/** Version released incluant les exigences demandées (toutes par défaut). */
async function release(title: string, opts: { include?: string[]; basedOn?: string | null } = {}) {
  const v = await versions.create(dir, { title, ...(opts.basedOn !== undefined && { basedOn: opts.basedOn }) })
  const ids = opts.include ?? (await versions.backlog(dir)).map(i => i.id)
  if (ids.length > 0) await versions.include(dir, v.id, ids)
  await commitAll(`avant ${title}`)
  return versions.release(dir, v.id, `v-${title}`)
}
const rowsOf = async (id: string) => (await validations.page(dir, id)).rows
const rowOf = async (id: string, req: string) => (await rowsOf(id)).find(r => r.requirementId === req)

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh204-'))
  gitSvc = new GitService()
  await git.init({ fs, dir, defaultBranch: 'main' })
  await gitSvc.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  coverage = {}
  readonly = false
  analysis = null
  const schemaStub = { get: async () => SCHEMA } as unknown as SchemaService
  const treeStub = { readCache: async () => null } as unknown as WorkspaceTreeService
  const sync = new SyncService(auth)
  versions = new VersionsService(gitSvc, sync, schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
  const versionsFacade = Object.create(versions) as VersionsService
  versionsFacade.isReadonly = async () => readonly
  versionsFacade.analysis = async () => analysis ?? { computedAt: '', frozen: false, roots: [], rows: [] }
  const traceability = {
    getMatrix: async () => ({ requirements: Object.entries(coverage).map(([id, coverageStatus]) => ({ requirement: { id }, coverageStatus, cells: [] })), testCases: [], filters: {}, generatedAt: '' }),
  } as unknown as TraceabilityService
  const history = {
    currentActor: async () => ({ by: 'alice' }),
    stamp: async (_r: string, _t: string, _b: unknown, after: unknown) => after,
  } as unknown as HistoryService
  validations = new ValidationsService(gitSvc, sync, schemaStub, versionsFacade, traceability, history)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('type validation (U1)', () => {
  it('exige une seule décision en attente, un statut signé et un statut annulé', () => {
    expect(validationTypeError(VALIDATION_TYPE)).toBeNull()
    expect(validationTypeError({ ...VALIDATION_TYPE, decisions: [{ name: 'a' }] })).toContain('en attente')
    expect(validationTypeError({ ...VALIDATION_TYPE, decisions: [{ name: 'a', isPending: true }, { name: 'b', isPending: true }] })).toContain('en attente')
    expect(validationTypeError({ ...VALIDATION_TYPE, decisions: [{ name: 'a', isPending: true }, { name: 'a' }] })).toContain('même nom')
    expect(validationTypeError({ ...VALIDATION_TYPE, statuses: [{ name: 'x', label: 'x' }] })).toContain('approbation')
  })
})

describe('schéma (U1, U2)', () => {
  const service = () => new SchemaService(auth, { readCache: async () => null } as unknown as WorkspaceTreeService)
  const clone = (): ProjectSchema => JSON.parse(JSON.stringify(SCHEMA)) as ProjectSchema
  const validationOf = (s: ProjectSchema) => s.nodes[0].objectTypes!.find(t => t.category === 'validation')!

  it('un seul type validation, sur root, avec ses marques', async () => {
    const svc = service()
    await expect(svc.save(dir, clone())).resolves.toBeUndefined()
    const two = clone()
    two.nodes[0].objectTypes!.push({ ...validationOf(two), name: 'autre', prefix: 'AUT' })
    await expect(svc.save(dir, two)).rejects.toMatchObject({ code: 'VALIDATION_TYPE_INVALID' })
    const nested = clone()
    const type = validationOf(nested)
    nested.nodes[0].objectTypes = nested.nodes[0].objectTypes!.filter(t => t !== type)
    nested.nodes[0].children = [{ name: 'local', objectTypes: [type] } as never]
    await expect(svc.save(dir, nested)).rejects.toMatchObject({ code: 'VALIDATION_TYPE_INVALID' })
    const noPending = clone()
    validationOf(noPending).decisions = [{ name: 'conforme' }]
    await expect(svc.save(dir, noPending)).rejects.toMatchObject({ code: 'VALIDATION_TYPE_INVALID' })
  })

  it('avec des validations : nom, préfixe figés, décision utilisée non retirable', async () => {
    const svc = service()
    await svc.save(dir, clone())
    await writeReq('REQ-0001')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    const prefix = clone()
    validationOf(prefix).prefix = 'XX'
    await expect(svc.save(dir, prefix)).rejects.toMatchObject({ code: 'VALIDATION_TYPE_INVALID' })
    const removed = clone()
    removed.nodes[0].objectTypes = removed.nodes[0].objectTypes!.filter(t => t.category !== 'validation')
    await expect(svc.save(dir, removed)).rejects.toMatchObject({ code: 'VALIDATION_TYPE_INVALID' })
    const decision = clone()
    validationOf(decision).decisions = validationOf(decision).decisions!.filter(d => d.name !== 'conforme')
    await expect(svc.save(dir, decision)).rejects.toMatchObject({ code: 'DECISION_IN_USE' })
    const unused = clone()
    validationOf(unused).decisions = validationOf(unused).decisions!.filter(d => d.name !== 'hors_scope')
    await expect(svc.save(dir, unused)).resolves.toBeUndefined()
  })
})

describe('périmètre et lecture (U3, U4)', () => {
  it('exclut les exigences terminales et celles d\'un type non déclaré', async () => {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002', { status: 'obsolete' })
    await writeReq('AUT-0001', { objectTypeRef: 'autre::exigence' })
    await commitAll('exigences')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    expect((await rowsOf(val.id)).map(r => r.requirementId)).toEqual(['REQ-0001'])
  })

  it('lit l\'exigence au gel sur une version released', async () => {
    await writeReq('REQ-0001', { title: 'Avant' })
    await commitAll('exigence')
    const v = await release('1.0')
    await writeReq('REQ-0001', { title: 'Après', status: 'approved' })
    await writeReq('REQ-0002')
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    const rows = await rowsOf(val.id)
    expect(rows.map(r => [r.requirementId, r.title, r.status])).toEqual([['REQ-0001', 'Avant', 'draft']])
  })

  it('lit le disque sur une version en cours', async () => {
    await writeReq('REQ-0001', { title: 'Sur disque' })
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    expect((await rowOf(val.id, 'REQ-0001'))?.title).toBe('Sur disque')
  })
})

describe('statut de design (U5, P1)', () => {
  it('« — » pour une exigence jamais incluse', async () => {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002')
    await commitAll('exigences')
    await release('1.0', { include: ['REQ-0002'] })
    const design = await versions.designVersions(dir)
    expect(design.has('REQ-0001')).toBe(false)
    expect(design.get('REQ-0002')).toBeTruthy()
  })

  it('« — » pour une exigence modifiée depuis son inclusion, même sans changement de numéro', async () => {
    await writeReq('REQ-0001', { title: 'A' })
    await commitAll('exigence')
    await release('1.0')
    await writeReq('REQ-0001', { title: 'B' })
    expect((await versions.designVersions(dir)).has('REQ-0001')).toBe(false)
  })

  it('retient la première version qui l\'inclut à l\'identique', async () => {
    await writeReq('REQ-0001')
    await commitAll('exigence')
    const v1 = await release('1.0')
    const v2 = await versions.create(dir, { title: '2.0' })
    await versions.include(dir, v2.id, ['REQ-0001'])
    await commitAll('v2')
    await versions.release(dir, v2.id, 'v-2.0')
    expect((await versions.designVersions(dir)).get('REQ-0001')).toBe(v1.id)
  })
})

describe('décisions (U6, U8)', () => {
  it('écrit la décision et son empreinte ; la valeur en attente retire l\'entrée', async () => {
    await writeReq('REQ-0001')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    expect((await rowOf(val.id, 'REQ-0001'))?.decision).toBe('en_attente')
    const decided = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme', comment: ' ok ' })
    const entry = decided.entries[0]
    expect(entry).toMatchObject({ requirementId: 'REQ-0001', decision: 'conforme', comment: 'ok', decidedBy: 'alice' })
    expect(entry.contentHash).toHaveLength(16)
    expect(entry.decidedAt).toBeTruthy()
    const back = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'en_attente' })
    expect(back.entries).toEqual([])
  })

  it('refuse une décision inconnue et une exigence hors périmètre', async () => {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002', { status: 'obsolete' })
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    expect(await code(validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'bof' }))).toBe('DECISION_UNKNOWN')
    expect(await code(validations.decide(dir, val.id, { requirementId: 'REQ-0002', decision: 'conforme' }))).toBe('NOT_IN_PERIMETER')
  })

  it('« à revoir » quand le contenu change, pas quand seul le statut change ; confirmer lève le signal', async () => {
    await writeReq('REQ-0001', { title: 'A' })
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    await writeReq('REQ-0001', { title: 'A', status: 'approved', version: 2 })
    expect((await rowOf(val.id, 'REQ-0001'))?.review).toBeNull()
    await writeReq('REQ-0001', { title: 'B' })
    expect((await rowOf(val.id, 'REQ-0001'))?.review).toBe('content')
    await validations.confirm(dir, val.id, 'REQ-0001')
    expect((await rowOf(val.id, 'REQ-0001'))?.review).toBeNull()
  })
})

describe('modification sans nouvelle décision', () => {
  it('commentaire et champs complétés : auteur et empreinte conservés, « à revoir » maintenu', async () => {
    await writeReq('REQ-0001', { title: 'A' })
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    const first = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'non_conforme', comment: 'c1', fields: { motif: 'm' } })
    await writeReq('REQ-0001', { title: 'B' })
    const second = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'non_conforme', comment: 'c2' })
    expect(second.entries[0]).toMatchObject({ comment: 'c2', contentHash: first.entries[0].contentHash, decidedAt: first.entries[0].decidedAt })
    expect(second.entries[0].fields).toBeUndefined()
    expect((await rowOf(val.id, 'REQ-0001'))?.review).toBe('content')
    const changed = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    expect(changed.entries[0].contentHash).not.toBe(first.entries[0].contentHash)
    expect((await rowOf(val.id, 'REQ-0001'))?.review).toBeNull()
  })
})

describe('reprise (U7)', () => {
  async function signedFirst() {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002')
    await writeReq('REQ-0003')
    await writeReq('REQ-0004')
    await commitAll('exigences')
    const v1 = await release('1.0')
    const val = await validations.create(dir, { versionId: v1.id, title: 'V1' })
    for (const id of ['REQ-0001', 'REQ-0002', 'REQ-0003', 'REQ-0004']) {
      await validations.decide(dir, val.id, { requirementId: id, decision: 'conforme', comment: `c ${id}` })
    }
    await validations.sign(dir, val.id)
    return { v1, val }
  }

  it('reprend seulement les exigences ni changées, ni impactées, ni modifiées', async () => {
    const { v1, val } = await signedFirst()
    await writeReq('REQ-0001', { title: 'modifiée et incluse' })
    await writeReq('REQ-0002', { title: 'modifiée hors version' })
    const v2 = await versions.create(dir, { title: '2.0', basedOn: v1.id })
    await versions.include(dir, v2.id, ['REQ-0001'])
    analysis = {
      computedAt: '', frozen: false, roots: [],
      rows: [
        { id: 'REQ-0003', elementType: 'requirement', title: null, status: 'impact_non_verifie', reached: true, sources: [{ rootId: 'REQ-0001', path: [] }] },
        { id: 'REQ-0004', elementType: 'requirement', title: null, status: 'pas_d_impact_reel', reached: true, sources: [{ rootId: 'REQ-0001', path: [] }] },
      ],
    } as unknown as ProductVersion['analysis']
    const next = await validations.create(dir, { versionId: v2.id, title: 'V2' })
    expect(next.entries.map(e => e.requirementId)).toEqual(['REQ-0004'])
    expect(next.entries[0]).toMatchObject({ decision: 'conforme', comment: 'c REQ-0004', carriedFrom: val.id, decidedBy: 'alice' })
    const rows = await rowsOf(next.id)
    expect(rows.find(r => r.requirementId === 'REQ-0001')?.impact?.kind).toBe('changed')
    expect(rows.find(r => r.requirementId === 'REQ-0003')?.impact?.kind).toBe('impacted')
    expect(rows.find(r => r.requirementId === 'REQ-0004')?.impact).toBeNull()
  })

  it('ne reprend rien sans validation signée de basedOn ; ignore une validation annulée', async () => {
    const { v1, val } = await signedFirst()
    await validations.cancel(dir, val.id)
    const v2 = await versions.create(dir, { title: '2.0', basedOn: v1.id })
    expect((await validations.create(dir, { versionId: v2.id, title: 'V2' })).entries).toEqual([])
  })

  it('une décision reprise devient « à revoir » si l\'exigence devient impactée', async () => {
    const { v1 } = await signedFirst()
    const v2 = await versions.create(dir, { title: '2.0', basedOn: v1.id })
    const next = await validations.create(dir, { versionId: v2.id, title: 'V2' })
    expect((await rowOf(next.id, 'REQ-0001'))?.review).toBeNull()
    analysis = {
      computedAt: '', frozen: false, roots: [],
      rows: [{ id: 'REQ-0001', elementType: 'requirement', title: null, status: 'impact_non_verifie', reached: true, sources: [] }],
    } as unknown as ProductVersion['analysis']
    expect((await rowOf(next.id, 'REQ-0001'))?.review).toBe('impact')
    await validations.confirm(dir, next.id, 'REQ-0001')
    expect((await rowOf(next.id, 'REQ-0001'))?.review).toBeNull()
  })
})

describe('signature (U9, U10, U15)', () => {
  it('refuse sur une version en cours, avec tous les motifs', async () => {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0002', decision: 'non_conforme' })
    const { problems } = await validations.page(dir, val.id)
    expect(problems).toEqual([
      { code: 'VERSION_NOT_RELEASED', ids: [] },
      { code: 'DECISION_PENDING', ids: ['REQ-0001'] },
      { code: 'FIELD_MISSING', ids: ['REQ-0002/motif'] },
    ])
    await expect(validations.sign(dir, val.id)).rejects.toThrow(/SIGNATURE_REFUSED.*VERSION_NOT_RELEASED.*DECISION_PENDING REQ-0001.*FIELD_MISSING/)
  })

  it('signe : commit du fichier, sans tag, puis verrouille', async () => {
    await writeReq('REQ-0001')
    await commitAll('exigence')
    const v = await release('1.0')
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    const tagsBefore = await git.listTags({ fs, dir })
    const signed = await validations.sign(dir, val.id)
    expect(signed.status).toBe('signee')
    expect(await git.listTags({ fs, dir })).toEqual(tagsBefore)
    const [last] = await git.log({ fs, dir, depth: 1 })
    expect(last.commit.message).toContain(val.id)
    const committed = await gitSvc.readTextAt(dir, last.oid, `validations/${val.id}.yaml`)
    expect(committed).toContain('status: signee')
    expect(await code(validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'hors_scope' }))).toBe('VALIDATION_LOCKED')
    expect(await code(validations.update(dir, val.id, { title: 'X' }))).toBe('VALIDATION_LOCKED')
    expect(await code(validations.sign(dir, val.id))).toBe('VALIDATION_LOCKED')
    expect(await code(validations.delete(dir, val.id))).toBe('VALIDATION_LOCKED')
  })

  it('retire à la signature les entrées sorties du périmètre (version en cours puis released)', async () => {
    await writeReq('REQ-0001')
    await writeReq('REQ-0002')
    await commitAll('exigences')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0002', decision: 'conforme' })
    await writeReq('REQ-0002', { status: 'obsolete' })
    await versions.include(dir, v.id, ['REQ-0001'])
    await commitAll('avant release')
    await versions.release(dir, v.id, 'v-1.0')
    const signed = await validations.sign(dir, val.id)
    expect(signed.entries.map(e => e.requirementId)).toEqual(['REQ-0001'])
  })

  it('une seule validation non annulée par version ; annuler permet d\'en recréer une', async () => {
    await writeReq('REQ-0001')
    await commitAll('exigence')
    const v = await release('1.0')
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    expect(await code(validations.create(dir, { versionId: v.id, title: 'W' }))).toBe('VALIDATION_EXISTS')
    await validations.sign(dir, val.id)
    expect(await code(validations.create(dir, { versionId: v.id, title: 'W' }))).toBe('VALIDATION_EXISTS')
    expect((await validations.cancel(dir, val.id)).status).toBe('annulee')
    expect(await code(validations.cancel(dir, val.id))).toBe('VALIDATION_LOCKED')
    expect(await code(validations.create(dir, { versionId: v.id, title: 'W' }))).toBe('ok')
  })

  it('version abandonnée : création et décisions refusées ; version référencée non supprimable', async () => {
    await writeReq('REQ-0001')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    expect(await code(versions.delete(dir, v.id))).toBe('VERSION_HAS_VALIDATION')
    await versions.update(dir, v.id, { status: 'abandonnee' })
    expect(await code(validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' }))).toBe('VERSION_ABANDONED')
    const v2 = await versions.create(dir, { title: '2.0' })
    await versions.update(dir, v2.id, { status: 'abandonnee' })
    expect(await code(validations.create(dir, { versionId: v2.id, title: 'W' }))).toBe('VERSION_ABANDONED')
  })

  it('validation en cours supprimable', async () => {
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.delete(dir, val.id)
    expect(await validations.list(dir)).toEqual([])
    const next = await validations.create(dir, { versionId: v.id, title: 'W' })
    expect(next.id).not.toBe(val.id)
  })
})

describe('revue de code', () => {
  it('type : premier statut non marqué, historique du statut obligatoire', () => {
    expect(validationTypeError({ ...VALIDATION_TYPE, statuses: [...VALIDATION_TYPE.statuses!].reverse() })).toContain('premier statut')
    expect(validationTypeError({ ...VALIDATION_TYPE, trackStatusHistory: false })).toContain('historiser')
  })

  it('requiredWhen sur le statut signé : champ manquant à la signature', () => {
    const typeDef = { ...VALIDATION_TYPE, fields: [{ name: 'rapport', label: 'Rapport', type: 'text', requiredWhen: { status: ['signee'] } }] } as ObjectTypeDefinition
    const problems = signatureProblems({ typeDef, validation: { status: 'en_cours', fields: {} }, versionState: 'released', rows: [] })
    expect(problems).toEqual([{ code: 'FIELD_MISSING', ids: ['rapport'] }])
  })

  it('gel illisible : erreur plutôt qu\'un périmètre vide', async () => {
    await writeReq('REQ-0001')
    await commitAll('exigence')
    const v = await release('1.0')
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    const file = path.join(dir, 'versions', `${v.id}.yaml`)
    await fsP.writeFile(file, (await fsP.readFile(file, 'utf8')).replace(/sha: \S+/, `sha: ${'d'.repeat(40)}`))
    await expect(validations.sign(dir, val.id)).rejects.toThrow()
    expect((await validations.get(dir, val.id)).status).toBe('en_cours')
  })

  it('compléter une proposition ne la confirme pas', async () => {
    await writeReq('REQ-0001')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    await validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    const edited = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme', comment: 'précision' })
    expect(edited.entries[0]).toMatchObject({ proposed: true, comment: 'précision' })
    expect(edited.entries[0].decidedBy).toBeUndefined()
    const changed = await validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'hors_scope' })
    expect(changed.entries[0].proposed).toBeUndefined()
    expect(changed.entries[0].decidedBy).toBe('alice')
  })

  it('renommages : champ et valeur migrés, validation signée comprise', async () => {
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V', fields: { jalon: 'DVT' } })
    const reqs = { findAll: async () => [], renameFieldKeys: async () => undefined, rewriteObjects: async () => undefined }
    const service = new FieldRenameService(reqs as never, { ...reqs, rewriteSnapshots: async () => undefined } as never, { ...reqs, list: async () => [], rewriteSnapshots: async () => undefined } as never, undefined, validations)
    const fields = await service.renameFields(dir, 'root::validation', [{ from: 'jalon', to: 'milestone' }])
    expect(fields.migrated).toEqual([val.id])
    expect((await validations.get(dir, val.id)).fields).toEqual({ milestone: 'DVT' })
    const values = await service.renameValues(dir, 'root::validation', [{ from: 'en_cours', to: 'ouverte', target: { kind: 'status' } } as never])
    expect(values.migrated).toEqual([val.id])
    expect((await validations.get(dir, val.id)).status).toBe('ouverte')
  })

  it('préfixe d\'un type d\'exigence figé dès qu\'une validation existe', async () => {
    await writeReq('REQ-0001')
    const reqsStub = { findAll: async () => [{ id: 'REQ-0001' }] }
    const rename = () => new TypeRenameService(
      reqsStub as never, { findAll: async () => [] } as never, { list: async () => [] } as never, {} as never, {} as never, [],
      async () => [dir],
    ).plan(dir, undefined, { nodeName: 'root', category: 'requirement', oldName: 'exigence', newName: 'exigence', oldPrefix: 'REQ', newPrefix: 'NEW' })
    expect((await rename()).errors).toEqual([])
    const v = await versions.create(dir, { title: '1.0' })
    await validations.create(dir, { versionId: v.id, title: 'V' })
    expect((await rename()).errors.map(e => e.code)).toEqual(['HAS_VALIDATIONS'])
  })
})

describe('proposition du MCP (U11)', () => {
  it('propose, bloque la signature, confirme ou rejette ; jamais sur une décision confirmée', async () => {
    await writeReq('REQ-0001')
    await commitAll('exigence')
    const v = await release('1.0')
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    const proposed = await validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme', comment: 'à voir' })
    expect(proposed.entries[0]).toMatchObject({ proposed: true, proposedBy: 'alice', comment: 'à voir' })
    expect(proposed.entries[0].decidedBy).toBeUndefined()
    expect((await validations.page(dir, val.id)).problems.map(p => p.code)).toEqual(['DECISION_PROPOSED'])

    const rejected = await validations.reject(dir, val.id, 'REQ-0001')
    expect(rejected.entries).toEqual([])
    expect(await code(validations.reject(dir, val.id, 'REQ-0001'))).toBe('NOT_PROPOSED')

    await validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' })
    const confirmed = await validations.confirm(dir, val.id, 'REQ-0001')
    expect(confirmed.entries[0].proposed).toBeUndefined()
    expect(confirmed.entries[0].decidedBy).toBe('alice')
    expect(await code(validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'hors_scope' }))).toBe('DECISION_CONFIRMED')
    expect(await code(validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'en_attente' }))).toBe('DECISION_UNKNOWN')
  })
})

describe('lecture seule (U14)', () => {
  it('refuse toutes les écritures', async () => {
    await writeReq('REQ-0001')
    const v = await versions.create(dir, { title: '1.0' })
    const val = await validations.create(dir, { versionId: v.id, title: 'V' })
    readonly = true
    expect((await validations.page(dir, val.id)).readonly).toBe(true)
    for (const p of [
      validations.create(dir, { versionId: v.id, title: 'W' }),
      validations.update(dir, val.id, { title: 'X' }),
      validations.decide(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' }),
      validations.confirm(dir, val.id, 'REQ-0001'),
      validations.reject(dir, val.id, 'REQ-0001'),
      validations.propose(dir, val.id, { requirementId: 'REQ-0001', decision: 'conforme' }),
      validations.sign(dir, val.id),
      validations.cancel(dir, val.id),
      validations.delete(dir, val.id),
    ]) expect(await code(p)).toBe('READONLY_REPO')
  })
})
