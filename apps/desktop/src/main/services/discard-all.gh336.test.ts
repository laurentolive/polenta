import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'

/** GH336 — « Annuler tout » en une passe (plusieurs minutes auparavant sur quelques centaines de fichiers). */

const AUTHOR = { name: 'Testeur', email: 't@x' }
let repo: string
let sync: SyncService

const write = async (rel: string, content: string) => {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')
const exists = (rel: string) => fsP.stat(path.join(repo, rel)).then(() => true, () => false)
const clean = async () => {
  const s = await sync.status(repo)
  return s.staged.length + s.unstaged.length === 0
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-discard-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  for (const f of ['a.yaml', 'b.yaml', 'c.yaml', 'd/e.yaml']) await write(f, `${f}: 0\n`)
  await write('.gitignore', '*.pref\n')
  await git.add({ fs, dir: repo, filepath: '.' })
  await git.commit({ fs, dir: repo, message: 'base', author: AUTHOR })
})
afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

describe('GH336 — discardAll', () => {
  it('modifié, modifié stagé, supprimé, ajouté stagé, non suivi : tout revient à HEAD ; ignoré intact', async () => {
    await write('a.yaml', 'a: local\n')
    await write('b.yaml', 'b: staged\n')
    await git.add({ fs, dir: repo, filepath: 'b.yaml' })
    await fsP.rm(path.join(repo, 'c.yaml'))
    await git.remove({ fs, dir: repo, filepath: 'd/e.yaml' })
    await write('new-staged.yaml', 'n: 1\n')
    await git.add({ fs, dir: repo, filepath: 'new-staged.yaml' })
    await write('new/untracked.yaml', 'u: 1\n')
    await write('.me.pref', 'pref: 1\n')

    await sync.discardAll(repo)

    expect(await read('a.yaml')).toBe('a.yaml: 0\n')
    expect(await read('b.yaml')).toBe('b.yaml: 0\n')
    expect(await read('c.yaml')).toBe('c.yaml: 0\n')
    expect(await read('d/e.yaml')).toBe('d/e.yaml: 0\n')
    expect(await exists('new-staged.yaml')).toBe(false)
    expect(await exists('new/untracked.yaml')).toBe(false)
    expect(await read('.me.pref')).toBe('pref: 1\n')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('main')
    expect(await clean()).toBe(true)
  })

  it('500 fichiers indexés comme sur une autre branche (checkout interrompu) : rapide, repo propre', async () => {
    const files = Array.from({ length: 500 }, (_, i) => `r/f${i}.yaml`)
    await Promise.all(files.map(f => write(f, 'x: 1\n')))
    await git.add({ fs, dir: repo, filepath: 'r' })
    await git.remove({ fs, dir: repo, filepath: 'a.yaml' })
    await fsP.rm(path.join(repo, 'a.yaml'))

    const start = Date.now()
    await sync.discardAll(repo)
    const elapsed = Date.now() - start

    expect(await exists('r/f0.yaml')).toBe(false)
    expect(await read('a.yaml')).toBe('a.yaml: 0\n')
    expect(await clean()).toBe(true)
    expect(elapsed).toBeLessThan(15_000)
  }, 60_000)
})
