import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { closeAll } from './process-registry'

/** GH337 — API GitBackend (scénarios L, E, F de specs/GH337-tests.md). */

const A = { name: 'Alice', email: 'a@x' }
const B = { name: 'Bob', email: 'b@x' }
let dir: string
let g: GitBackend
let t = 1_700_000_000

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), content)
}

async function commit(files: Record<string, string | null>, msg: string, who = A): Promise<string> {
  for (const [f, c] of Object.entries(files)) {
    if (c === null) fs.rmSync(path.join(dir, f))
    else write(f, c)
  }
  await g.add(Object.keys(files))
  return g.commit({ message: msg, author: { ...who, timestamp: (t += 60) } })
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-backend-'))
  g = gitFor(dir)
  await g.init('main')
})

afterEach(async () => {
  await g.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('lectures', () => {
  it('dépôt vide : resolve null, log vide, branche courante main', async () => {
    expect(await g.resolve('HEAD')).toBeNull()
    expect(await g.log('HEAD')).toEqual([])
    expect(await g.currentBranch()).toBe('main')
  })

  it('L1 statut : modifié, ajouté, supprimé, non suivi, ignoré, accents et espaces', async () => {
    await commit({ 'm.txt': '1', 'd.txt': '1', '.gitignore': '*.pref\n' }, 'init')
    write('m.txt', '2')
    fs.rmSync(path.join(dir, 'd.txt'))
    write('new é.txt', 'x')
    await g.add(['new é.txt'])
    write('u v.txt', 'x')
    write('local.pref', 'x')
    const s = await g.status({ ignored: true })
    const by = Object.fromEntries(s.map(e => [e.path, e.index + e.worktree]))
    expect(by).toEqual({ 'm.txt': '.M', 'd.txt': '.D', 'new é.txt': 'A.', 'u v.txt': '??', 'local.pref': '!!' })
  })

  it('L2 GH326 : réécriture à taille égale dans la même seconde vue modifiée', async () => {
    await commit({ 'f.txt': 'aaaa' }, 'init')
    write('f.txt', 'bbbb')
    expect((await g.status()).map(e => e.path)).toEqual(['f.txt'])
  })

  it('L3 GH296/GH335 : CRLF sur disque, LF dans git, .gitattributes eol=lf → non modifié', async () => {
    await commit({ '.gitattributes': '* text=auto eol=lf\n', 'r.yaml': 'a: 1\nb: 2\n' }, 'init')
    write('r.yaml', 'a: 1\r\nb: 2\r\n')
    expect(await g.status()).toEqual([])
    write('r.yaml', 'a: 1\r\nb: 3\r\n')
    expect((await g.status()).map(e => e.path)).toEqual(['r.yaml'])
  })

  it('L4/L8 log avec changements, renommage et suppression ; diffNames', async () => {
    const c1 = await commit({ 'a.yaml': '1', 'b.yaml': '1' }, 'un\n\ncorps é', A)
    const c2 = await commit({ 'a.yaml': '2' }, 'deux', B)
    fs.renameSync(path.join(dir, 'b.yaml'), path.join(dir, 'c.yaml'))
    await g.add(['b.yaml', 'c.yaml'])
    const c3 = await g.commit({ message: 'trois', author: { ...A, timestamp: (t += 60) } })
    const log = await g.log('HEAD', { changes: true })
    expect(log.map(e => e.oid)).toEqual([c3, c2, c1])
    expect(log[2].message).toBe('un\n\ncorps é')
    expect(log[1].author.name).toBe('Bob')
    expect(log[2].changes).toEqual([{ status: 'A', path: 'a.yaml' }, { status: 'A', path: 'b.yaml' }])
    expect(log[0].changes).toEqual([{ status: 'D', path: 'b.yaml' }, { status: 'A', path: 'c.yaml' }])
    expect(await g.diffNames(c2, c3, { renames: true })).toEqual([{ status: 'R', oldPath: 'b.yaml', path: 'c.yaml' }])
    expect(await g.log('HEAD', { paths: ['a.yaml'] }).then(l => l.map(e => e.oid))).toEqual([c2, c1])
  })

  it('L5 readText / readCommit / lsTree', async () => {
    const c1 = await commit({ 'x/y.txt': 'é\n', 'z.txt': 'z' }, 'm')
    expect(await g.readText(c1, 'x/y.txt')).toBe('é\n')
    expect(await g.readText(c1, 'absent')).toBeNull()
    expect(await g.readText('nope', 'x/y.txt')).toBeNull()
    const c = await g.readCommit('HEAD')
    expect(c?.oid).toBe(c1)
    expect(c?.author.timestamp).toBe(t)
    expect((await g.lsTree('HEAD', { prefix: 'x' })).map(e => e.path)).toEqual(['x/y.txt'])
  })

  it('L6 refs : branches, tag léger, tag annoté pelé', async () => {
    const c1 = await commit({ 'f': '1' }, 'm')
    await g.createBranch('dev-x')
    await g.tag('light')
    await g.annotatedTag('v1', 'HEAD', 'release', A)
    const refs = await g.refs(['refs/heads', 'refs/tags'])
    const by = Object.fromEntries(refs.map(r => [r.ref, r]))
    expect(by['refs/heads/dev-x'].oid).toBe(c1)
    expect(by['refs/tags/light'].oid).toBe(c1)
    expect(by['refs/tags/v1'].oid).not.toBe(c1)
    expect(by['refs/tags/v1'].peeled).toBe(c1)
    expect(await g.resolveCommit('v1')).toBe(c1)
    expect((await g.readTag(by['refs/tags/v1'].oid))?.message).toBe('release\n')
  })
})

describe('écritures', () => {
  it('E1 commit : auteur et message exacts, hook du dépôt ignoré', async () => {
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await g.setConfig('commit.gpgsign', 'true')
    const oid = await commit({ 'f': '1' }, 'Message\n\nmultiligne à accents\n', B)
    const c = await g.readCommit(oid)
    expect(c?.author).toMatchObject({ name: 'Bob', email: 'b@x' })
    expect(c?.committer).toMatchObject({ name: 'Bob', email: 'b@x' })
    expect(c?.message).toBe('Message\n\nmultiligne à accents\n')
  })

  it('E2 commit de certains fichiers : le reste de l\'index est conservé', async () => {
    await commit({ 'a': '1', 'b': '1' }, 'init')
    write('a', '2')
    write('b', '2')
    await g.add(['a', 'b'])
    await g.commit({ message: 'a seul', author: A, paths: ['a'] })
    expect(await g.readText('HEAD', 'a')).toBe('2')
    expect(await g.readText('HEAD', 'b')).toBe('1')
    expect((await g.status()).map(e => e.path + e.index)).toEqual(['bM'])
  })

  it('E3 checkout refusé sur modification locale, working directory intact', async () => {
    await commit({ 'f': '1' }, 'init')
    await g.createBranch('other')
    await g.checkout('other')
    await commit({ 'f': '2' }, 'other')
    await g.checkout('main')
    write('f', 'local')
    await expect(g.checkout('other')).rejects.toMatchObject({ kind: 'local-changes' })
    expect(fs.readFileSync(path.join(dir, 'f'), 'utf8')).toBe('local')
  })

  it('E7 transaction de refs refusée si oldOid ne correspond pas', async () => {
    const c1 = await commit({ 'f': '1' }, 'un')
    const c2 = await commit({ 'f': '2' }, 'deux')
    await expect(g.updateRefs([
      { ref: 'refs/heads/x', newOid: c1 },
      { ref: 'refs/heads/main', newOid: c1, oldOid: c1 },
    ])).rejects.toBeTruthy()
    expect(await g.resolve('refs/heads/x')).toBeNull()
    expect(await g.resolve('refs/heads/main')).toBe(c2)
  })

  it('E9 restore : indexé + modifié revient à HEAD ; non suivi supprimé', async () => {
    await commit({ 'f': '1' }, 'init')
    write('f', '2')
    await g.add(['f'])
    write('f', '3')
    write('n', 'x')
    await g.add(['n'])
    await g.restore(['f', 'n'])
    expect(fs.readFileSync(path.join(dir, 'f'), 'utf8')).toBe('1')
    expect(fs.existsSync(path.join(dir, 'n'))).toBe(false)
    expect(await g.status()).toEqual([])
  })
})

describe('fusion', () => {
  it('F2 conflit : chemins remontés, ni working directory ni index modifiés', async () => {
    await commit({ 'f': 'base\n', 'g': 'g\n' }, 'base')
    await g.createBranch('other')
    await commit({ 'f': 'main\n' }, 'main')
    await g.checkout('other')
    await commit({ 'f': 'other\n' }, 'other')
    await g.checkout('main')
    const r = await g.mergeTree('main', 'other')
    expect(r.clean).toBe(false)
    expect(r.conflicts).toEqual(['f'])
    expect(fs.readFileSync(path.join(dir, 'f'), 'utf8')).toBe('main\n')
    expect(await g.status()).toEqual([])
  })

  it('F1/F3 fusion propre : commitTree + avance de la branche', async () => {
    await commit({ 'f': 'base\n', 'g': 'g\n' }, 'base')
    await g.createBranch('other')
    const m = await commit({ 'f': 'main\n' }, 'main')
    await g.checkout('other')
    const o = await commit({ 'g': 'other\n' }, 'other')
    await g.checkout('main')
    const r = await g.mergeTree('main', 'other')
    expect(r.clean).toBe(true)
    const mc = await g.commitTree(r.tree, [m, o], 'merge', A)
    await g.mergeFastForward(mc)
    expect(fs.readFileSync(path.join(dir, 'g'), 'utf8')).toBe('other\n')
    expect((await g.readCommit('HEAD'))?.parents).toEqual([m, o])
  })

  it('F4 GH332 : histoire croisée fusionnée sans MergeNotSupported', async () => {
    await commit({ 'a': '1\n', 'b': '1\n' }, 'base')
    await g.createBranch('x')
    const m1 = await commit({ 'a': '2\n' }, 'main1')
    await g.checkout('x')
    const x1 = await commit({ 'b': '2\n' }, 'x1')
    // Fusions croisées : chacun fusionne l'autre.
    const t1 = await g.mergeTree(x1, m1)
    const xm = await g.commitTree(t1.tree, [x1, m1], 'x<-main', A)
    await g.updateRefs([{ ref: 'refs/heads/x', newOid: xm }])
    await g.checkout('main', { force: true })
    const t2 = await g.mergeTree(m1, x1)
    const mm = await g.commitTree(t2.tree, [m1, x1], 'main<-x', A)
    await g.updateRefs([{ ref: 'refs/heads/main', newOid: mm }])
    await g.resetHard('main')
    expect((await g.mergeBases('main', 'x')).length).toBe(2)
    const r = await g.mergeTree('main', 'x')
    expect(r.clean).toBe(true)
  })
})
