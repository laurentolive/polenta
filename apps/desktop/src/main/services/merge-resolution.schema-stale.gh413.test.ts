import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProjectSchema } from '@polenta/types'
import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'

/**
 * GH413 — après un merge qui amène un changement de libellé (schéma) et une modification
 * d'exigence, la vue exigence doit voir les libellés à jour sans redémarrer.
 *
 * Reproduction : le SchemaService est lu une fois (la vue est ouverte, cache rempli), puis le
 * merge est finalisé (ref déplacée, répertoire de travail réécrit). Sans invalidation explicite
 * après l'écriture de l'arbre, le schéma relu reste l'ancien : c'est ce que voit la vue.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const auth = { getAuthor: async () => AUTHOR } as unknown as AuthService
const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })

let repo: string
let userData: string
let schema: SchemaService
let merges: MergeResolutionService

const FILE = 'requirements/WASHER_REQ-0245.yaml'

const schemaWithLabel = (label: string) => dump({
  version: 1,
  nodes: [{
    name: 'root',
    objectTypes: [{
      name: 'WASHER_REQ',
      prefix: 'WASHER_REQ',
      label: 'Exigence',
      fields: [{ name: 'main_item', label, type: 'enum', values: ['Performances produit', 'Spécifications produit'] }],
      statuses: [{ name: 'draft' }],
    }],
  }],
})
const req = (description: string) => dump({
  id: 'WASHER_REQ-0245', projectId: '', branchId: '', objectTypeRef: 'root::WASHER_REQ',
  title: 'Poids du produit', status: 'draft', version: 1, fields: { description, main_item: 'Performances produit' },
})

async function write(rel: string, content: string) {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}
async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh413-schema-'))
  userData = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh413-schema-ud-'))
  await git.init({ fs, dir: repo, defaultBranch: 'int' })

  // Base commune : ancien libellé, exigence d'origine, un fichier annexe pour un vrai merge à 3 voies.
  await write('.polenta/schema.yaml', schemaWithLabel('Priorité ancienne'))
  await write(FILE, req('Ancien énoncé'))
  await write('notes.txt', 'base')
  await commitAll('base')
  await git.branch({ fs, dir: repo, ref: 'remote' })

  // Intégration distante : nouveau libellé + description modifiée.
  await git.checkout({ fs, dir: repo, ref: 'remote' })
  await write('.polenta/schema.yaml', schemaWithLabel('Priorité nouvelle'))
  await write(FILE, req('Nouvel énoncé'))
  await commitAll('remote : libellé + description')

  // Ma branche locale : seulement une modification sans rapport.
  await git.checkout({ fs, dir: repo, ref: 'int' })
  await write('notes.txt', 'local')
  await commitAll('local')

  schema = new SchemaService(auth)
  merges = new MergeResolutionService(userData, auth, new SyncService(auth), schema)
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
  await fsP.rm(userData, { recursive: true, force: true })
})

const mainLabel = (s: ProjectSchema) =>
  s.nodes?.[0]?.objectTypes?.[0]?.fields?.find(f => f.name === 'main_item')?.label

describe('GH413 — libellés du schéma après un merge', () => {
  it('la vue voit le libellé mergé sans redémarrer (schéma déjà lu avant le merge)', async () => {
    // La vue exigence est ouverte : le schéma est lu et mis en cache.
    expect(mainLabel(await schema.get(repo))).toBe('Priorité ancienne')

    // Merge de l'intégration distante dans la branche locale, finalisé comme depuis l'UI.
    // Pas de conflit attendu : la finalisation n'a rien à résoudre.
    const session = await merges.open(repo, 'int', 'remote', { kind: 'pull', branch: 'int', remoteRef: 'remote' })
    expect(session.files).toEqual([])
    const res = await merges.finalize(session.id)
    expect(res.ok).toBe(true)

    // Le fichier sur disque est bien le nouveau…
    const onDisk = await fsP.readFile(path.join(repo, '.polenta', 'schema.yaml'), 'utf-8')
    expect(onDisk).toContain('Priorité nouvelle')

    // …et le schéma servi à la vue doit suivre, sans invalidation manuelle.
    expect(mainLabel(await schema.get(repo))).toBe('Priorité nouvelle')
  })
})


describe('GH413 — cache du schéma validé contre le fichier', () => {
  it('une écriture directe de schema.yaml (sans watcher) est vue au get suivant', async () => {
    expect(mainLabel(await schema.get(repo))).toBe('Priorité ancienne')
    await fsP.writeFile(path.join(repo, '.polenta', 'schema.yaml'), schemaWithLabel('Priorité directe'))
    expect(mainLabel(await schema.get(repo))).toBe('Priorité directe')
  })
})
