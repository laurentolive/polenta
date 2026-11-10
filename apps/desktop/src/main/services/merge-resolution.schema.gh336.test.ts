import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'

/**
 * Cas client (PH2, merge int-PH2 ← origin/int-PH2) : la destination a ajouté des statuts au type
 * (schema.yaml fusionné sans conflit), le disque porte encore l'ancien schéma. « Tout prendre à
 * droite » ne doit pas finir en « Statut inconnu pour ce type » : la validation suit le schéma du
 * résultat, pas celui du disque.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const auth = { getAuthor: async () => AUTHOR } as unknown as AuthService
const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })

let repo: string
let userData: string
let service: MergeResolutionService

async function write(rel: string, content: string) {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}
async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

const schema = (statuses: string[]) => dump({
  version: 1,
  nodes: [{ name: 'root', objectTypes: [{ name: 'PRODUCT_REQ', prefix: 'PRODUCT_REQ', statuses: statuses.map(name => ({ name })) }] }],
})
const req = (status: string, title: string) => dump({
  id: 'PRODUCT_REQ-0181', projectId: '', branchId: '', objectTypeRef: 'root::PRODUCT_REQ', title, status, version: 1, fields: {},
})
const FILE = 'requirements/PRODUCT_REQ-0181.yaml'

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-merge-'))
  userData = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-merge-ud-'))
  await git.init({ fs, dir: repo, defaultBranch: 'int-PH2' })
  service = new MergeResolutionService(userData, auth, new SyncService(auth), new SchemaService(auth))

  await write('.polenta/schema.yaml', schema(['draft']))
  await commitAll('base')
  await git.branch({ fs, dir: repo, ref: 'remote' })

  // Destination (origin/int-PH2) : nouveaux statuts, exigence créée avec l'un d'eux.
  await git.checkout({ fs, dir: repo, ref: 'remote' })
  await write('.polenta/schema.yaml', schema(['draft', 'A intégrer']))
  await write(FILE, req('A intégrer', 'Distant'))
  await commitAll('remote')

  // Mes modifications (int-PH2 local, checkouté) : ancien schéma, même ID créé localement.
  await git.checkout({ fs, dir: repo, ref: 'int-PH2' })
  await write(FILE, req('draft', 'Local'))
  await commitAll('local')
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
  await fsP.rm(userData, { recursive: true, force: true })
})

describe('GH336 — validation d\'un merge contre le schéma du résultat', () => {
  it('un statut ajouté par la destination est valide (absent du schéma du disque)', async () => {
    const session = await service.open(repo, 'int-PH2', 'remote', { kind: 'pull', branch: 'int-PH2', remoteRef: 'remote' })
    expect(session.files.map(f => f.path)).toEqual([FILE])
    const v = await service.validate(session.id, FILE, req('A intégrer', 'Distant'))
    expect(v.errors).toEqual([])
  })

  it('un statut inconnu des deux côtés reste une erreur', async () => {
    const session = await service.open(repo, 'int-PH2', 'remote', { kind: 'pull', branch: 'int-PH2', remoteRef: 'remote' })
    const v = await service.validate(session.id, FILE, req('Inventé', 'Distant'))
    expect(v.errors).toEqual([{ code: 'unknownStatus', params: { status: 'Inventé' } }])
  })
})
