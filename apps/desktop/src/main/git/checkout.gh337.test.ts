import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, useNodeCheckout, type GitBackend } from './git-backend'
import { gitInstall } from './git-binary'
import { gitSpawnStats, gitText } from './git-runner'
import { closeAll, closeRepo } from './process-registry'

/**
 * GH337 sprint 2 — `GitBackend.checkout` : sous Windows (git ≥ 2.40), fichiers écrits par Polenta
 * (`nodeCheckout`) ; `git checkout` en repli (chemin non simple) et pour `force`. Le chemin pris se lit
 * dans les lancements de git : `nodeCheckout` lance `read-tree`, jamais `checkout`.
 */

const AUTHOR = { name: 'T', email: 't@x' }
const isWin = process.platform === 'win32'

let repo: string
let g: GitBackend

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')
const spawns = (sub: string) => gitSpawnStats.get(sub) ?? 0

async function commitAll(msg: string): Promise<string> {
  await g.addAll()
  return g.commit({ message: msg, author: AUTHOR })
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-checkout-'))
  g = gitFor(repo)
  await g.init('main')
  write('a.txt', 'main\n')
  write('c.txt', 'commun\n')
  await commitAll('base')
  await g.createBranch('b', 'HEAD')
  await g.checkout('b', { force: true })
  write('a.txt', 'b\n')
  write('new/b.txt', 'nouveau\n')
  await commitAll('b')
  await g.checkout('main', { force: true })
})

afterEach(async () => {
  await closeRepo(repo)
  fs.rmSync(repo, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('choix du chemin', () => {
  it('nodeCheckout : Windows seulement, git ≥ 2.40', () => {
    expect(useNodeCheckout('linux')).toBe(false)
    expect(useNodeCheckout('darwin')).toBe(false)
    const [maj, min] = gitInstall().version.split('.').map(Number)
    expect(useNodeCheckout('win32')).toBe(maj > 2 || (maj === 2 && min >= 40))
  })
})

describe.runIf(isWin)('Windows', () => {
  it('chemin simple : fichiers écrits par Polenta, pas de git checkout', async () => {
    const before = { checkout: spawns('checkout'), readTree: spawns('read-tree') }
    await g.checkout('b')
    expect(spawns('checkout')).toBe(before.checkout)
    expect(spawns('read-tree')).toBe(before.readTree + 1)
    expect(await g.currentBranch()).toBe('b')
    expect(read('a.txt')).toBe('b\n')
    expect(read('new/b.txt')).toBe('nouveau\n')
    expect(await g.status()).toEqual([])
  })

  it('tête détachée par nodeCheckout', async () => {
    const oid = await g.resolveOrThrow('b')
    const before = spawns('checkout')
    await g.checkout(oid, { detach: true })
    expect(spawns('checkout')).toBe(before)
    expect(await g.currentBranch()).toBeNull()
    expect(await g.resolve('HEAD')).toBe(oid)
  })

  it('repli : modification locale suivie → git checkout, qui la garde', async () => {
    write('c.txt', 'modifié localement\n')
    const before = spawns('checkout')
    await g.checkout('b')
    expect(spawns('checkout')).toBe(before + 1)
    expect(await g.currentBranch()).toBe('b')
    expect(read('a.txt')).toBe('b\n')
    expect(read('c.txt')).toBe('modifié localement\n')
  })

  it('repli : modification locale en conflit → refus de git, rien n\'est touché', async () => {
    write('a.txt', 'local\n')
    await expect(g.checkout('b')).rejects.toMatchObject({ kind: 'local-changes' })
    expect(await g.currentBranch()).toBe('main')
    expect(read('a.txt')).toBe('local\n')
  })

  it('force : git checkout direct', async () => {
    write('a.txt', 'local\n')
    const before = spawns('checkout')
    await g.checkout('b', { force: true })
    expect(spawns('checkout')).toBe(before + 1)
    expect(read('a.txt')).toBe('b\n')
    expect((await gitText(repo, ['status', '--porcelain'])).trim()).toBe('')
  })
})
