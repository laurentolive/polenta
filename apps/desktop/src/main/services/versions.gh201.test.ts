import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, WorkspaceTree } from '@polenta/types'
import { isValidTagName, suggestVersionTag } from '@polenta/types'
import { GitService } from './git.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import type { AuthService } from './auth.service'
import { BaselineService } from './baseline.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH201 sprint 1 — objet version, backlog, page, passage released (specs/GH201-tests.md).

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
const type = (name: string, prefix: string, category: ObjectTypeDefinition['category']): ObjectTypeDefinition =>
  ({ name, label: name, prefix, category, fields: [], statuses: category === 'version' ? VERSION_STATUSES : STATUSES })
const schemaOf = (prefix: string): ProjectSchema => ({
  version: 1, linkTypes: [],
  nodes: [{ name: 'root', label: 'Produit', objectTypes: [type('exigence', `${prefix}R`, 'requirement'), type('test', `${prefix}T`, 'test'), type('version', `${prefix}V`, 'version')] }],
} as unknown as ProjectSchema)

const T0 = Date.UTC(2026, 9, 1) / 1000
const auth = {
  getAuthor: async () => ({ name: 'Alice', email: 'a@x' }),
  getHttpsCredentials: async () => null,
} as unknown as AuthService

let ws: string
let root: string
let comp: string
let gitSvc: GitService
let sync: SyncService
let versions: VersionsService
let schemas: Map<string, ProjectSchema>
let tree: WorkspaceTree | null

async function initRepo(dir: string, prefix: string) {
  await fsP.mkdir(dir, { recursive: true })
  await git.init({ fs, dir, defaultBranch: 'main' })
  schemas.set(path.resolve(dir), schemaOf(prefix))
  await gitSvc.writeYaml(dir, '.polenta/schema.yaml', schemaOf(prefix))
  await commitAll(dir, 'schéma')
}
let tick = 0
async function commitAll(dir: string, message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const writeReq = (dir: string, id: string, extra: Record<string, unknown> = {}) => gitSvc.writeYaml(dir, `requirements/${id}.yaml`, {
  id, projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: `Titre ${id}`, status: 'draft', version: 1, fields: {}, ...extra,
})
const writeTest = (dir: string, id: string, extra: Record<string, unknown> = {}) => gitSvc.writeYaml(dir, `tests/${id}.yaml`, {
  id, objectTypeRef: 'root::test', title: `Test ${id}`, status: 'draft', version: 1, fields: {}, steps: [], ...extra,
})
const backlogIds = async (dir: string) => (await versions.backlog(dir)).map(i => `${i.id}:${i.kind}`)
const head = (dir: string) => git.resolveRef({ fs, dir, ref: 'HEAD' })
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh201-'))
  root = path.join(ws, 'produit')
  comp = path.join(ws, 'moteur')
  gitSvc = new GitService()
  schemas = new Map()
  sync = new SyncService(auth)
  await initRepo(root, 'P')
  await initRepo(comp, 'M')
  tree = null
  const schemaStub = { get: async (repo: string) => schemas.get(path.resolve(repo)) ?? schemaOf('X') } as unknown as SchemaService
  const treeStub = { readCache: async () => tree } as unknown as WorkspaceTreeService
  versions = new VersionsService(gitSvc, sync, schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function setTree() {
  const node = (name: string, repoPath: string, children: WorkspaceTree['nodes'] = []) =>
    ({ name, label: name, repoPath, url: '', pin: '', isInterface: false, children })
  const moteur = node('moteur', comp)
  const produit = node('produit', root, [moteur])
  tree = { rootRepoHeadSha: '', generatedAt: '', nodes: [produit, moteur], logicalTree: produit }
}

/** Version released du repo, avec tous ses éléments inclus. */
async function releaseAll(dir: string, title: string, tag: string, components?: Record<string, string>) {
  const v = await versions.create(dir, { title, components }, tree ? ws : undefined)
  await versions.include(dir, v.id, (await versions.backlog(dir)).map(i => i.id), tree ? ws : undefined)
  return versions.release(dir, v.id, tag, tree ? ws : undefined)
}

describe('création et cycle de vie', () => {
  it('N2 — Nouvelle version : fichier, ID, statut initial ; plusieurs en cours à la fois', async () => {
    const v = await versions.create(root, { title: '1.0' })
    expect(v).toMatchObject({ id: 'PV-0001', objectTypeRef: 'root::version', title: '1.0', status: 'en_cours', changes: [] })
    expect(await gitSvc.fileExists(root, 'versions/PV-0001.yaml')).toBe(true)
    expect((await versions.create(root, { title: '1.1' })).status).toBe('en_cours')
    expect(await code(versions.create(root, { title: '1.1' }))).toBe('LABEL_TAKEN')
  })

  it('L3 — label pris, repris après abandon', async () => {
    const v = await versions.create(root, { title: '1.0' })
    await versions.update(root, v.id, { status: 'abandonnee' })
    expect((await versions.create(root, { title: '1.0' })).id).toBe('PV-0002')
    expect(await code(versions.update(root, v.id, { status: 'en_cours' }))).toBe('VERSION_LOCKED')   // abandonnée : définitive
  })

  it('L8 — passage released par update refusé', async () => {
    const v = await versions.create(root, { title: '1.0' })
    expect(await code(versions.update(root, v.id, { status: 'released' }))).toBe('RELEASE_REQUIRED')
  })

  it('sans type version → NO_VERSION_TYPE', async () => {
    schemas.set(path.resolve(root), { version: 1, linkTypes: [], nodes: [{ name: 'root', objectTypes: [] }] } as unknown as ProjectSchema)
    expect(await code(versions.create(root, { title: '1.0' }))).toBe('NO_VERSION_TYPE')
  })
})

describe('backlog', () => {
  it('N3/N4/L10 — première version : tout le composant hors terminaux ; Tout inclure vide le backlog', async () => {
    await writeReq(root, 'PR-0001')
    await writeReq(root, 'PR-0002', { status: 'obsolete' })
    await writeTest(root, 'PT-0001')
    expect(await backlogIds(root)).toEqual(['PR-0001:new', 'PT-0001:new'])
    const v = await versions.create(root, { title: '1.0' })
    const updated = await versions.include(root, v.id, ['PR-0001', 'PT-0001'])
    expect(updated.changes).toEqual([{ id: 'PR-0001' }, { id: 'PT-0001' }])
    expect(await backlogIds(root)).toEqual([])
  })

  it('élément d\'un autre composant (type non déclaré par le schéma) : hors backlog, inclusion refusée', async () => {
    await writeReq(root, 'PR-0001')
    await writeReq(root, 'SW-0001', { objectTypeRef: 'firmware::exigence-sw' })
    expect(await backlogIds(root)).toEqual(['PR-0001:new'])
    const v = await versions.create(root, { title: '1.0' })
    expect(await code(versions.include(root, v.id, ['SW-0001']))).toBe('NOT_OWN_ELEMENT')
    expect((await versions.get(root, v.id)).changes ?? []).toEqual([])
  })

  it('N9 — Retirer remet au backlog ; retrait de plusieurs changements en une fois', async () => {
    await writeReq(root, 'PR-0001')
    const v = await versions.create(root, { title: '1.0' })
    await writeReq(root, 'PR-0002')
    await writeTest(root, 'PT-0001')
    await versions.include(root, v.id, ['PR-0001', 'PR-0002', 'PT-0001'])
    await versions.removeChanges(root, v.id, ['PR-0001', 'PT-0001'])
    expect(await backlogIds(root)).toEqual(['PR-0001:new', 'PT-0001:new'])
  })

  it('N6/N7/L13 — modifié après released : au backlog avec base ; inchangé ou history seul : absent', async () => {
    await writeReq(root, 'PR-0001')
    await writeReq(root, 'PR-0002')
    await writeReq(root, 'PR-0003')
    await commitAll(root, 'éléments')
    const v1 = await releaseAll(root, '1.0', 'produit-1.0')
    await writeReq(root, 'PR-0001', { title: 'Nouveau titre', version: 1 })
    await writeReq(root, 'PR-0003', { history: { status: [{ value: 'draft', at: '2026-10-01T00:00:00Z', by: 'x' }] }, needsRevalidation: true })
    const items = await versions.backlog(root)
    expect(items.map(i => i.id)).toEqual(['PR-0001'])
    expect(items[0]).toMatchObject({ kind: 'modified', base: { sha: v1.freeze!.sha, version: 1 } })
    const v2 = await versions.create(root, { title: '1.1', basedOn: v1.id })
    const inc = await versions.include(root, v2.id, ['PR-0001', 'PR-0002'])
    expect(inc.changes).toEqual([
      { id: 'PR-0001', base: { sha: v1.freeze!.sha, version: 1 } },
      { id: 'PR-0002', base: { sha: v1.freeze!.sha, version: 1 } },   // N8 — Ajouter un élément inchangé
    ])
  })

  it('L11 — approuvé modifié hors interface : signalé', async () => {
    await writeReq(root, 'PR-0001', { status: 'approved' })
    await commitAll(root, 'approbation')
    await writeReq(root, 'PR-0001', { status: 'approved', title: 'Modifié à la main' })
    const [item] = await versions.backlog(root)
    expect(item).toMatchObject({ id: 'PR-0001', kind: 'new', outside: { dirty: true } })
  })
})

describe('passage released', () => {
  it('N5 — commit du seul fichier de version, tag annoté, freeze = HEAD précédent', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const before = await head(root)
    await gitSvc.writeText(root, 'autre.txt', 'en attente')
    const preview = await versions.releasePreview(root, (await versions.create(root, { title: '1.0' })).id)
    expect(preview).toEqual({ suggestedTag: 'produit-1.0', problems: [] })
    await versions.include(root, 'PV-0001', ['PR-0001'])
    expect(await code(versions.release(root, 'PV-0001', 'produit-1.0'))).toBe('ok')
    const v = await versions.get(root, 'PV-0001')
    expect(v).toMatchObject({ status: 'released', freeze: { tag: 'produit-1.0', sha: before } })
    const commit = await head(root)
    expect(await gitSvc.resolveTagOid(root, 'produit-1.0')).toBe(commit)
    const { commit: c } = await git.readCommit({ fs, dir: root, oid: commit })
    expect(c.parent).toEqual([before])
    expect(c.message.trim()).toBe('[version] PV-0001 1.0 released')
    // Les autres modifications restent en attente, hors du commit.
    expect(await gitSvc.readTextAt(root, commit, 'autre.txt')).toBeNull()
    expect(await gitSvc.readTextAt(root, commit, 'versions/PV-0001.yaml')).toContain('status: released')
  })

  it('L4/L6 — tag existant, élément inclus non commité : refus sans écriture', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    await sync.createTag(root, 'pris')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    expect(await code(versions.release(root, v.id, 'pris'))).toBe('TAG_EXISTS')
    expect(await code(versions.release(root, v.id, 'mauvais tag'))).toBe('TAG_INVALID')
    // L'aperçu contrôle le tag saisi (le dialogue ne propose pas de confirmer un tag existant).
    expect((await versions.releasePreview(root, v.id, undefined, 'pris')).problems.map(p => p.code)).toEqual(['TAG_EXISTS'])
    await writeReq(root, 'PR-0001', { title: 'non commité' })
    expect(await code(versions.release(root, v.id, 'produit-1.0'))).toBe('DIRTY_CHANGES')
    expect((await versions.get(root, v.id)).status).toBe('en_cours')
  })

  it('L7 — version released verrouillée ; abandon accepté', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await releaseAll(root, '1.0', 'produit-1.0')
    expect(await code(versions.update(root, v.id, { title: '2.0' }))).toBe('VERSION_LOCKED')
    expect(await code(versions.update(root, v.id, { status: 'en_cours' }))).toBe('VERSION_LOCKED')
    expect(await code(versions.include(root, v.id, ['PR-0001']))).toBe('NOT_IN_PROGRESS')
    expect(await code(versions.update(root, v.id, { title: '1.0', status: 'abandonnee' }))).toBe('ok')
  })

  it('L7b — released puis abandonnée : ne revient pas en cours ; statut inconnu refusé', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await releaseAll(root, '1.0', 'produit-1.0')
    await versions.update(root, v.id, { status: 'abandonnee' })
    expect(await code(versions.update(root, v.id, { status: 'en_cours' }))).toBe('VERSION_LOCKED')
    expect(await code(versions.update(root, v.id, { title: 'x' }))).toBe('VERSION_LOCKED')
    const w = await versions.create(root, { title: '2.0' })
    expect(await code(versions.update(root, w.id, { status: 'inconnu' }))).toBe('STATUS_UNKNOWN')
  })

  it('échec du tag : branche, index et version inchangés', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const before = await head(root)
    const failing = new VersionsService(gitSvc, {
      commitSingleFile: sync.commitSingleFile.bind(sync), resolveHead: sync.resolveHead.bind(sync), queueTagPush: sync.queueTagPush.bind(sync),
      createAnnotatedTag: async () => { throw new Error('verrou de ref') },
      deleteTag: sync.deleteTag.bind(sync), pendingTags: sync.pendingTags.bind(sync),
    }, { get: async () => schemaOf('P') } as unknown as SchemaService, new VersionTrackingService(gitSvc, { get: async () => schemaOf('P') }))
    const v = await failing.create(root, { title: '1.0' })
    await failing.include(root, v.id, ['PR-0001'])
    await expect(failing.release(root, v.id, 'produit-1.0')).rejects.toThrow('verrou de ref')
    expect(await head(root)).toBe(before)
    expect((await failing.get(root, v.id)).status).toBe('en_cours')
  })

  it('L5 — composant non released : COMPONENT_NOT_RELEASED', async () => {
    setTree()
    const mv = await versions.create(comp, { title: 'm1' }, ws)
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title: '1.0', components: { moteur: mv.id } }, ws)
    expect((await versions.releasePreview(root, v.id, ws)).problems.map(p => p.code)).toEqual(['COMPONENT_NOT_RELEASED'])
  })

  it('N12/L14 — tag poussé au push suivant ; sans remote, reste en attente', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    await releaseAll(root, '1.0', 'produit-1.0')
    const pending = path.join(root, '.git', 'polenta-pending-tags')
    expect(await sync.pushPendingTags(root)).toEqual([])   // pas de remote
    expect((await fsP.readFile(pending, 'utf-8')).trim()).toBe('produit-1.0')
    const bare = path.join(ws, 'remote.git')
    await execFileAsync('git', ['init', '--bare', bare])
    await execFileAsync('git', ['remote', 'add', 'origin', bare], { cwd: root })
    await sync.pushBranch(root, 'main')
    expect((await fsP.readFile(pending, 'utf-8')).trim()).toBe('')
    const { stdout } = await execFileAsync('git', ['tag', '--list'], { cwd: bare })
    expect(stdout.trim()).toBe('produit-1.0')
  })
})

describe('page', () => {
  it('GH268 — une version de composant abandonnée n\'attribue plus ses changements au produit', async () => {
    setTree()
    await writeReq(comp, 'MR-0001')
    await commitAll(comp, 'm')
    const m1 = await releaseAll(comp, 'm1', 'moteur-m1')
    await writeReq(comp, 'MR-0002')
    await commitAll(comp, 'm2')
    const m2 = await releaseAll(comp, 'm2', 'moteur-m2')
    await writeReq(comp, 'MR-0003')
    await commitAll(comp, 'm3')
    const m3 = await releaseAll(comp, 'm3', 'moteur-m3')
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'p')
    const p1 = await releaseAll(root, '1.0', 'produit-1.0', { moteur: m1.id })
    const p2 = await versions.create(root, { title: '2.0', basedOn: p1.id, components: { moteur: m3.id } }, ws)
    await versions.update(comp, m2.id, { status: 'abandonnee' })
    expect((await versions.page(root, p2.id, ws)).rows.map(r => r.versionId)).toEqual([m3.id])
  })

  it('N10 — changements des versions du composant postérieures à basedOn ; L12 — élément supprimé', async () => {
    setTree()
    await writeReq(comp, 'MR-0001')
    await commitAll(comp, 'm')
    const m1 = await releaseAll(comp, 'm1', 'moteur-m1')
    await writeReq(comp, 'MR-0002')
    await commitAll(comp, 'm2')
    const m2 = await releaseAll(comp, 'm2', 'moteur-m2')
    await writeReq(comp, 'MR-0003')
    await commitAll(comp, 'm3')
    const m3 = await releaseAll(comp, 'm3', 'moteur-m3')
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'p')
    const p1 = await releaseAll(root, '1.0', 'produit-1.0', { moteur: m1.id })
    const p2 = await versions.create(root, { title: '2.0', basedOn: p1.id, components: { moteur: m3.id } }, ws)
    await writeReq(root, 'PR-0002')
    await versions.include(root, p2.id, ['PR-0002'])
    await fsP.rm(path.join(root, 'requirements', 'PR-0002.yaml'))
    const page = await versions.page(root, p2.id, ws)
    // m1 (retenue par basedOn) exclue ; m3 puis m2, chacune avec ses propres changements.
    expect(page.rows.map(r => `${r.component}/${r.versionId}/${r.id}/${r.own}`)).toEqual([
      'produit/PV-0002/PR-0002/true', 'moteur/MV-0003/MR-0003/false', 'moteur/MV-0002/MR-0002/false',
    ])
    expect(page.rows[0]).toMatchObject({ category: null, toSha: null })
    expect(page.rows[1]).toMatchObject({ category: 'requirement', toSha: m3.freeze!.sha, filePath: 'requirements/MR-0003.yaml' })
    expect(m2.freeze).toBeDefined()
    expect(page.components).toEqual([expect.objectContaining({ name: 'moteur', selected: expect.objectContaining({ id: m3.id }) })])
    expect(page.basedOn?.id).toBe(p1.id)
  })
})

describe('plusieurs versions en cours', () => {
  it('un élément inclus dans n\'importe quelle version en cours sort du backlog', async () => {
    await writeReq(root, 'PR-0001')
    await writeReq(root, 'PR-0002')
    await versions.create(root, { title: '1.0' })
    const b = await versions.create(root, { title: '2.0' })
    await versions.include(root, b.id, ['PR-0002'])
    expect(await backlogIds(root)).toEqual(['PR-0001:new'])
  })

  it('les livraisons se suivent par date de gel, pas par ID', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const first = await versions.create(root, { title: 'A' })
    const second = await versions.create(root, { title: 'B' })
    await versions.include(root, second.id, ['PR-0001'])
    await versions.release(root, second.id, 'tag-b')
    await writeReq(root, 'PR-0001', { title: 'modifiée' })
    await commitAll(root, 'modification')
    expect(await backlogIds(root)).toEqual(['PR-0001:modified'])
    await versions.include(root, first.id, ['PR-0001'])
    await new Promise(r => setTimeout(r, 5))
    const released = await versions.release(root, first.id, 'tag-a')
    expect(released.freeze?.at).toBeTruthy()
    // La plus ancienne par ID est la dernière livrée : elle fait référence.
    expect(await backlogIds(root)).toEqual([])
    expect((await versions.create(root, { title: 'C' })).basedOn).toBe(first.id)
  })
})

describe('suppression et copie', () => {
  it('supprime une version en cours (ID jamais réutilisé) ; pas une version figée', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    await versions.delete(root, v.id)
    expect(await gitSvc.fileExists(root, `versions/${v.id}.yaml`)).toBe(false)
    expect(await backlogIds(root)).toEqual(['PR-0001:new'])
    expect((await versions.create(root, { title: '1.1' })).id).toBe('PV-0002')
    await versions.update(root, 'PV-0002', { status: 'abandonnee' })
    await versions.delete(root, 'PV-0002')   // abandonnée sans avoir été livrée : supprimable
    const r = await releaseAll(root, '1.2', 'produit-1.2')
    expect(await code(versions.delete(root, r.id))).toBe('VERSION_LOCKED')
    await versions.update(root, r.id, { status: 'abandonnee' })
    expect(await code(versions.delete(root, r.id))).toBe('VERSION_LOCKED')   // porte un tag
  })

  it('copie : nouvelle version en cours, mêmes changements, sans gel ; label unique', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const r = await releaseAll(root, '1.0', 'produit-1.0')
    const c1 = await versions.copy(root, r.id)
    expect(c1).toMatchObject({ title: '1.0 (copie)', status: 'en_cours', changes: [{ id: 'PR-0001', base: { sha: r.freeze!.sha, version: 1 } }] })
    expect(c1.freeze).toBeUndefined()
    expect(c1.id).not.toBe(r.id)
    expect((await versions.copy(root, r.id)).title).toBe('1.0 (copie 2)')
  })
})

describe('statut de design', () => {
  it('L15 — première version released contenant la version courante de l\'exigence', async () => {
    await writeReq(root, 'PR-0001')
    await writeReq(root, 'PR-0002')
    await commitAll(root, 'éléments')
    const v1 = await releaseAll(root, '1.0', 'produit-1.0')
    await writeReq(root, 'PR-0002', { version: 2, title: 'rouverte' })
    await commitAll(root, 'réouverture')
    expect(Object.fromEntries(await versions.designVersions(root))).toEqual({ 'PR-0001': v1.id })
    const v2 = await releaseAll(root, '1.1', 'produit-1.1')
    expect(Object.fromEntries(await versions.designVersions(root))).toEqual({ 'PR-0001': v1.id, 'PR-0002': v2.id })
  })
})

describe('schéma', () => {
  it('L1 — un seul type version, sur le nœud root', async () => {
    const svc = new SchemaService(auth, { readCache: async () => null } as unknown as WorkspaceTreeService)
    const two = schemaOf('P')
    two.nodes[0].objectTypes!.push(type('version2', 'PW', 'version'))
    await expect(svc.save(root, two)).rejects.toMatchObject({ code: 'VERSION_TYPE_INVALID' })
    const nested = schemaOf('P')
    nested.nodes[0].children = [{ name: 'local', objectTypes: [type('v', 'LV', 'version')] } as never]
    nested.nodes[0].objectTypes = nested.nodes[0].objectTypes!.filter(t => t.category !== 'version')
    await expect(svc.save(root, nested)).rejects.toMatchObject({ code: 'VERSION_TYPE_INVALID' })
    await expect(svc.save(root, schemaOf('P'))).resolves.toBeUndefined()
  })

  it('type version avec des versions : ni renommé, ni re-préfixé, ni retiré', async () => {
    const svc = new SchemaService(auth, { readCache: async () => null } as unknown as WorkspaceTreeService)
    await versions.create(root, { title: '1.0' })
    const renamed = schemaOf('P')
    renamed.nodes[0].objectTypes!.find(t => t.category === 'version')!.prefix = 'PX'
    await expect(svc.save(root, renamed)).rejects.toMatchObject({ code: 'VERSION_TYPE_INVALID' })
    const removed = schemaOf('P')
    removed.nodes[0].objectTypes = removed.nodes[0].objectTypes!.filter(t => t.category !== 'version')
    await expect(svc.save(root, removed)).rejects.toMatchObject({ code: 'VERSION_TYPE_INVALID' })
    const unmarked = schemaOf('P')
    unmarked.nodes[0].objectTypes!.find(t => t.category === 'version')!.statuses = VERSION_STATUSES.map(s => ({ ...s, isApproval: false }))
    await expect(svc.save(root, unmarked)).rejects.toMatchObject({ code: 'VERSION_TYPE_INVALID' })
    const extra = schemaOf('P')
    extra.nodes[0].objectTypes!.find(t => t.category === 'version')!.statuses = [...VERSION_STATUSES, { name: 'recette', label: 'Recette' }]
    await expect(svc.save(root, extra)).resolves.toBeUndefined()   // un statut non marqué s'ajoute
  })
})

describe('tags', () => {
  it('suggestion et validation', () => {
    expect(suggestVersionTag('motor-control', '1.2.4')).toBe('motor-control-1.2.4')
    expect(suggestVersionTag('mon projet', 'v 2 (beta)')).toBe('mon-projet-v-2-beta')
    expect(isValidTagName('a/b-1.0')).toBe(true)
    for (const bad of ['', 'a b', 'a..b', 'a~1', 'a:b', 'fin.lock', '/a', 'a/', '-a']) expect(isValidTagName(bad)).toBe(false)
  })
})

describe('GH268 — corrections de la revue', () => {
  async function released(title: string, opts: { include?: string[]; basedOn?: string } = {}) {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title, ...(opts.basedOn && { basedOn: opts.basedOn }) })
    await versions.include(root, v.id, opts.include ?? ['PR-0001'])
    await commitAll(root, 'version')
    return versions.release(root, v.id, `produit-${title}`)
  }

  it('le tag d\'une version n\'est pas une baseline et ne se supprime pas', async () => {
    const v = await released('1.0')
    await commitAll(root, 'gel')
    await sync.createAnnotatedTag(root, 'baseline-a', 'autre', await head(root))
    const baselines = new BaselineService()
    expect((await baselines.list(root)).map(b => b.tag)).toEqual(['baseline-a'])
    await expect(baselines.delete(root, v.freeze!.tag)).rejects.toThrow(v.id)
    await expect(sync.deleteTag(root, v.freeze!.tag)).rejects.toThrow(v.id)
    await baselines.delete(root, 'baseline-a')
    expect(await git.listTags({ fs, dir: root })).toEqual([v.freeze!.tag])
  })

  it('un approuvé modifié hors interface, puis livré, ne revient pas au backlog', async () => {
    await writeReq(root, 'PR-0001', { status: 'approved' })
    await commitAll(root, 'approbation')
    await writeReq(root, 'PR-0001', { status: 'approved', title: 'Modifié à la main' })
    await commitAll(root, 'à la main')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    await commitAll(root, 'version')
    await versions.release(root, v.id, 'produit-1.0')
    expect(await backlogIds(root)).toEqual([])
    await writeReq(root, 'PR-0001', { status: 'approved', title: 'Encore' })
    expect((await versions.backlog(root))[0]).toMatchObject({ id: 'PR-0001', kind: 'modified', outside: { dirty: true } })
  })

  it('une entrée de composant orpheline se retire, et la release passe', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title: '1.0', components: { retire: 'XX-0001' } })
    await versions.include(root, v.id, ['PR-0001'])
    expect(await code(versions.release(root, v.id, 'produit-1.0'))).toBe('COMPONENT_NOT_RELEASED')
    await versions.update(root, v.id, { components: {} })
    await commitAll(root, 'version')
    expect(await code(versions.release(root, v.id, 'produit-1.0'))).toBe('ok')
  })

  it('branche avancée pendant le release : pas de tag orphelin, le nouvel essai passe', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    await commitAll(root, 'version')
    const original = sync.createAnnotatedTag.bind(sync)
    const spy = vi.spyOn(sync, 'createAnnotatedTag').mockImplementationOnce(async (...args) => {
      const out = await original(...args)
      await git.commit({ fs, dir: root, message: 'entre-temps', author: { name: 'B', email: 'b@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
      return out
    })
    await expect(versions.release(root, v.id, 'produit-1.0')).rejects.toThrow(/avancé/)
    expect(await git.listTags({ fs, dir: root })).toEqual([])
    spy.mockRestore()
    expect(await code(versions.release(root, v.id, 'produit-1.0'))).toBe('ok')
  })

  it('base recalculée au gel : V3 part de V2 livrée après son inclusion', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v2 = await versions.create(root, { title: '2.0' })
    const v3 = await versions.create(root, { title: '3.0' })
    await versions.include(root, v2.id, ['PR-0001'])
    await versions.include(root, v3.id, ['PR-0001'])
    expect((await versions.get(root, v3.id)).changes?.[0]?.base).toBeUndefined()
    await commitAll(root, 'versions')
    const r2 = await versions.release(root, v2.id, 'produit-2.0')
    const r3 = await versions.release(root, v3.id, 'produit-3.0')
    expect(r3.changes?.[0]?.base?.sha).toBe(r2.freeze!.sha)
  })

  it('freeze.at absent ou date YAML : le backlog et la création ne tombent pas', async () => {
    const v = await released('1.0')
    const other = await versions.create(root, { title: '2.0' })
    await gitSvc.writeYaml(root, `versions/${other.id}.yaml`, { ...other, status: 'released', freeze: { tag: 't', sha: v.freeze!.sha } })
    await gitSvc.writeText(root, `versions/${v.id}.yaml`, (await fsP.readFile(path.join(root, 'versions', `${v.id}.yaml`), 'utf8')).replace(/at: .*/, 'at: 2026-11-02T10:00:00Z'))
    await expect(versions.backlog(root)).resolves.toBeDefined()
    expect(await code(versions.create(root, { title: '3.0' }))).toBe('ok')
  })

  it('GH254 — type renommé : les éléments livrés ne reviennent pas au backlog', async () => {
    await writeReq(root, 'PR-0001')
    await commitAll(root, 'éléments')
    const v = await versions.create(root, { title: '1.0' })
    await versions.include(root, v.id, ['PR-0001'])
    await commitAll(root, 'version')
    await versions.release(root, v.id, 'produit-1.0')
    await writeReq(root, 'PR-0001', { objectTypeRef: 'root::exigence-bis' })
    const schema = schemas.get(path.resolve(root))!
    schemas.set(path.resolve(root), { ...schema, nodes: schema.nodes.map(n => ({ ...n, objectTypes: n.objectTypes?.map(t => t.name === 'exigence' ? { ...t, name: 'exigence-bis' } : t) })) })
    expect(await backlogIds(root)).toEqual([])
  })

  it('la page dit le tag en attente', async () => {
    const v = await released('1.0')
    expect((await versions.page(root, v.id)).tagPending).toBe(true)
    const others = await versions.create(root, { title: '2.0' })
    expect((await versions.page(root, others.id)).tagPending).toBe(false)
  })
})
