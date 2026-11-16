import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'

/** GH367 — `listBranches` inclut les branches présentes seulement sur `origin` : un autre utilisateur
 *  n'a en local que la branche du clone, et ne voyait donc jamais les autres `int-*` du serveur. */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let tmp: string
let repo: string
let sync: SyncService
let tip: string

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh367-'))
  repo = path.join(tmp, 'repo')
  await fsP.mkdir(repo)
  sync = new SyncService({ getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'int-A' })
  await git.addRemote({ fs, dir: repo, remote: 'origin', url: 'https://forge.invalid/r.git' })
  await fsP.writeFile(path.join(repo, 'a.txt'), 'a')
  await git.add({ fs, dir: repo, filepath: 'a.txt' })
  tip = await git.commit({ fs, dir: repo, message: 'init', author: AUTHOR })
  // Ce que laisse un clone suivi d'un fetch : int-A locale, int-B et int-C seulement sur origin.
  for (const b of ['HEAD', 'int-A', 'int-C', 'int-B']) {
    await git.writeRef({ fs, dir: repo, ref: `refs/remotes/origin/${b}`, value: tip, force: true })
  }
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('GH367 — listBranches', () => {
  it('branches locales, puis branches seulement sur origin (triées, sans HEAD ni doublon)', async () => {
    expect(await sync.listBranches(repo)).toEqual([
      { name: 'int-A', isCurrent: true, type: 'int' },
      { name: 'int-B', isCurrent: false, type: 'int', remoteOnly: true },
      { name: 'int-C', isCurrent: false, type: 'int', remoteOnly: true },
    ])
  })

  it('checkout de origin/int-B (choix dans la combo) : branche locale créée, elle n\'est plus remoteOnly', async () => {
    expect(await sync.checkoutBranch(repo, 'origin/int-B')).toEqual({ branch: 'int-B', remote: 'created', remoteRef: 'origin/int-B' })
    expect(await sync.listBranches(repo)).toEqual([
      { name: 'int-A', isCurrent: false, type: 'int' },
      { name: 'int-B', isCurrent: true, type: 'int' },
      { name: 'int-C', isCurrent: false, type: 'int', remoteOnly: true },
    ])
  })

  it('repo sans remote : branches locales seules', async () => {
    await git.deleteRemote({ fs, dir: repo, remote: 'origin' })
    await fsP.rm(path.join(repo, '.git', 'refs', 'remotes'), { recursive: true, force: true })
    expect(await sync.listBranches(repo)).toEqual([{ name: 'int-A', isCurrent: true, type: 'int' }])
  })
})
