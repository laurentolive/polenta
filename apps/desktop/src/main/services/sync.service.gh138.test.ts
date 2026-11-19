import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'
import { TestRepo } from '../git/test-repo.test-util'

/** GH138 — checkout de l'étiquette distante `origin/<branche>` : la branche locale, jamais un HEAD détaché. */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let tmp: string
let repo: string
let sync: SyncService

const r = () => new TestRepo(repo)

async function commit(file: string, content: string, message: string) {
  await fsP.writeFile(path.join(repo, file), content)
  await r().add([file])
  return r().commit(message, AUTHOR)
}

/** Simule un fetch : `refs/remotes/origin/<branch>` pointe sur `oid`. */
async function setRemoteRef(branch: string, oid: string) {
  await r().git.updateRefs([{ ref: `refs/remotes/origin/${branch}`, newOid: oid }])
}

const head = () => r().currentBranch()
const oidOf = (ref: string) => r().resolve(ref)

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh138-'))
  repo = path.join(tmp, 'repo')
  await fsP.mkdir(repo)
  sync = new SyncService({ getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService)
  await TestRepo.init(repo, 'main')
  await r().addRemote('origin', 'https://forge.invalid/r.git')
  await commit('a.txt', 'a', 'init')
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('GH138 — checkoutBranch sur origin/<branche>', () => {
  it('branche locale absente : créée sur origin/<branche>, avec son amont, et checkoutée', async () => {
    await r().checkout('toolTest', { create: true })
    const tip = await commit('b.txt', 'b', 'outil')
    await setRemoteRef('toolTest', tip)
    await r().checkout('main')
    await r().deleteBranch('toolTest')

    const result = await sync.checkoutBranch(repo, 'origin/toolTest')

    expect(result).toEqual({ branch: 'toolTest', remote: 'created', remoteRef: 'origin/toolTest' })
    expect(await head()).toBe('toolTest')
    expect(await oidOf('refs/heads/toolTest')).toBe(tip)
    expect(await r().git.config('branch.toolTest.remote')).toBe('origin')
    expect(await r().git.config('branch.toolTest.merge')).toBe('refs/heads/toolTest')
    expect(await fsP.readFile(path.join(repo, 'b.txt'), 'utf8')).toBe('b')
  })

  it('locale en retard : bascule dessus sans la déplacer, état « behind »', async () => {
    const base = await oidOf('main')
    await r().branch('toolTest')
    const ahead = await commit('b.txt', 'b', 'sur main')
    await setRemoteRef('toolTest', ahead)

    const result = await sync.checkoutBranch(repo, 'origin/toolTest')

    expect(result.remote).toBe('behind')
    expect(await head()).toBe('toolTest')
    expect(await oidOf('refs/heads/toolTest')).toBe(base)
  })

  it('locale et distante divergées : bascule sur la locale, rien n\'est écrasé, état « diverged »', async () => {
    await r().checkout('toolTest', { create: true })
    const local = await commit('l.txt', 'l', 'local')
    await r().checkout('main')
    const remote = await commit('r.txt', 'r', 'distant')
    await setRemoteRef('toolTest', remote)

    const result = await sync.checkoutBranch(repo, 'origin/toolTest')

    expect(result.remote).toBe('diverged')
    expect(await head()).toBe('toolTest')
    expect(await oidOf('refs/heads/toolTest')).toBe(local)
  })

  it('locale à jour : état « up-to-date »', async () => {
    await r().branch('toolTest')
    await setRemoteRef('toolTest', await oidOf('main'))
    expect((await sync.checkoutBranch(repo, 'origin/toolTest')).remote).toBe('up-to-date')
    expect(await head()).toBe('toolTest')
  })

  it('branche locale ordinaire (y compris un nom avec « / ») : inchangé', async () => {
    await r().branch('feature/x')
    expect(await sync.checkoutBranch(repo, 'feature/x')).toEqual({ branch: 'feature/x' })
    expect(await head()).toBe('feature/x')
  })
})
