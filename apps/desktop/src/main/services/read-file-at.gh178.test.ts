import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { readFileAt } from './read-file-at.util'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'

/** GH178 — lectures à une ref (specs/GH178-tests.md, tests unitaires), sur un vrai repo temporaire. */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const auth = {} as AuthService

let repo: string
let sync: SyncService

async function write(rel: string, content: string) {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}

async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh178-'))
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  sync = new SyncService(auth)
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('readFileAt', () => {
  it('lit un fichier à un SHA, à une ref nommée et dans le working tree', async () => {
    await write('a.txt', 'v1')
    const c1 = await commitAll('c1')
    await write('a.txt', 'v2')
    await commitAll('c2')
    await write('a.txt', 'wd')

    expect(text(await readFileAt(repo, c1, 'a.txt'))).toBe('v1')
    expect(text(await readFileAt(repo, 'HEAD', 'a.txt'))).toBe('v2')
    expect(text(await readFileAt(repo, 'main', 'a.txt'))).toBe('v2')
    expect(text(await readFileAt(repo, null, 'a.txt'))).toBe('wd')
  })

  it('à une ref : accepte les mêmes écritures de chemin que le working tree, et un SHA en majuscules', async () => {
    await write('images/x.png', 'img')
    await write('..assets/f.txt', 'dots')
    const c1 = await commitAll('c1')
    expect(text(await readFileAt(repo, c1, './images/x.png'))).toBe('img')
    expect(text(await readFileAt(repo, c1, 'images/../images/x.png'))).toBe('img')
    expect(text(await readFileAt(repo, c1.toUpperCase(), 'images\\x.png'))).toBe('img')
    expect(text(await readFileAt(repo, c1, '../images/x.png'))).toBeNull()
    expect(text(await readFileAt(repo, null, '..assets/f.txt'))).toBe('dots')
    expect(text(await readFileAt(repo, c1, '..assets/f.txt'))).toBe('dots')
  })

  it('renvoie null pour un fichier absent, une ref inconnue ou un chemin hors du repo', async () => {
    await write('a.txt', 'v1')
    const c1 = await commitAll('c1')
    expect(await readFileAt(repo, c1, 'absent.txt')).toBeNull()
    expect(await readFileAt(repo, 'no-such-branch', 'a.txt')).toBeNull()
    expect(await readFileAt(repo, null, 'absent.txt')).toBeNull()
    expect(await readFileAt(repo, null, '../outside.txt')).toBeNull()
  })
})

describe('diffs : refs lues et absences', () => {
  it('diffFileBetween : refs fournies, fichier ajouté entre les deux', async () => {
    await write('keep.txt', 'k')
    const c1 = await commitAll('c1')
    await write('SYS-0002.yaml', 'id: SYS-0002\n')
    const c2 = await commitAll('c2')

    const d = await sync.diffFileBetween(repo, c1, c2, 'SYS-0002.yaml')
    expect(d).toMatchObject({ oldContent: '', newContent: 'id: SYS-0002\n', oldRef: c1, newRef: c2, oldMissing: true, newMissing: false })
  })

  it('diff (working tree) : Avant = SHA de HEAD, Après = null ; fichier supprimé du disque', async () => {
    await write('SYS-0003.yaml', 'id: SYS-0003\n')
    const c1 = await commitAll('c1')
    await fsP.rm(path.join(repo, 'SYS-0003.yaml'))

    const d = await sync.diff(repo, 'SYS-0003.yaml')
    expect(d).toMatchObject({ oldRef: c1, newRef: null, oldMissing: false, newMissing: true, newContent: '' })
  })

  it('commitDiff : Avant = parent ; commit initial = côté Avant absent', async () => {
    await write('a.txt', 'v1')
    const c1 = await commitAll('c1')
    await write('a.txt', 'v2')
    const c2 = await commitAll('c2')

    expect(await sync.commitDiff(repo, c2, 'a.txt')).toMatchObject({ oldContent: 'v1', newContent: 'v2', oldRef: c1, newRef: c2 })
    expect(await sync.commitDiff(repo, c1, 'a.txt')).toMatchObject({ oldRef: null, newRef: c1, oldMissing: true, newMissing: false })
  })
})

describe('SchemaService.getAt', () => {
  const schemaYaml = (label: string) =>
    `version: 1\nroles: [moteur]\nnodes:\n  - name: root\n    label: ${label}\n    objectTypes: []\nlinkTypes: []\n`

  it('lit le schéma à la ref (et non celui du disque), avec la migration roles/implements', async () => {
    await write('.polenta/schema.yaml', schemaYaml('Avant'))
    const c1 = await commitAll('c1')
    await write('.polenta/schema.yaml', schemaYaml('Après'))
    await commitAll('c2')

    const schema = new SchemaService(auth)
    const at = await schema.getAt(repo, c1)
    expect(at?.nodes[0].label).toBe('Avant')
    expect(at?.nodes[0].roles).toEqual(['moteur'])
    expect((await schema.getAt(repo, 'HEAD'))?.nodes[0].label).toBe('Après')
  })

  it('renvoie null quand le schéma n’existe pas à la ref', async () => {
    await write('a.txt', 'x')
    const c1 = await commitAll('c1')
    expect(await new SchemaService(auth).getAt(repo, c1)).toBeNull()
  })
})
