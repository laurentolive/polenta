import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { isSafeTreePath, nodeCheckout } from './node-checkout'
import { closeAll, closeRepo } from './process-registry'

/**
 * GH337 P10 — `nodeCheckout` n'écrit jamais un chemin d'arbre non sûr (`..`, `.git`, `\`, préfixe de
 * lecteur) : il rend `false` (repli sur `git checkout`, qui refuse ces chemins) et n'écrit rien.
 */

const AUTHOR = { name: 'Alice', email: 'a@x' }

let dir: string
let g: GitBackend
let head: string

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-paths-co-'))
  g = gitFor(dir)
  await g.init('main')
  fs.writeFileSync(path.join(dir, 'x.txt'), 'v1\n')
  await g.addAll()
  head = await g.commit({ message: 'init', author: { ...AUTHOR, timestamp: 1_700_000_000 } })
})

afterEach(async () => {
  await closeRepo(dir)
  fs.rmSync(dir, { recursive: true, force: true })
})

afterAll(() => closeAll())

/** Commit dont l'arbre contient `x.txt` (nouveau contenu) plus `sub/<name>` : dossier `sub` à nom suspect. */
async function commitWithSubtree(subName: string, leaf: string, content: string): Promise<string> {
  const blob = await g.writeBlob(content)
  const xBlob = await g.writeBlob('v2\n')
  const inner = await g.mktree([{ mode: '100644', type: 'blob', oid: blob, path: leaf }])
  const tree = await g.mktree([
    { mode: '100644', type: 'blob', oid: xBlob, path: 'x.txt' },
    { mode: '040000', type: 'tree', oid: inner, path: subName },
  ])
  return g.commitTree(tree, [head], 'arbre suspect', { ...AUTHOR, timestamp: 1_700_000_100 })
}

async function commitPlain(): Promise<string> {
  const xBlob = await g.writeBlob('v2\n')
  const tree = await g.mktree([{ mode: '100644', type: 'blob', oid: xBlob, path: 'x.txt' }])
  return g.commitTree(tree, [head], 'arbre sûr', { ...AUTHOR, timestamp: 1_700_000_200 })
}

describe('GH337 P10 — chemins de l\'arbre refusés avant toute écriture', () => {
  it('isSafeTreePath : refuse les composants dangereux, accepte les chemins ordinaires', () => {
    for (const bad of ['', '/abs', 'a\\b', 'C:x', 'a/../b', '../x', '.git/config', 'a/.GIT/x', 'a/./b', 'a//b', 'a/', 'a/\0b']) {
      expect(isSafeTreePath(bad), bad).toBe(false)
    }
    for (const good of ['x.txt', 'a/b/c.yaml', 'a/.gitignore', 'a/..b/c', 'a.git/x']) {
      expect(isSafeTreePath(good), good).toBe(true)
    }
  })

  it('arbre contenant .git/config : nodeCheckout → false, .git et le disque intacts', async () => {
    const configBefore = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8')
    const commit = await commitWithSubtree('.git', 'config', '[core]\n\thooksPath = /tmp/evil\n')
    expect(await nodeCheckout(dir, commit)).toBe(false)
    expect(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8')).toBe(configBefore)
    expect(fs.readFileSync(path.join(dir, 'x.txt'), 'utf8')).toBe('v1\n')
  })

  it('arbre contenant ../x : nodeCheckout → false, rien écrit hors du dépôt', async () => {
    const commit = await commitWithSubtree('..', 'x', 'hors\n')
    expect(await nodeCheckout(dir, commit)).toBe(false)
    // Contenu comparé (et non existence) : un `x` préexistant dans tmpdir ne doit pas faire échouer le test.
    const outside = path.join(dir, '..', 'x')
    expect(fs.existsSync(outside) && fs.readFileSync(outside, 'utf8') === 'hors\n').toBe(false)
    expect(fs.readFileSync(path.join(dir, 'x.txt'), 'utf8')).toBe('v1\n')
  })

  it('témoin : un arbre sûr est bien écrit (le refus ne tient pas à un échec général)', async () => {
    const commit = await commitPlain()
    expect(await nodeCheckout(dir, commit)).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'x.txt'), 'utf8')).toBe('v2\n')
  })
})
