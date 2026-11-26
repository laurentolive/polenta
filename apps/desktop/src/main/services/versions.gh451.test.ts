import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { TestRepo } from '../git/test-repo.test-util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import type { AuthService } from './auth.service'
import { VersionTrackingService } from './version-tracking.service'
import { VersionsService } from './versions.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH451 — « Basée sur » accepte une version en cours (specs/GH451-tests.md U1–U11).

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
const SCHEMA = {
  version: 1, linkTypes: [],
  nodes: [{ name: 'root', label: 'Produit', objectTypes: [type('exigence', 'PR', 'requirement'), type('version', 'PV', 'version')] }],
} as unknown as ProjectSchema

const auth = {
  getAuthor: async () => ({ name: 'Alice', email: 'a@x' }),
  getHttpsCredentials: async () => null,
} as unknown as AuthService

let ws: string
let root: string
let gitSvc: GitService
let versions: VersionsService
let tick = 0
const T0 = Date.UTC(2026, 10, 1) / 1000

async function commitAll(message: string) {
  await new TestRepo(root).commitAll(message, { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick })
}
const writeReq = (id: string) => gitSvc.writeYaml(root, `requirements/${id}.yaml`, {
  id, projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: `Titre ${id}`, status: 'draft', version: 1, fields: {},
})
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])
const message = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message)
const create = (title: string, basedOn?: string | null) => versions.create(root, { title, ...(basedOn !== undefined && { basedOn }) })
const abandon = (id: string) => versions.update(root, id, { status: 'abandonnee' })
const optionIds = async (id: string) => (await versions.page(root, id)).basedOnOptions.map(v => v.id)

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh451-'))
  root = path.join(ws, 'produit')
  gitSvc = new GitService()
  await fsP.mkdir(root, { recursive: true })
  await TestRepo.init(root, 'main')
  await gitSvc.writeYaml(root, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  const schemaStub = { get: async () => SCHEMA, getAt: async () => SCHEMA } as unknown as SchemaService
  const treeStub = { readCache: async () => null } as unknown as WorkspaceTreeService
  versions = new VersionsService(gitSvc, new SyncService(auth), schemaStub, new VersionTrackingService(gitSvc, schemaStub), undefined, treeStub)
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('choix de la base', () => {
  it('U1 — une version en cours peut servir de base à la création', async () => {
    const v1 = await create('Proto V1')
    const v2 = await create('Proto V2', v1.id)
    expect(v2.basedOn).toBe(v1.id)
    expect((await versions.page(root, v2.id)).basedOn?.id).toBe(v1.id)
  })

  it('U2 — défaut inchangé : sans release, pas de base', async () => {
    await create('Proto V1')
    expect((await create('Proto V2')).basedOn).toBeUndefined()
  })

  it('U3 — options : ni elle-même, ni ses descendantes, ni les abandonnées ; en cours proposées', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    await create('V3', v2.id)
    const v4 = await create('V4')
    await abandon(v4.id)
    const v5 = await create('V5')
    expect(await optionIds(v1.id)).toEqual([v5.id])
    // V2 : V1 (sa base) et V5, plus récente d'abord ; ni V3 (descendante) ni V4.
    expect(await optionIds(v2.id)).toEqual([v5.id, v1.id])
    expect((await versions.page(root, v2.id)).basedOnOptions.every(v => v.state === 'in_progress')).toBe(true)
  })

  it('U4 — boucle refusée (descendante ou elle-même)', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    const v3 = await create('V3', v2.id)
    expect(await message(versions.update(root, v1.id, { basedOn: v3.id }))).toMatch(/^VERSION_NOT_FOUND.*boucle/)
    expect(await message(versions.update(root, v1.id, { basedOn: v1.id }))).toMatch(/^VERSION_NOT_FOUND.*boucle/)
    // Rebaser V3 sur V1 (ancêtre, pas descendante) reste possible.
    expect((await versions.update(root, v3.id, { basedOn: v1.id })).basedOn).toBe(v1.id)
  })

  it('U5 — base abandonnée refusée', async () => {
    const v4 = await create('V4')
    await abandon(v4.id)
    const v5 = await create('V5')
    expect(await message(versions.update(root, v5.id, { basedOn: v4.id }))).toMatch(/^VERSION_NOT_FOUND.*abandonnée/)
    expect(await code(create('V6', v4.id))).toBe('VERSION_NOT_FOUND')
  })

  it('U6 — base devenue abandonnée : gardée à l’enregistrement et en tête des options', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    const v3 = await create('V3')
    await abandon(v1.id)
    const updated = await versions.update(root, v2.id, { title: 'V2 bis', basedOn: v1.id })
    expect(updated.title).toBe('V2 bis')
    expect(updated.basedOn).toBe(v1.id)
    expect(await optionIds(v2.id)).toEqual([v1.id, v3.id])
  })
})

describe('passage released', () => {
  it('U7 — base en cours : BASE_NOT_RELEASED à l’aperçu et à l’action', async () => {
    const v1 = await create('Proto V1')
    const v2 = await create('Proto V2', v1.id)
    const problems = (await versions.releasePreview(root, v2.id)).problems
    expect(problems).toEqual([{ code: 'BASE_NOT_RELEASED', detail: `${v1.id} Proto V1` }])
    expect(await code(versions.release(root, v2.id, 'p-v2'))).toBe('BASE_NOT_RELEASED')
  })

  it('U8 — base released, puis base abandonnée : plus de refus', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    await versions.release(root, v1.id, 'p-v1')
    expect((await versions.releasePreview(root, v2.id)).problems).toEqual([])

    // V4 → V3 abandonnée → V1 released : la lignée n'a plus de version en cours.
    const v3 = await create('V3', v1.id)
    const v4 = await create('V4', v3.id)
    await abandon(v3.id)
    expect((await versions.releasePreview(root, v4.id)).problems).toEqual([])
    expect((await versions.release(root, v4.id, 'p-v4')).freeze?.tag).toBe('p-v4')
  })
})

describe('passage released — lignée', () => {
  it('U7b — version en cours derrière une base abandonnée : BASE_NOT_RELEASED sur celle-ci', async () => {
    const v0 = await create('V0')
    const v1 = await create('V1', v0.id)
    const v2 = await create('V2', v1.id)
    await abandon(v1.id)
    expect((await versions.releasePreview(root, v2.id)).problems).toEqual([{ code: 'BASE_NOT_RELEASED', detail: `${v0.id} V0` }])
  })
})

describe('suppression — base figée', () => {
  it('U9b — base d’une version abandonnée : suppression toujours refusée (historique gardé)', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    await abandon(v2.id)
    expect(await message(versions.delete(root, v1.id))).toMatch(new RegExp(`^VERSION_IS_BASE.*${v2.id}`))
  })
})

describe('suppression', () => {
  it('U9 — une version qui sert de base n’est pas supprimable', async () => {
    const v1 = await create('V1')
    const v2 = await create('V2', v1.id)
    expect(await message(versions.delete(root, v1.id))).toMatch(new RegExp(`^VERSION_IS_BASE.*${v2.id} V2`))
    await versions.update(root, v2.id, { basedOn: null })
    expect(await code(versions.delete(root, v1.id))).toBe('ok')
  })
})

describe('lignée planifiée', () => {
  it('U10 — exigences d’une version en cours : sa lignée en cours comprise, sauf abandonnée', async () => {
    for (const id of ['PR-0001', 'PR-0002', 'PR-0003']) await writeReq(id)
    await commitAll('exigences')
    const v1 = await create('V1')
    await versions.include(root, v1.id, ['PR-0001', 'PR-0002'])
    const v2 = await create('V2', v1.id)
    await versions.include(root, v2.id, ['PR-0003'])
    const reqs = async () => (await versions.perimeterOf(root, await versions.get(root, v2.id))).requirements.map(r => r.state.id).sort()
    expect(await reqs()).toEqual(['PR-0001', 'PR-0002', 'PR-0003'])
    await abandon(v1.id)
    expect(await reqs()).toEqual(['PR-0003'])
  })

  it('U11 — release basée sur une release : base proposée et lignée inchangées', async () => {
    const v1 = await versions.release(root, (await create('1.0')).id, 'p-1.0')
    const v2 = await create('1.1')
    expect(v2.basedOn).toBe(v1.id)
    expect(await optionIds(v2.id)).toEqual([v1.id])
    expect((await versions.releasePreview(root, v2.id)).problems).toEqual([])
  })
})
