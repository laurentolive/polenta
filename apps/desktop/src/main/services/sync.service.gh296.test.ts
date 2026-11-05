import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'

/**
 * GH296 — fichiers suivis qui ne diffèrent de HEAD que par les fins de ligne (`core.autocrlf` hors de
 * `.git/config`, invisible d'isomorphic-git). Vérifie le symptôme sur tous les usages du statut.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const LF = 'a: 1\nb: 2\n'
const CRLF = 'a: 1\r\nb: 2\r\n'

let repo: string
let sync: SyncService

const abs = (rel: string) => path.join(repo, rel)
const write = (rel: string, content: string | Buffer) => fsP.writeFile(abs(rel), content)
const paths = (files: { path: string }[]) => files.map(f => f.path).sort()

async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

async function committedText(rel: string) {
  const oid = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
  const { blob } = await git.readBlob({ fs, dir: repo, oid, filepath: rel })
  return Buffer.from(blob).toString('latin1')
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh296-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  await write('lf.yaml', LF)
  await write('other.yaml', LF)
  await write('crlf-in-git.js', CRLF)
  await commitAll('base')
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('GH296 — statut', () => {
  it('un fichier LF dans git, CRLF sur le disque, n\'est pas modifié', async () => {
    await write('lf.yaml', CRLF)
    const status = await sync.status(repo)
    expect(status.unstaged).toEqual([])
    expect(status.staged).toEqual([])
  })

  it('un fichier CRLF dans git, LF sur le disque, n\'est pas modifié', async () => {
    await write('crlf-in-git.js', LF)
    expect((await sync.status(repo)).unstaged).toEqual([])
  })

  it('un vrai changement reste signalé, même en CRLF', async () => {
    await write('lf.yaml', 'a: 1\r\nb: 3\r\n')
    await write('other.yaml', CRLF)
    expect((await sync.status(repo)).unstaged).toEqual([{ path: 'lf.yaml', marker: 'M' }])
  })

  it('un binaire reste comparé à l\'octet près', async () => {
    await write('bin.dat', Buffer.from([0, 1, 10, 2]))
    await commitAll('binaire')
    await write('bin.dat', Buffer.from([0, 1, 13, 10, 2]))
    expect(paths((await sync.status(repo)).unstaged)).toEqual(['bin.dat'])
  })

  it('un fichier ajouté ou supprimé reste signalé', async () => {
    await write('new.yaml', CRLF)
    await fsP.rm(abs('other.yaml'))
    await write('lf.yaml', CRLF)
    expect(paths((await sync.status(repo)).unstaged)).toEqual(['new.yaml', 'other.yaml'])
  })

  it('modifications locales (T175) : même règle', async () => {
    await write('lf.yaml', CRLF)
    await write('other.yaml', 'x\r\n')
    expect(await sync.workdirChangesVsHead(repo, ['.'])).toEqual([{ path: 'other.yaml', change: 'modified' }])
  })
})

describe('GH296 — stage et commit', () => {
  it('stager un vrai changement n\'écrit pas de CRLF dans git', async () => {
    await write('lf.yaml', 'a: 1\r\nb: 3\r\n')
    await sync.stage(repo, 'lf.yaml')
    expect(paths((await sync.status(repo)).staged)).toEqual(['lf.yaml'])
    await sync.commit(repo, 'vrai changement')
    expect(await committedText('lf.yaml')).toBe('a: 1\nb: 3\n')
    expect((await sync.status(repo)).unstaged).toEqual([])
  })

  it('« Tout stager » ignore les faux changements et garde les vrais', async () => {
    await write('lf.yaml', CRLF)
    await write('other.yaml', 'a: 9\r\n')
    await write('new.yaml', 'n\n')
    await write('crlf-in-git.js', 'x\r\n')
    await sync.stageAll(repo)
    const { staged, unstaged } = await sync.status(repo)
    expect(paths(staged)).toEqual(['crlf-in-git.js', 'new.yaml', 'other.yaml'])
    expect(unstaged).toEqual([])
    await sync.commit(repo, 'tout')
    expect(await committedText('lf.yaml')).toBe(LF)
    expect(await committedText('other.yaml')).toBe('a: 9\n')
    // Un fichier déjà en CRLF dans git garde son style.
    expect(await committedText('crlf-in-git.js')).toBe('x\r\n')
  })

  it('« Tout stager » stage aussi une suppression', async () => {
    await fsP.rm(abs('other.yaml'))
    await sync.stageAll(repo)
    expect((await sync.status(repo)).staged).toEqual([{ path: 'other.yaml', marker: 'D' }])
  })

  it('« Tout annuler » laisse les faux changements et restaure les vrais', async () => {
    await write('lf.yaml', CRLF)
    await write('other.yaml', 'x\n')
    await sync.discardAll(repo)
    expect(await fsP.readFile(abs('lf.yaml'), 'utf8')).toBe(CRLF)
    expect(await fsP.readFile(abs('other.yaml'), 'utf8')).toBe(LF)
  })
})

describe('GH296 — gardes', () => {
  beforeEach(() => git.addRemote({ fs, dir: repo, remote: 'origin', url: 'https://example.invalid/r.git' }))

  it('une dev-auto sans vrai changement revient sur l\'intégration', async () => {
    await git.branch({ fs, dir: repo, ref: 'dev-auto', checkout: true })
    await write('lf.yaml', CRLF)
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'returned', branch: 'dev-auto' })
    expect(await git.currentBranch({ fs, dir: repo })).toBe('main')
  })

  it('un faux changement sur l\'intégration ne crée pas de dev-auto', async () => {
    await write('lf.yaml', CRLF)
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await git.currentBranch({ fs, dir: repo })).toBe('main')
  })
})
