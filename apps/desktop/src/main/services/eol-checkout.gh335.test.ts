import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'
import { eolAwareStatusMatrix } from './eol-status.util'

/**
 * GH335 — checkout bloqué par des fichiers qui ne diffèrent de HEAD que par les fins de ligne
 * (CRLF sur le disque après un checkout natif avec `core.autocrlf=true` système, LF dans git).
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let repo: string
let sync: SyncService

const write = (rel: string, content: string) => fsP.writeFile(path.join(repo, rel), content)
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')

async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh335-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  await write('tree.yaml', 'a: 1\nb: 1\n')
  await write('other.yaml', 'x: 1\n')
  await commitAll('base')
  await git.branch({ fs, dir: repo, ref: 'int-tmp' })
  await git.checkout({ fs, dir: repo, ref: 'int-tmp' })
  await write('tree.yaml', 'a: 2\nb: 2\n')
  await commitAll('int-tmp')
  await git.checkout({ fs, dir: repo, ref: 'main' })
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('GH335 — checkout et fins de ligne', () => {
  it('reproduit le blocage : isomorphic-git seul refuse le checkout', async () => {
    await write('tree.yaml', 'a: 1\r\nb: 1\r\n')
    await expect(git.checkout({ fs, dir: repo, ref: 'int-tmp' }))
      .rejects.toBeInstanceOf(git.Errors.CheckoutConflictError)
  })

  it('un fichier en CRLF sur le disque (LF dans git) ne bloque pas « Checkout branche »', async () => {
    await write('tree.yaml', 'a: 1\r\nb: 1\r\n')
    await write('other.yaml', 'x: 1\r\n') // inchangé entre les branches : ne gêne pas non plus
    expect((await sync.status(repo)).unstaged).toEqual([])

    const result = await sync.checkoutBranch(repo, 'int-tmp')

    expect(result.branch).toBe('int-tmp')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-tmp')
    expect(await read('tree.yaml')).toBe('a: 2\nb: 2\n')
    const status = await sync.status(repo)
    expect(status.staged.length + status.unstaged.length).toBe(0)
  })

  it('une vraie modification locale bloque toujours, et rien n\'est réécrit', async () => {
    await write('tree.yaml', 'a: local\r\nb: 1\r\n')
    await expect(sync.checkoutBranch(repo, 'int-tmp')).rejects.toThrow(/tree.yaml : modifié/)
    expect(await git.currentBranch({ fs, dir: repo })).toBe('main')
    expect(await read('tree.yaml')).toBe('a: local\r\nb: 1\r\n')
  })
})

describe('GH335 — file du verrou packed-refs', () => {
  it('statut d\'un repo entièrement en CRLF (> 1000 fichiers) : pas de « Too many pending tasks »', async () => {
    const files = Array.from({ length: 1100 }, (_, i) => `r/f${i}.yaml`)
    await fsP.mkdir(path.join(repo, 'r'))
    await Promise.all(files.map(f => write(f, 'a: 1\nb: 1\n')))
    await commitAll('many')
    await Promise.all(files.map(f => write(f, 'a: 1\r\nb: 1\r\n')))

    const rows = await eolAwareStatusMatrix(repo)
    expect(rows.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1))).toEqual([])
  }, 60_000)
})
