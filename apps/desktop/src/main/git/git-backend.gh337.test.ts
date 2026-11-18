import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, parseRemoteUrls, type GitBackend } from './git-backend'
import { runGit } from './git-runner'
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

  it('L6b refCommits : commit d\'une branche, d\'un tag léger ou annoté ; null pour un tag de blob', async () => {
    const c1 = await commit({ 'f': '1' }, 'm')
    await g.tag('light')
    await g.annotatedTag('v1', 'HEAD', 'release', A)
    await g.tag('blob', (await g.resolve('HEAD:f'))!)
    const by = Object.fromEntries((await g.refCommits(['refs/heads', 'refs/tags'])).map(r => [r.ref, r]))
    expect(by['refs/heads/main'].commit).toBe(c1)
    expect(by['refs/tags/light'].commit).toBe(c1)
    expect(by['refs/tags/v1'].commit).toBe(c1)
    expect(by['refs/tags/v1'].oid).not.toBe(c1)
    expect(by['refs/tags/blob'].commit).toBeNull()
  })

  it('L7 currentBranch : nom complet de la branche même si un tag porte le même nom', async () => {
    await commit({ 'f': '1' }, 'm')
    await g.tag('main')
    expect(await g.currentBranch()).toBe('main')
    await g.checkout('HEAD', { detach: true })
    expect(await g.currentBranch()).toBeNull()
  })

  it('L7b currentBranch hors dépôt : lève (pas « détaché », GH206 S8 lecture seule)', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-plain-'))
    try {
      await expect(gitFor(plain).currentBranch()).rejects.toThrow()
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })

  it('L9 pathCommits / fileHistories : fusions, branche latérale, fichier touché par la seule fusion', async () => {
    const c0 = await commit({ 'r/a.yaml': '1', 'other': '1' }, 'root', A)
    await g.createBranch('side')
    await g.checkout('side')
    const s1 = await commit({ 'r/b.yaml': '1' }, 'side', B)
    await g.checkout('main')
    const m1 = await commit({ 'other': '2' }, 'hors préfixe', A)
    // Fusion dont l'arbre ajoute r/c.yaml (résolution) : seul ce commit de fusion touche r/c.yaml.
    write('r/c.yaml', '1')
    await g.add(['r/c.yaml'])
    const mc = await g.commitTree(await g.writeTree(), [m1, s1], 'merge', { ...B, timestamp: (t += 60) })
    await g.resetHard(mc)

    const all = await g.pathCommits('HEAD', ['r/'])
    expect(all.map(c => c.oid)).toEqual([mc, s1, c0])
    expect(all[0].changes).toEqual([{ status: 'A', path: 'r/c.yaml' }])
    expect((await g.pathCommits('HEAD', ['r'], { firstParent: true })).map(c => c.oid)).toEqual([mc, c0])
    // stopAt sur un commit qui ne touche pas r/ : lui et ses premiers parents sont exclus.
    expect((await g.pathCommits('HEAD', ['r'], { firstParent: true, stopAt: m1 })).map(c => c.oid)).toEqual([mc])
    expect((await g.pathCommits('HEAD', ['r'], { stopAt: 'absente' })).length).toBe(3)
    expect(await g.pathCommits('nope', ['r'])).toEqual([])
    expect(await g.pathCommits('HEAD', [])).toEqual([])

    const h = await g.fileHistories('HEAD', ['r'])
    const ts = async (oid: string) => (await g.readCommit(oid))!.committer.timestamp
    expect(Object.fromEntries(h)).toEqual({
      'r/a.yaml': { created: await ts(c0), createdBy: 'Alice', updated: await ts(c0), updatedBy: 'Alice' },
      'r/b.yaml': { created: await ts(s1), createdBy: 'Bob', updated: await ts(s1), updatedBy: 'Bob' },
      'r/c.yaml': { created: await ts(mc), createdBy: 'Bob', updated: await ts(mc), updatedBy: 'Bob' },
    })
  })

  it('L11 lsTree par cat-file : identique à ls-tree pour toutes les options', async () => {
    await commit({
      'a.txt': '1', 'requirements/SYS-1.yaml': '1', 'requirements/sub/SYS-2.yaml': '2', 'requirements-x/y.yaml': '3',
      'tests/T-1.yaml': '4', 'components/c1/x': '5', 'é dir/f ü.txt': '6',
    }, 'm')
    const prefixes = [undefined, 'requirements', 'requirements/', 'requirements/sub', 'components', 'a.txt', 'é dir', 'absent', 'requirements/absent']
    for (const prefix of prefixes) {
      for (const recursive of [true, false]) {
        for (const trees of [false, true]) {
          const opts = { prefix, recursive, trees }
          expect(await g.lsTree('HEAD', opts), JSON.stringify(opts)).toEqual(await g.lsTreeProcess('HEAD', opts))
        }
      }
    }
    expect(await g.lsTree('absent-ref')).toEqual([])
  })

  it('L12 remotes : cache suivi des changements de .git/config (Polenta ou externe)', async () => {
    expect(await g.remotes()).toEqual([])
    await g.addRemote('origin', 'https://a.example/x.git')
    expect(await g.remotes()).toEqual([{ name: 'origin', url: 'https://a.example/x.git' }])
    // Même longueur d'URL, écrite hors de Polenta : la date de .git/config change.
    await runGit(dir, ['remote', 'set-url', 'origin', 'https://b.example/x.git'], { write: true })
    expect(await g.remotes()).toEqual([{ name: 'origin', url: 'https://b.example/x.git' }])
    await g.setRemoteUrl('origin', 'https://c.example/x.git')
    expect(await g.remotes()).toEqual([{ name: 'origin', url: 'https://c.example/x.git' }])
  })

  it('L13 checkIgnore : noms littéraux (crochets, accents), malgré GIT_LITERAL_PATHSPECS', async () => {
    await commit({ '.gitignore': '*.pref\ncache/\n' }, 'm')
    expect(await g.checkIgnore(['a[1].pref', 'é.txt', 'cache/x', 'README.md']))
      .toEqual(new Set(['a[1].pref', 'cache/x']))
  })

  it('L14 remotes lus dans .git/config : identiques à git config, repli sur les formats inhabituels', async () => {
    const viaGit = async (): Promise<{ name: string; url: string }[]> => {
      const r = await runGit(dir, ['config', '--get-regexp', '^remote\\..*\\.url$'], { okExitCodes: [1] })
      return r.stdout.toString().split('\n').filter(Boolean).map(l => {
        const sp = l.indexOf(' ')
        return { name: l.slice('remote.'.length, sp - '.url'.length), url: l.slice(sp + 1) }
      })
    }
    const base = '[core]\n\trepositoryformatversion = 0\n\tbare = false\n'
    const cases: [string, boolean][] = [
      [base, true],
      [`${base}[remote "origin"]\n\turl = https://h/x.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`, true],
      [`${base}[remote "origin"]\r\n\tURL=https://h/x.git ; commentaire\r\n# autre\r\n[remote "a.b"]\n\turl = git@h:y.git\n[branch "main"]\n\tremote = origin\n`, true],
      [`${base}[remote "origin"]\n\tpushurl = https://p/x.git\n\turl = https://h/x.git\n\turl = https://h2/x.git\n`, true],
      [`${base}[include]\n\tpath = autre\n[remote "origin"]\n\turl = https://h/x.git\n`, false],
      [`${base}[remote.origin]\n\turl = https://h/x.git\n`, false],
      [`${base}[remote "origin"]\n\turl = "https://h/x y.git"\n`, false],
    ]
    for (const [config, simple] of cases) {
      fs.writeFileSync(path.join(dir, '.git', 'config'), config)
      expect(parseRemoteUrls(config) !== null, config).toBe(simple)
      expect(await gitFor(dir).remotes(), config).toEqual(await viaGit())
    }
  })

  it('L10 refNames : branches imbriquées, tags et branches distantes, préfixe retiré, sans débordement de préfixe', async () => {
    const c1 = await commit({ 'f': '1' }, 'm')
    await g.createBranch('feature/x')
    await g.createBranch('int-a')
    await g.tag('v1')
    await g.updateRefs([
      { ref: 'refs/remotes/origin/int-b', newOid: c1 },
      { ref: 'refs/remotes/origin2/int-c', newOid: c1 },
    ])
    expect(await g.refNames('refs/heads')).toEqual(['feature/x', 'int-a', 'main'])
    expect(await g.refNames('refs/tags/')).toEqual(['v1'])
    expect(await g.refNames('refs/remotes/origin')).toEqual(['int-b'])
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-norepo-'))
    try {
      await expect(gitFor(outside).refNames('refs/tags')).rejects.toThrow()
    } finally {
      await gitFor(outside).close()
      fs.rmSync(outside, { recursive: true, force: true })
    }
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

  it('E10 setHeadBranch / detachHead : HEAD seul déplacé, disque, index et branches intacts', async () => {
    const c1 = await commit({ 'f': '1' }, 'un')
    write('f', 'local')
    await g.createBranch('x', c1)
    await g.setHeadBranch('x')
    expect(await g.currentBranch()).toBe('x')
    await g.detachHead(c1)
    expect(await g.currentBranch()).toBeNull()
    expect(await g.resolve('HEAD')).toBe(c1)
    expect(await g.resolve('refs/heads/x')).toBe(c1)
    expect(await g.resolve('refs/heads/main')).toBe(c1)
    expect(fs.readFileSync(path.join(dir, 'f'), 'utf8')).toBe('local')
    // Dépôt vide : HEAD peut viser une branche sans commit.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-backend-empty-'))
    try {
      await gitFor(empty).init('main')
      await gitFor(empty).setHeadBranch('int-x')
      expect(await gitFor(empty).currentBranch()).toBe('int-x')
    } finally {
      await gitFor(empty).close()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('E11 deleteBranch : branche non fusionnée supprimée', async () => {
    await commit({ 'f': '1' }, 'un')
    await g.createBranch('y')
    await g.setHeadBranch('y')
    await commit({ 'f': '2' }, 'deux')
    await g.setHeadBranch('main')
    await g.deleteBranch('y')
    expect(await g.resolve('refs/heads/y')).toBeNull()
  })

  it('E12 lsFilesEol : index et disque, fichier absent', async () => {
    await commit({ 'lf.txt': 'a\nb\n', 'gone.txt': 'x\n' }, 'init')
    fs.writeFileSync(path.join(dir, 'lf.txt'), 'a\r\nb\r\n')
    fs.rmSync(path.join(dir, 'gone.txt'))
    const by = Object.fromEntries((await g.lsFilesEol()).map(e => [e.path, `${e.index}/${e.worktree}`]))
    expect(by).toEqual({ 'lf.txt': 'lf/crlf', 'gone.txt': 'lf/' })
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
