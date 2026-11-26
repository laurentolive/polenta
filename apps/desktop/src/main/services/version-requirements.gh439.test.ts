import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { TestRepo } from '../git/test-repo.test-util'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { CoverageStatus, ObjectLink, ObjectTypeDefinition, ProductVersion, ProjectSchema, Requirement, TraceabilityMatrix } from '@polenta/types'
import type { AuthService } from './auth.service'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import { TestsIndexService } from './tests-index.service'
import { TraceabilityService } from './traceability.service'
import { VersionRequirementsService } from './version-requirements.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH439 sprint 1 — couverture figée au passage released et lecture des exigences d'une version (specs/GH439-tests.md R, S).

const execFileAsync = promisify(execFile)
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
const type = (name: string, label: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition => ({
  name, label, prefix, category, statuses: category === 'version' ? VERSION_STATUSES : STATUSES,
  fields: category === 'requirement' ? [{ name: 'priority', label: 'Priorité', type: 'text' }] : [],
})
const schemaOf = (reqLabel = 'Exigence'): ProjectSchema => ({
  version: 1,
  linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
  nodes: [{ name: 'root', label: 'Produit', objectTypes: [type('exigence', reqLabel, 'PR', 'requirement'), type('test', 'Test', 'PT', 'test'), type('version', 'Version', 'PV', 'version')] }],
} as unknown as ProjectSchema)

const auth = { getAuthor: async () => ({ name: 'Alice', email: 'a@x' }), getHttpsCredentials: async () => null } as unknown as AuthService
const T0 = Date.UTC(2026, 10, 1) / 1000
let tick = 0
let ws: string, root: string
let gitSvc: GitService
let versions: VersionsService
let service: VersionRequirementsService
let trace: TraceabilityService
let matrixSpy: MockInstance<TraceabilityService['getMatrix']>
let currentSchema: ProjectSchema
let frozenSchema: ProjectSchema

const commitAll = (message: string) => new TestRepo(root).commitAll(message, { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick })
const req = (id: string, extra: Record<string, unknown> = {}) => gitSvc.writeYaml(root, `requirements/${id}.yaml`, {
  id, objectTypeRef: 'root::exigence', title: `Titre ${id}`, status: 'draft', version: 1, fields: { priority: 'high' }, ...extra,
})
const test = (id: string) => gitSvc.writeYaml(root, `tests/${id}.yaml`, { id, objectTypeRef: 'root::test', title: `Test ${id}`, status: 'draft', version: 1, fields: {}, steps: [] })
const links = (pairs: Array<[string, string, string]>) => gitSvc.writeYaml(root, 'links/links.yaml', {
  links: pairs.map(([sourceId, targetId, t], i) => ({ id: `L${i}`, type: t, sourceId, targetId }) as ObjectLink),
})
const matrixOf = (rows: Array<[string, CoverageStatus, string[]?]>): TraceabilityMatrix => ({
  requirements: rows.map(([id, coverageStatus, tests = []]) => ({
    requirement: { id } as Requirement, coverageStatus,
    cells: tests.map(testCaseId => ({ testCaseId, coverageType: 'full' as const, status: 'not_run' as const, lastRunId: null, lastRunDate: null })),
  })),
  testCases: [], filters: {}, generatedAt: '',
})
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])
const head = () => new TestRepo(root).resolve('HEAD')
const git = async (...args: string[]) => (await execFileAsync('git', ['-C', root, ...args])).stdout
const versionFile = (id: string) => gitSvc.readYaml<ProductVersion>(root, `versions/${id}.yaml`)

/** IDs des exigences du repo (`PR-…`) présentes sur le disque. */
const requirementIds = async () => (await fsP.readdir(path.join(root, 'requirements')).catch(() => [] as string[]))
  .filter(f => /^PR-\d+\.yaml$/.test(f)).map(f => f.replace('.yaml', '')).sort()

/**
 * Version released. Elle inclut `include` (défaut : toutes les exigences `PR-…` du repo) : seules les exigences
 * incluses dans la version ou dans sa lignée sont listées (GH439 rév. 3). `matrix` : couverture lue au passage.
 * `basedOn` : dernière version released du repo, comme à la création d'une version.
 */
async function released(title = '1.0', tag = 'p-1.0', matrix?: TraceabilityMatrix, include?: string[]): Promise<ProductVersion> {
  if (matrix) matrixSpy.mockResolvedValue(matrix)
  const v = await versions.create(root, { title })
  const ids = include ?? await requirementIds()
  if (ids.length > 0) await versions.include(root, v.id, ids)
  return versions.release(root, v.id, tag)
}
const ids = (page: { rows: Array<{ requirementId: string }> }) => page.rows.map(r => r.requirementId)

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh439-'))
  root = path.join(ws, 'produit')
  gitSvc = new GitService()
  currentSchema = schemaOf()
  frozenSchema = schemaOf()
  await fsP.mkdir(root, { recursive: true })
  await TestRepo.init(root, 'main')
  await gitSvc.writeYaml(root, '.polenta/schema.yaml', currentSchema)
  await commitAll('schéma')
  // `getAt` : le schéma du gel ; `get` : le schéma courant, que les tests peuvent changer.
  const schemaStub = { get: async () => currentSchema, getAt: async () => frozenSchema } as unknown as SchemaService
  const treeStub = { readCache: async () => null } as unknown as WorkspaceTreeService
  versions = new VersionsService(gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
  trace = new TraceabilityService(new RequirementsIndexService(gitSvc), new TestsIndexService(gitSvc), gitSvc, new SyncService(auth), treeStub)
  versions.setImpactSources({ traceability: trace, campaigns: new CampaignsService(gitSvc, undefined as never) })
  service = new VersionRequirementsService(versions, trace)
  matrixSpy = vi.spyOn(trace, 'getMatrix')
  matrixSpy.mockResolvedValue(matrixOf([]))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('passage released : couverture figée', () => {
  it('R1/R2/R3 — une ligne par exigence du périmètre, triées ; la terminale est absente ; computedAt posé', async () => {
    await req('PR-0010'); await req('PR-0002'); await req('PR-0003', { status: 'obsolete' })
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0002', 'validated', ['PT-0001']], ['PR-0003', 'validated', ['PT-0001']], ['PR-0010', 'failing', ['PT-0002', 'PT-0001']]]))
    expect(v.verification).toEqual({
      computedAt: v.freeze!.at,
      rows: [{ id: 'PR-0002', status: 'validated', tests: ['PT-0001'] }, { id: 'PR-0010', status: 'failing', tests: ['PT-0001', 'PT-0002'] }],
    })
    // Écrit dans le fichier de version, et dans le commit du passage.
    expect((await versionFile(v.id))!.verification).toEqual(v.verification)
    expect(await gitSvc.readTextAt(root, await head(), `versions/${v.id}.yaml`)).toContain('verification:')
  })

  it('R2 — dans le même commit que le fichier de version, aucun autre fichier', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    expect((await git('show', '--name-only', '--format=', 'HEAD')).trim()).toBe(`versions/${v.id}.yaml`)
  })

  it('R3 — statuts de vérification repris tels quels (covered, failing, needs_revalidation, not_covered)', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003', 'PR-0004']) await req(id)
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'covered', ['PT-0001']], ['PR-0002', 'failing', ['PT-0002']], ['PR-0003', 'needs_revalidation', ['PT-0003']]]))
    expect(v.verification!.rows.map(r => `${r.id}:${r.status}`)).toEqual(['PR-0001:covered', 'PR-0002:failing', 'PR-0003:needs_revalidation', 'PR-0004:not_covered'])
  })

  it('R1 (réel) — sans espion : lien de vérification lu par la vraie matrice', async () => {
    matrixSpy.mockRestore()
    await req('PR-0001'); await req('PR-0002'); await test('PT-0001')
    await links([['PT-0001', 'PR-0001', 'verification']])
    await commitAll('exigences et liens')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001', 'PR-0002'])
    const done = await versions.release(root, v.id, 'p-1.0')
    expect(done.verification!.rows).toEqual([
      { id: 'PR-0001', status: 'covered', tests: ['PT-0001'] },
      { id: 'PR-0002', status: 'not_covered', tests: [] },
    ])
  })

  it('R4 — matrice illisible : le passage échoue, version en cours, ni tag, ni commit, rien d\'écrit', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await versions.create(root, { title: '1.0' })
    await commitAll('version')
    const before = await head()
    matrixSpy.mockRejectedValue(new Error('index illisible'))
    expect(await code(versions.release(root, v.id, 'p-1.0'))).toBe('index illisible')
    expect(await head()).toBe(before)
    expect(await gitSvc.resolveTagOid(root, 'p-1.0')).toBeNull()
    const file = await versionFile(v.id)
    expect(file).toMatchObject({ status: 'en_cours' })
    expect(file!.freeze).toBeUndefined()
    expect(file!.verification).toBeUndefined()
  })

  it('R4b — schéma du gel illisible : le passage échoue (les exigences terminales ne doivent pas entrer dans le périmètre figé)', async () => {
    await req('PR-0001'); await req('PR-0002', { status: 'obsolete' }); await commitAll('exigences')
    const v = await versions.create(root, { title: '1.0' })
    await commitAll('version')
    const before = await head()
    frozenSchema = null as unknown as ProjectSchema
    expect(await code(versions.release(root, v.id, 'p-1.0'))).toBe('VERSION_NOT_FOUND')
    expect(await head()).toBe(before)
    expect(await gitSvc.resolveTagOid(root, 'p-1.0')).toBeNull()
    expect((await versionFile(v.id))!.verification).toBeUndefined()
  })

  it('R5 — sans moteur de traçabilité : passage sans verification (comportement d\'avant)', async () => {
    const schemaStub = { get: async () => currentSchema, getAt: async () => frozenSchema } as unknown as SchemaService
    const plain = new VersionsService(gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub))
    await req('PR-0001'); await commitAll('exigences')
    const v = await plain.create(root, { title: '1.0' })
    const done = await plain.release(root, v.id, 'p-1.0')
    expect(done.freeze).toBeDefined()
    expect(done.verification).toBeUndefined()
  })

  it('R6 — version released verrouillée : une modification est refusée, verification intacte', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'covered', ['PT-0001']]]))
    expect(await code(versions.update(root, v.id, { title: '2.0' }))).toBe('VERSION_LOCKED')
    expect((await versionFile(v.id))!.verification).toEqual(v.verification)
  })

  it('R7 — copier une version released : la copie n\'a ni freeze, ni analysis, ni verification', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    const copy = await versions.copy(root, v.id)
    expect(copy.freeze).toBeUndefined()
    expect(copy.analysis).toBeUndefined()
    expect(copy.verification).toBeUndefined()
    expect((await versionFile(copy.id))!.verification).toBeUndefined()
  })

  it('R8 — réécriture par un renommage de schéma (GH381) : verification intacte', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'validated', ['PT-0001']]]))
    await versions.rewriteObjects(root, 'root::version', o => ({ ...o, fields: { ...o.fields, renamed: true } }), { migrated: [], skipped: [], failed: [] } as never)
    const file = await versionFile(v.id)
    expect(file!.fields).toEqual({ renamed: true })
    expect(file!.verification).toEqual(v.verification)
  })

  it('R9 — la page (versions:get) ne renvoie pas verification ; l\'analyse est inchangée', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    const page = await versions.page(root, v.id)
    expect(page.version.verification).toBeUndefined()
    expect(page.version.analysis).toEqual(v.analysis)
    expect((await versions.get(root, v.id)).verification).toBeDefined()
  })
})

describe('lecture des exigences d\'une version', () => {
  it('S1 — version released : lignes du périmètre à l\'état du gel, couverture figée', async () => {
    await req('PR-0001'); await req('PR-0002', { status: 'approved', version: 2 }); await req('PR-0003', { status: 'obsolete' })
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'validated', ['PT-0001']]]))
    const page = await service.page(root, v.id)
    expect(page.verification).toBe('frozen')
    expect(page.version).toEqual({ id: v.id, title: '1.0', state: 'released', freeze: v.freeze })
    expect(page.rows).toEqual([
      { requirementId: 'PR-0001', title: 'Titre PR-0001', objectTypeRef: 'root::exigence', status: 'draft', version: 1, fields: { priority: 'high' }, coverageStatus: 'validated', tests: ['PT-0001'] },
      { requirementId: 'PR-0002', title: 'Titre PR-0002', objectTypeRef: 'root::exigence', status: 'approved', version: 2, fields: { priority: 'high' }, coverageStatus: 'not_covered', tests: [] },
    ])
    expect(page.requirementTypeLabels).toEqual({ 'root::exigence': 'Exigence' })
    expect(page.requirementStatusLabels).toMatchObject({ draft: 'Brouillon', approved: 'Approuvé' })
    expect(page.requirementFields.map(f => f.name)).toEqual(['priority'])
  })

  it('S2 — une exigence modifiée après la release garde le titre et le statut du gel', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    await req('PR-0001', { title: 'Nouveau titre', status: 'approved', version: 2 })
    await commitAll('modif')
    const row = (await service.page(root, v.id)).rows[0]
    expect(row).toMatchObject({ title: 'Titre PR-0001', status: 'draft', version: 1 })
  })

  it('S3 — couverture lue dans la copie figée : inchangée quand la matrice change, aucun calcul de matrice', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'validated', ['PT-0001']]]))
    matrixSpy.mockClear()
    matrixSpy.mockResolvedValue(matrixOf([['PR-0001', 'failing', ['PT-0009']]]))
    const row = (await service.page(root, v.id)).rows[0]
    expect(row).toMatchObject({ coverageStatus: 'validated', tests: ['PT-0001'] })
    expect(matrixSpy).not.toHaveBeenCalled()
  })

  it('S4 — une exigence créée après la release est absente', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    await req('PR-0004'); await commitAll('nouvelle')
    expect((await service.page(root, v.id)).rows.map(r => r.requirementId)).toEqual(['PR-0001'])
  })

  it('S5 — version en cours : exigences du disque, couverture à l\'instant', async () => {
    await req('PR-0001'); await req('PR-0002')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001', 'PR-0002'])
    matrixSpy.mockResolvedValue(matrixOf([['PR-0001', 'covered', ['PT-0001']]]))
    const page = await service.page(root, v.id)
    expect(page.verification).toBe('live')
    expect(page.version).toMatchObject({ state: 'in_progress', freeze: null })
    expect(page.rows.map(r => `${r.requirementId}:${r.coverageStatus}`)).toEqual(['PR-0001:covered', 'PR-0002:not_covered'])
    expect(matrixSpy).toHaveBeenCalled()
    // Modifiée sur le disque (non committée) : visible tout de suite.
    await req('PR-0002', { title: 'Changé' })
    expect((await service.page(root, v.id)).rows[1].title).toBe('Changé')
  })

  it('S6 — version released avant GH439 (sans verification) : lignes au gel, couverture absente, aucun calcul', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    const { verification: _dropped, ...legacy } = (await versionFile(v.id))!
    await gitSvc.writeYaml(root, `versions/${v.id}.yaml`, legacy)
    matrixSpy.mockClear()
    const page = await service.page(root, v.id)
    expect(page.verification).toBe('missing')
    expect(page.rows).toEqual([expect.objectContaining({ requirementId: 'PR-0001', coverageStatus: null, tests: [] })])
    expect(matrixSpy).not.toHaveBeenCalled()
  })

  it('S7 — fichier d\'un type non déclaré par le schéma : absent, même listé à la main dans `changes`', async () => {
    await req('PR-0001')
    await req('SW-0001', { objectTypeRef: 'firmware::exigence' })
    await commitAll('exigences')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    expect(await code(versions.include(root, v.id, ['SW-0001']))).toBe('NOT_OWN_ELEMENT')
    const file = (await versionFile(v.id))!
    await gitSvc.writeYaml(root, `versions/${v.id}.yaml`, { ...file, changes: [...file.changes!, { id: 'SW-0001' }] })
    expect(ids(await service.page(root, v.id))).toEqual(['PR-0001'])
  })

  it('S8 — version abandonnée sans gel : VERSION_NOT_FROZEN', async () => {
    await req('PR-0001')
    const v = await versions.create(root, { title: '1.0' })
    await versions.update(root, v.id, { status: 'abandonnee' })
    expect(await code(service.page(root, v.id))).toBe('VERSION_NOT_FROZEN')
  })

  it('S9 — version released puis abandonnée : page lue au gel', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', matrixOf([['PR-0001', 'validated', ['PT-0001']]]))
    await versions.update(root, v.id, { status: 'abandonnee' })
    const page = await service.page(root, v.id)
    expect(page.version.state).toBe('abandoned')
    expect(page.verification).toBe('frozen')
    expect(page.rows[0]).toMatchObject({ requirementId: 'PR-0001', coverageStatus: 'validated' })
  })

  it('S10 — commit figé absent du repo : VERSION_NOT_FOUND, pas de liste vide', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    const file = (await versionFile(v.id))!
    await gitSvc.writeYaml(root, `versions/${v.id}.yaml`, { ...file, freeze: { ...file.freeze!, sha: '0'.repeat(40) } })
    expect(await code(service.page(root, v.id))).toBe('VERSION_NOT_FOUND')
  })

  it('S10b — schéma du gel illisible : erreur, pas de liste qui garderait les exigences terminales', async () => {
    await req('PR-0001'); await req('PR-0002', { status: 'obsolete' }); await commitAll('exigences')
    const v = await released()
    frozenSchema = null as unknown as ProjectSchema
    expect(await code(service.page(root, v.id))).toBe('VERSION_NOT_FOUND')
  })

  it('S11 — type renommé après la release : libellés et champs lus du schéma du gel', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    currentSchema = schemaOf('Exigence renommée')
    const page = await service.page(root, v.id)
    expect(page.requirementTypeLabels).toEqual({ 'root::exigence': 'Exigence' })
  })

  it('S12/S13 — repo sans exigence : aucune ligne ; tri numérique (2 avant 10)', async () => {
    const empty = await versions.create(root, { title: '0.1' })
    expect((await service.page(root, empty.id)).rows).toEqual([])
    for (const id of ['PR-0010', 'PR-0002', 'PR-0100']) await req(id)
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0')
    expect((await service.page(root, v.id)).rows.map(r => r.requirementId)).toEqual(['PR-0002', 'PR-0010', 'PR-0100'])
  })

  it('S14 — composant en lecture seule (HEAD détaché) : page lue', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    await git('checkout', '--detach')
    expect((await service.page(root, v.id)).rows).toHaveLength(1)
  })

  it('S15 — lecture seule : aucune écriture', async () => {
    await req('PR-0001'); await commitAll('exigences')
    const v = await released()
    const status = await git('status', '--porcelain')
    const file = await fsP.readFile(path.join(root, 'versions', `${v.id}.yaml`), 'utf8')
    await service.page(root, v.id)
    expect(await git('status', '--porcelain')).toBe(status)
    expect(await fsP.readFile(path.join(root, 'versions', `${v.id}.yaml`), 'utf8')).toBe(file)
  })

  it("S16 — le périmètre d'une release est celui de ses lignes `verification` : sans ligne, l'exigence n'est pas listée", async () => {
    await req('PR-0001'); await req('PR-0002'); await commitAll('exigences')
    const v = await released()
    const file = (await versionFile(v.id))!
    await gitSvc.writeYaml(root, `versions/${v.id}.yaml`, { ...file, verification: { ...file.verification!, rows: file.verification!.rows.filter(r => r.id !== 'PR-0002') } })
    const rows = (await service.page(root, v.id)).rows
    expect(rows.map(r => `${r.requirementId}:${r.coverageStatus}`)).toEqual(['PR-0001:not_covered'])
  })
})

describe('périmètre : contenu cumulé de la lignée (GH439 rév. 3)', () => {
  it('S19 — première release : seulement ses changements, pas le reste du repo', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0004', 'PR-0005']) await req(id)
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', undefined, ['PR-0001', 'PR-0002'])
    expect(ids(await service.page(root, v.id))).toEqual(['PR-0001', 'PR-0002'])   // PR-0004, PR-0005 : jamais livrées
    // La couverture figée ne porte que sur ces exigences.
    expect((await versionFile(v.id))!.verification!.rows.map(r => r.id)).toEqual(['PR-0001', 'PR-0002'])
  })

  it('S20 — 1.1 basée sur la 1.0 : ce que la 1.0 a livré et ses propres changements ; la 1.0 reste inchangée', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003', 'PR-0004']) await req(id)
    await commitAll('exigences')
    const v10 = await released('1.0', 'p-1.0', undefined, ['PR-0001', 'PR-0002'])
    const v11 = await released('1.1', 'p-1.1', undefined, ['PR-0003'])
    expect((await versionFile(v11.id))!.basedOn).toBe(v10.id)
    expect(ids(await service.page(root, v11.id))).toEqual(['PR-0001', 'PR-0002', 'PR-0003'])
    expect(ids(await service.page(root, v10.id))).toEqual(['PR-0001', 'PR-0002'])
  })

  it('S21 — une version abandonnée de la lignée ne livre rien ; la lignée se poursuit au-delà', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003']) await req(id)
    await commitAll('exigences')
    await released('1.0', 'p-1.0', undefined, ['PR-0001'])
    const v11 = await released('1.1', 'p-1.1', undefined, ['PR-0002'])
    // 1.2 se base sur la 1.1 (released à sa création), qui est abandonnée ensuite.
    const v12 = await versions.create(root, { title: '1.2' })
    expect((await versionFile(v12.id))!.basedOn).toBe(v11.id)
    await versions.include(root, v12.id, ['PR-0003'])
    await versions.update(root, v11.id, { status: 'abandonnee' })
    expect(ids(await service.page(root, v12.id))).toEqual(['PR-0001', 'PR-0003'])   // PR-0002 : livrée par la 1.1 abandonnée
    // La version abandonnée garde sa propre liste (page lue au gel).
    expect(ids(await service.page(root, v11.id))).toEqual(['PR-0001', 'PR-0002'])
  })

  it('S26 — une release ne change pas quand une version de sa lignée est abandonnée ensuite', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003']) await req(id)
    await commitAll('exigences')
    await released('1.0', 'p-1.0', undefined, ['PR-0001'])
    const v11 = await released('1.1', 'p-1.1', undefined, ['PR-0002'])
    const v12 = await released('1.2', 'p-1.2', undefined, ['PR-0003'])
    expect(ids(await service.page(root, v12.id))).toEqual(['PR-0001', 'PR-0002', 'PR-0003'])
    await versions.update(root, v11.id, { status: 'abandonnee' })
    // Périmètre figé avec la couverture : la 1.2 garde ce qu'elle a livré, comme sa couverture figée.
    expect(ids(await service.page(root, v12.id))).toEqual(['PR-0001', 'PR-0002', 'PR-0003'])
    expect((await versionFile(v12.id))!.verification!.rows.map(r => r.id)).toEqual(['PR-0001', 'PR-0002', 'PR-0003'])
  })

  it('S22 — version en cours basée sur la 1.0 : ce que la 1.0 a livré, puis ses changements au fil de l\'eau', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0005']) await req(id)
    await commitAll('exigences')
    await released('1.0', 'p-1.0', undefined, ['PR-0001', 'PR-0002'])
    const cur = await versions.create(root, { title: '1.1' })
    expect(ids(await service.page(root, cur.id))).toEqual(['PR-0001', 'PR-0002'])
    await versions.include(root, cur.id, ['PR-0005'])
    const page = await service.page(root, cur.id)
    expect(ids(page)).toEqual(['PR-0001', 'PR-0002', 'PR-0005'])
    expect(page.verification).toBe('live')
  })

  it('S23 — exigence incluse mais terminale à l\'état lu : absente', async () => {
    await req('PR-0001'); await req('PR-0002', { status: 'obsolete' })
    await commitAll('exigences')
    const v = await released('1.0', 'p-1.0', undefined, ['PR-0001', 'PR-0002'])
    expect(ids(await service.page(root, v.id))).toEqual(['PR-0001'])
  })

  it('S24 — élément inclus qui n\'est pas une exigence, ou absent à l\'état lu : ni ligne, ni erreur', async () => {
    await req('PR-0001'); await test('PT-0001')
    await commitAll('éléments')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001', 'PT-0001'])
    const file = (await versionFile(v.id))!
    await gitSvc.writeYaml(root, `versions/${v.id}.yaml`, { ...file, changes: [...file.changes!, { id: 'PR-0999' }] })
    expect(ids(await service.page(root, v.id))).toEqual(['PR-0001'])
  })

  it('S25 — cycle dans basedOn (fichiers édités à la main) : la lecture termine, chaque version comptée une fois', async () => {
    await req('PR-0001'); await req('PR-0002')
    await commitAll('exigences')
    const a = await versions.create(root, { title: 'A' })
    const b = await versions.create(root, { title: 'B' })
    await versions.include(root, a.id, ['PR-0001'])
    await versions.include(root, b.id, ['PR-0002'])
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const file = (await versionFile(from.id))!
      await gitSvc.writeYaml(root, `versions/${from.id}.yaml`, { ...file, basedOn: to.id })
    }
    expect(ids(await service.page(root, a.id))).toEqual(['PR-0001', 'PR-0002'])
  })
})

describe('volume (leçon GH335 : tester la limite)', () => {
  it('R10/S17 — 1 500 exigences : passage et lecture terminent, ordre correct, taille du fichier raisonnable', { timeout: 180_000 }, async () => {
    const N = 1500
    const ids = Array.from({ length: N }, (_, i) => `PR-${String(i + 1).padStart(4, '0')}`)
    await fsP.mkdir(path.join(root, 'requirements'), { recursive: true })
    await Promise.all(ids.map(id => fsP.writeFile(path.join(root, 'requirements', `${id}.yaml`),
      `id: ${id}\nobjectTypeRef: root::exigence\ntitle: Titre ${id}\nstatus: draft\nversion: 1\nfields:\n  priority: high\n`)))
    await commitAll('1500 exigences')
    const statuses: CoverageStatus[] = ['not_covered', 'covered', 'validated', 'failing', 'needs_revalidation']
    const v = await released('1.0', 'p-1.0', matrixOf(ids.map((id, i): [string, CoverageStatus, string[]] => [id, statuses[i % 5], i % 5 === 0 ? [] : [`PT-${String(i + 1).padStart(4, '0')}`]])))
    expect(v.verification!.rows).toHaveLength(N)
    const size = (await fsP.stat(path.join(root, 'versions', `${v.id}.yaml`))).size
    console.info(`[GH439] fichier de version à ${N} exigences : ${(size / 1024).toFixed(0)} Ko`)
    expect(size).toBeLessThan(400 * 1024)
    const page = await service.page(root, v.id)
    expect(page.rows).toHaveLength(N)
    expect(page.rows.map(r => r.requirementId)).toEqual(ids)
    expect(page.rows[1]).toMatchObject({ coverageStatus: 'covered', tests: ['PT-0002'] })
  })
})
