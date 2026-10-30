import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRegion } from '@polenta/merge-core'

import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'

/** GH222 — session de résolution sur le moteur générique (specs/GH222-tests.md M25), vrai repo. */

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

const schema = (labels: { priority: string }, statuses: string[]) => dump({
  version: 1,
  nodes: [{
    name: 'root',
    objectTypes: [{
      name: 'exigence-systeme',
      prefix: 'SYS',
      fields: [{ name: 'priority', label: labels.priority, type: 'enum' }],
      statuses: statuses.map(name => ({ name })),
    }],
  }],
})
const dashboard = (title: string) => dump({ id: 'd1', title, widgets: [{ id: 'w1', title: 'A' }] })

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh222-'))
  userData = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh222-ud-'))
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  const sync = new SyncService(auth)
  service = new MergeResolutionService(userData, auth, sync, new SchemaService(auth))

  await write('.polenta/schema.yaml', schema({ priority: 'Priorité' }, ['draft']))
  await write('dashboards/d1/dashboard.yaml', dashboard('Base'))
  await commitAll('base')
  await git.branch({ fs, dir: repo, ref: 'dev' })

  // main (destination): field label changed, dashboard title changed.
  await write('.polenta/schema.yaml', schema({ priority: 'Priorité métier' }, ['draft']))
  await write('dashboards/d1/dashboard.yaml', dashboard('Droite'))
  await commitAll('right')

  // dev (mine): status added, dashboard title changed differently.
  await git.checkout({ fs, dir: repo, ref: 'dev' })
  await write('.polenta/schema.yaml', schema({ priority: 'Priorité' }, ['draft', 'obsolete']))
  await write('dashboards/d1/dashboard.yaml', dashboard('Gauche'))
  await commitAll('left')
  await git.checkout({ fs, dir: repo, ref: 'main' })
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
  await fsP.rm(userData, { recursive: true, force: true })
})

describe('MergeResolutionService — YAML générique', () => {
  it('M25 — schema.yaml changed on distinct elements is not in conflict; a dashboard is, as yaml', async () => {
    const session = await service.open(repo, 'dev', 'main', { kind: 'merge', from: 'dev', into: 'main' })
    expect(session.files.map(f => [f.path, f.kind, f.counts])).toEqual([
      ['dashboards/d1/dashboard.yaml', 'yaml', { conflicts: 1, auto: 0 }],
    ])
  })

  it('finalizing writes the merged schema and the resolved dashboard canonically', async () => {
    const session = await service.open(repo, 'dev', 'main', { kind: 'merge', from: 'dev', into: 'main' })
    const file = await service.getFile(session.id, 'dashboards/d1/dashboard.yaml')
    expect(file.blocks.map(b => b.key)).toEqual(['/title'])
    const text = resolveRegion(file.initialOutput!, '/title', 'left')
    expect((await service.validate(session.id, file.path, text)).errors).toEqual([])
    await service.saveFile(session.id, file.path, { state: 'merged', text })

    const res = await service.finalize(session.id)
    expect(res.ok).toBe(true)
    const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')
    expect(await read('dashboards/d1/dashboard.yaml')).toBe(dashboard('Gauche'))
    expect(await read('.polenta/schema.yaml')).toBe(schema({ priority: 'Priorité métier' }, ['draft', 'obsolete']))
  })
})
