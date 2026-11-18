import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { nodeCheckout } from './node-checkout'
import { closeAll } from './process-registry'

/** GH337 — essai sprint 0 : checkout écrit par Polenta, comparé au `git checkout` natif. */

const A = { name: 'Alice', email: 'a@x' }
let dirs: string[] = []
let t = 1_700_000_000

function mk(): { dir: string; g: GitBackend } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-nodeco-'))
  dirs.push(dir)
  return { dir, g: gitFor(dir) }
}

async function commit(dir: string, g: GitBackend, files: Record<string, string | null>): Promise<string> {
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(dir, f)
    if (c === null) {
      fs.rmSync(p)
      try { fs.rmdirSync(path.dirname(p)) } catch { /* dossier non vide */ }
    }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
  }
  await g.addAll()
  return g.commit({ message: 'm', author: { ...A, timestamp: (t += 60) } })
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); out[path.relative(dir, p).replace(/\\/g, '/') + '/'] = '' }
      else out[path.relative(dir, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'latin1')
    }
  }
  walk(dir)
  return out
}

/** Dépôt à deux branches : ajouts, modifications, suppressions (dossier vidé), eol=crlf. */
async function scenario(): Promise<{ dir: string; g: GitBackend }> {
  const { dir, g } = mk()
  await g.init('main')
  await commit(dir, g, {
    '.gitattributes': '*.txt text eol=crlf\n*.md text\n*.yaml text=auto\n*.lf text eol=lf\n*.raw -text\n',
    'a.txt': 'un\ndeux\n',
    'keep.yaml': 'k: 1\n',
    'old/deep/x.yaml': 'x: 1\n',
    'bin.dat': '\x00\x01\x02',
  })
  await g.createBranch('feature')
  await g.checkout('feature')
  await commit(dir, g, {
    'a.txt': 'un\ndeux\ntrois\n',
    'old/deep/x.yaml': null,
    'new/dir/y.txt': 'y\n',
    'bin.dat': '\x03\x00',
    'n.md': '# t\nx\n',
    'c.yaml': 'a: 1\nb: 2\n',
    'bin.yaml': 'a\n\x00\x01\n',
    'z.lf': 'l\nm\n',
    'r.raw': 'r\ns\n',
    'plain.ts': 'p\nq\n',
    'keep.yaml': 'k: 1\nk2: 2\n',
  })
  await g.checkout('main')
  return { dir, g }
}

afterEach(async () => {
  for (const d of dirs) { await gitFor(d).close(); fs.rmSync(d, { recursive: true, force: true }) }
  dirs = []
})
afterAll(() => closeAll())

describe('nodeCheckout', () => {
  it('produit le même working directory, le même index et la même HEAD que git checkout', async () => {
    const ref = await scenario()
    const exp = await scenario()
    await exp.g.checkout('feature')
    expect(await nodeCheckout(ref.dir, 'feature')).toBe(true)
    expect(tree(ref.dir)).toEqual(tree(exp.dir))
    expect(tree(ref.dir)['a.txt']).toBe('un\r\ndeux\r\ntrois\r\n')
    expect(tree(ref.dir)['old/']).toBeUndefined()
    expect(await ref.g.status()).toEqual([])
    expect(await ref.g.currentBranch()).toBe('feature')
    // aller-retour
    expect(await nodeCheckout(ref.dir, 'main')).toBe(true)
    await exp.g.checkout('main')
    expect(tree(ref.dir)).toEqual(tree(exp.dir))
    expect(await ref.g.status()).toEqual([])
    expect(await ref.g.currentBranch()).toBe('main')
  })

  it('tête détachée', async () => {
    const { dir, g } = await scenario()
    const oid = await g.resolveOrThrow('feature')
    expect(await nodeCheckout(dir, oid, { detach: true })).toBe(true)
    expect(await g.currentBranch()).toBeNull()
    expect(await g.resolve('HEAD')).toBe(oid)
    expect(await g.status()).toEqual([])
  })

  it('rend la main sans rien toucher sur modification locale suivie', async () => {
    const { dir, g } = await scenario()
    fs.writeFileSync(path.join(dir, 'keep.yaml'), 'k: 2\n')
    const before = tree(dir)
    expect(await nodeCheckout(dir, 'feature')).toBe(false)
    expect(tree(dir)).toEqual(before)
    expect(await g.currentBranch()).toBe('main')
  })

  it('rend la main sur fichier non suivi au chemin d\'un ajout', async () => {
    const { dir, g } = await scenario()
    fs.mkdirSync(path.join(dir, 'new/dir'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'new/dir/y.txt'), 'local\n')
    expect(await nodeCheckout(dir, 'feature')).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'new/dir/y.txt'), 'utf8')).toBe('local\n')
    expect(await g.currentBranch()).toBe('main')
  })

  it('rend la main, sans rien toucher, sur un dossier remplacé par un fichier qui garde un fichier ignoré', async () => {
    const { dir, g } = mk()
    await g.init('main')
    await commit(dir, g, { '.gitignore': 'a/cache\n', 'a/x.txt': 'x\n', 'b.txt': 'b\n' })
    await g.createBranch('feature')
    await g.checkout('feature')
    await commit(dir, g, { 'a/x.txt': null, 'a': 'fichier\n', 'b.txt': 'b2\n' })
    await g.checkout('main')
    fs.writeFileSync(path.join(dir, 'a/cache'), 'ignoré\n')
    const before = tree(dir)
    const reasons: string[] = []
    expect(await nodeCheckout(dir, 'feature', { onFallback: r => reasons.push(r) })).toBe(false)
    expect(reasons[0]).toMatch(/conflit dossier \/ fichier : a$/)
    expect(tree(dir)).toEqual(before)
    expect(await g.currentBranch()).toBe('main')
  })

  it('dossier remplacé par un fichier, sans reste : écrit par Polenta, comme git checkout', async () => {
    const make = async (): Promise<{ dir: string; g: GitBackend }> => {
      const r = mk()
      await r.g.init('main')
      await commit(r.dir, r.g, { 'a/x.txt': 'x\n', 'b.txt': 'b\n' })
      await r.g.createBranch('feature')
      await r.g.checkout('feature')
      await commit(r.dir, r.g, { 'a/x.txt': null, 'a': 'fichier\n' })
      await r.g.checkout('main')
      return r
    }
    const ref = await make()
    const exp = await make()
    await exp.g.checkout('feature')
    expect(await nodeCheckout(ref.dir, 'feature')).toBe(true)
    expect(tree(ref.dir)).toEqual(tree(exp.dir))
    expect(await ref.g.status()).toEqual([])
  })
})
