import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { gitFor, type TreeEntry } from './git-backend'
import { gitText } from './git-runner'
import { closeRepo } from './process-registry'

/** GH337 sprint 2 — blobs et arbres écrits sans processus (`commitSingleFile`) : identiques à git. */

let repo: string

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-objects-'))
  await gitFor(repo).init('main')
})

afterAll(async () => {
  await closeRepo(repo)
  fs.rmSync(repo, { recursive: true, force: true })
})

it('blob et arbre : même oid que hash-object et mktree, objets valides pour git', async () => {
  const g = gitFor(repo)
  const content = Buffer.from('id: SYS-0001\r\ntitle: é\n', 'utf8')
  const blob = await g.writeBlob(content)
  expect(blob).toBe((await gitText(repo, ['hash-object', '--no-filters', '--stdin'], { stdin: content })).trim())
  expect((await g.readBlob(blob))?.equals(content)).toBe(true)

  const sub = await g.mktree([{ mode: '100644', type: 'blob', oid: blob, path: 'x.yaml' }])
  // Ordre de git : un dossier se compare avec « / » final (`a` dossier après `a.b`, avant `a0`).
  const entries: TreeEntry[] = [
    { mode: '100644', type: 'blob', oid: blob, path: 'a0' },
    { mode: '040000', type: 'tree', oid: sub, path: 'a' },
    { mode: '100755', type: 'blob', oid: blob, path: 'a.b' },
    { mode: '100644', type: 'blob', oid: blob, path: 'é.yaml' },
  ]
  const tree = await g.mktree(entries)
  const stdin = entries.map(e => `${e.mode} ${e.type} ${e.oid}\t${e.path}\0`).join('')
  expect(tree).toBe((await gitText(repo, ['mktree', '-z'], { stdin })).trim())
  expect(await gitText(repo, ['fsck', '--strict', '--no-dangling'])).toBe('')
  expect((await g.lsTree(tree)).map(e => e.path)).toEqual(['a.b', 'a/x.yaml', 'a0', 'é.yaml'])
})
