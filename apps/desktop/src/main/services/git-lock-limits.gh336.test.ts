import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'

import './git-lock-limits'

/**
 * GH336 — « Too many pending tasks in queue packed-refs » : au-delà de 1000 lectures de refs en
 * attente (tous repos confondus), isomorphic-git rejetait la suivante, y compris celle d'un checkout.
 */

let repo: string
beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-lock-'))
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  await fsP.writeFile(path.join(repo, 'a.txt'), 'a\n')
  await git.add({ fs, dir: repo, filepath: 'a.txt' })
  await git.commit({ fs, dir: repo, message: 'base', author: { name: 't', email: 't@x' } })
})
afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

it('5000 résolutions de ref simultanées : aucune n\'est rejetée', async () => {
  const results = await Promise.allSettled(Array.from({ length: 5000 }, () => git.resolveRef({ fs, dir: repo, ref: 'HEAD' })))
  expect(results.filter(r => r.status === 'rejected')).toEqual([])
}, 120_000)
