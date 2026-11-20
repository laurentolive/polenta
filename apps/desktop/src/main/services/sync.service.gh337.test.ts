import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from '../git/git-backend'
import { closeAll } from '../git/process-registry'
import { runGit } from '../git/git-runner'
import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'

/** GH337 sprint 1 — lectures de `SyncService` sur `GitBackend` (statut, graphe, refs, diff, tags). */

const A = { name: 'Alice', email: 'a@x' }
let dir: string
let g: GitBackend
let sync: SyncService
let t = 1_700_000_000

const abs = (f: string) => path.join(dir, f)
function write(f: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(f)), { recursive: true })
  fs.writeFileSync(abs(f), content)
}
async function commit(files: Record<string, string | null>, msg: string): Promise<string> {
  for (const [f, c] of Object.entries(files)) {
    if (c === null) fs.rmSync(abs(f))
    else write(f, c)
  }
  await g.add(Object.keys(files))
  return g.commit({ message: msg, author: { ...A, timestamp: (t += 60) } })
}
const sorted = <T extends { path: string }>(xs: T[]) => [...xs].sort((a, b) => a.path.localeCompare(b.path))
/** Dates auteur / commit fixées (secondes UTC), pour un historique dont les deux dates diffèrent. */
const datedEnv = (author: number, committer: number) => ({
  extra: {
    GIT_AUTHOR_NAME: A.name, GIT_AUTHOR_EMAIL: A.email, GIT_COMMITTER_NAME: A.name, GIT_COMMITTER_EMAIL: A.email,
    GIT_AUTHOR_DATE: `@${author} +0000`, GIT_COMMITTER_DATE: `@${committer} +0000`,
  },
})
async function datedCommit(files: Record<string, string>, msg: string, author: number, committer: number): Promise<string> {
  for (const [f, c] of Object.entries(files)) write(f, c)
  await g.add(Object.keys(files))
  await runGit(dir, ['commit', '-q', '--no-verify', '-m', msg], { write: true, env: datedEnv(author, committer) })
  return (await g.resolve('HEAD'))!
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-sync-'))
  g = gitFor(dir)
  await g.init('main')
  sync = new SyncService({ getAuthor: async () => A } as unknown as AuthService)
})

afterEach(async () => {
  await g.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('statut', () => {
  it('staged / unstaged : ajouté, modifié, supprimé, non suivi ; ignoré absent', async () => {
    await commit({ 'm.txt': '1', 'd.txt': '1', 's.txt': '1', '.gitignore': '*.pref\n' }, 'init')
    write('m.txt', '2')
    fs.rmSync(abs('d.txt'))
    write('s.txt', '2')
    await g.add(['s.txt'])
    write('n.txt', 'n')
    await g.add(['n.txt'])
    write('u.txt', 'u')
    write('x.pref', 'p')
    const s = await sync.status(dir)
    expect(s.branch).toBe('main')
    expect(sorted(s.staged)).toEqual([{ path: 'n.txt', marker: 'A' }, { path: 's.txt', marker: 'M' }])
    expect(sorted(s.unstaged)).toEqual([
      { path: 'd.txt', marker: 'D' }, { path: 'm.txt', marker: 'M' }, { path: 'u.txt', marker: 'A' },
    ])
    expect(await sync.workdirChangesVsHead(dir, ['.'])).toEqual(expect.arrayContaining([
      { path: 'd.txt', change: 'removed' }, { path: 'm.txt', change: 'modified' }, { path: 's.txt', change: 'modified' },
      { path: 'n.txt', change: 'added' }, { path: 'u.txt', change: 'added' },
    ]))
    expect(await sync.workdirChangesVsHead(dir, [])).toEqual([])
  })

  it('unstageAll puis discard : index et disque ramenés à HEAD, nouveau fichier supprimé', async () => {
    await commit({ 'a.txt': '1' }, 'init')
    write('a.txt', '2')
    write('n.txt', 'n')
    await g.add(['a.txt', 'n.txt'])
    await sync.unstageAll(dir)
    expect((await sync.status(dir)).staged).toEqual([])
    await sync.discard(dir, 'a.txt')
    await sync.discard(dir, 'n.txt')
    expect(fs.readFileSync(abs('a.txt'), 'utf8')).toBe('1')
    expect(fs.existsSync(abs('n.txt'))).toBe(false)
  })

  it('ahead : commits locaux absents de la branche distante', async () => {
    const c1 = await commit({ 'a.txt': '1' }, 'c1')
    await g.addRemote('origin', 'https://example.invalid/r.git')
    await g.updateRefs([{ ref: 'refs/remotes/origin/main', newOid: c1 }])
    await commit({ 'a.txt': '2' }, 'c2')
    const s = await sync.status(dir)
    expect([s.ahead, s.behind]).toEqual([1, 0])
    expect(await sync.integrationState(dir, 'main')).toEqual({ state: 'ahead', ahead: 1, behind: 0 })
  })

  it('ahead sans branche distante homonyme : commits absents de toutes les branches origin/* (un processus)', async () => {
    const c1 = await commit({ 'a.txt': '1' }, 'c1')
    await g.addRemote('origin', 'https://example.invalid/r.git')
    await g.updateRefs([{ ref: 'refs/remotes/origin/autre', newOid: c1 }])
    await g.createBranch('dev')
    await g.checkout('dev')
    await commit({ 'a.txt': '2' }, 'c2')
    await commit({ 'a.txt': '3' }, 'c3')
    expect((await sync.status(dir)).ahead).toBe(2)
  })

  it('workdirChangesVsHead : disque comparé à HEAD, index ignoré (retiré de l\'index mais intact, MM revenu à HEAD)', async () => {
    await commit({ 'r/a.yaml': '1\n', 'r/b.yaml': '1\n', 'r/c.yaml': '1\n' }, 'init')
    await g.remove(['r/a.yaml'], { cached: true }) // D. + ?? : contenu identique à HEAD
    write('r/b.yaml', '2\n')
    await g.add(['r/b.yaml'])
    write('r/b.yaml', '1\n') // MM : disque revenu au contenu de HEAD
    write('r/c.yaml', '3\n') // vraie modification
    expect(await sync.workdirChangesVsHead(dir, ['r'])).toEqual([{ path: 'r/c.yaml', change: 'modified' }])
  })

  it('noms avec crochets : le rafraîchissement d\'un faux changement n\'indexe pas un autre fichier', async () => {
    await commit({ '.gitattributes': '* text=auto eol=lf\n', 'a[1].yaml': 'x: 1\n', 'a1.yaml': 'y: 1\n' }, 'init')
    write('a[1].yaml', 'x: 1\r\n') // faux changement (fins de ligne)
    write('a1.yaml', 'y: 2\n') // vrai changement, non indexé
    const s = await sync.status(dir)
    expect(s.staged).toEqual([])
    expect(s.unstaged).toEqual([{ path: 'a1.yaml', marker: 'M' }])
  })
})

describe('refs, graphe et diff', () => {
  it('resolveRefs, graph, tags : branches, tag léger et annoté pelés, tag de blob ignoré', async () => {
    const c1 = await commit({ 'a.txt': '1' }, 'premier\n\ndétail')
    await g.tag('light')
    await g.annotatedTag('v1', 'HEAD', 'release', A)
    await g.tag('blob', (await g.resolve('HEAD:a.txt'))!)
    const c2 = await commit({ 'a.txt': '2' }, 'second')
    await g.createBranch('dev-x', c1)

    const refs = await sync.resolveRefs(dir)
    const by = Object.fromEntries(refs.map(r => [`${r.type}:${r.name}`, r.sha]))
    expect(by['branch:main']).toBe(c2)
    expect(by['branch:dev-x']).toBe(c1)
    expect(by['tag:light']).toBe(c1)
    expect(by['tag:v1']).toBe(c1)
    expect(by['tag:blob']).toBeUndefined()

    expect((await sync.tags(dir)).sort()).toEqual(['blob', 'light', 'v1'])
    expect(await sync.tagsForCommit(dir, c1)).toEqual(['light'])
    expect(await sync.resolveTag(dir, 'v1')).toBe(c1)
    expect(await sync.resolveTag(dir, 'absent')).toBeNull()
    expect(await sync.resolveCommitish(dir, c1.slice(0, 8))).toBe(c1)
    expect(await sync.resolveCommitish(dir, 'dev-x')).toBeNull()

    const graph = await sync.graph(dir)
    expect(graph.map(c => c.sha)).toEqual([c2, c1])
    expect(graph[0]).toMatchObject({ isCurrent: true, message: 'second', author: 'Alice', parents: [c1], refs: ['main'] })
    expect(graph[1].message).toBe('premier')
    expect(graph[1].refs.sort()).toEqual(['dev-x', 'light', 'v1'])
  })

  it('graph : un log par ref, union, tri par date d\'auteur, coupe (fusion, cherry-pick à date d\'auteur ancienne)', async () => {
    // Dates en secondes : auteur / commit. r racine ; main : p (210) ; branche old sur p ; branche feat :
    // q (120), puis F = cherry-pick à date d'auteur ancienne (125) commité tard (300). main : fusion T (400) de feat.
    // HEAD = main = T, old = p, feat = F. limit = 2.
    // Ancien algorithme (un log de 2 commits par ref, dans l'ordre de git = date de commit, union,
    // tri par date d'auteur décroissante, coupe à 2) :
    //   T : T, F   |  feat : F, q  |  old : p, r
    //   union triée par date d'auteur : T 400, p 210, F 125, q 120, r 100  →  [T, p]
    // Le log unique de tous les tips coupé à 2 (date de commit) donne T, F → [T, F] : c'est le bug.
    const r = await datedCommit({ 'r.txt': '0' }, 'r', 100, 100)
    await datedCommit({ 'm.txt': '1' }, 'p', 210, 210)
    const p = (await g.resolve('HEAD'))!
    await g.createBranch('old', p)
    await g.createBranch('feat', r)
    await g.checkout('feat')
    await datedCommit({ 'q.txt': '2' }, 'q', 120, 120)
    await datedCommit({ 'f.txt': '3' }, 'F', 125, 300)
    const F = (await g.resolve('HEAD'))!
    await g.checkout('main')
    await runGit(dir, ['merge', '--no-ff', '--no-edit', '-m', 'fusion feat', 'feat'], { write: true, env: datedEnv(400, 400) })
    const T = (await g.resolve('HEAD'))!

    const graph = await sync.graph(dir, 2)
    expect(graph.map(c => c.sha)).toEqual([T, p])
    expect(graph.map(c => c.sha)).not.toContain(F)
    expect(graph[0]).toMatchObject({ isCurrent: true, message: 'fusion feat', parents: [p, F], refs: ['main'] })
  })

  it('commitFiles, diffBetween, commitDiff', async () => {
    const c1 = await commit({ 'a.txt': '1', 'd/b.txt': '1' }, 'c1')
    const c2 = await commit({ 'a.txt': '2', 'd/b.txt': null, 'c.txt': '1' }, 'c2')
    expect(sorted(await sync.commitFiles(dir, c1))).toEqual([{ path: 'a.txt', marker: 'A' }, { path: 'd/b.txt', marker: 'A' }])
    const expected = [{ path: 'a.txt', marker: 'M' }, { path: 'c.txt', marker: 'A' }, { path: 'd/b.txt', marker: 'D' }]
    expect(sorted(await sync.commitFiles(dir, c2))).toEqual(expected)
    expect(sorted(await sync.diffBetween(dir, c1, c2))).toEqual(expected)
    expect(await sync.commitDiff(dir, c2, 'a.txt')).toMatchObject({ oldContent: '1', newContent: '2', oldRef: c1, newRef: c2 })
    await expect(sync.commitFiles(dir, '0'.repeat(40))).rejects.toThrow()
  })

  it('commitSingleFile : seul le fichier est commité, le reste reste en attente', async () => {
    await commit({ 'a.txt': '1', 'd/b.txt': '1' }, 'c1')
    write('a.txt', 'pending')
    const sha = await sync.commitSingleFile(dir, 'd/b.txt', 'nouveau', 'un fichier')
    expect(await g.readText(sha, 'd/b.txt')).toBe('nouveau')
    expect(await g.readText(sha, 'a.txt')).toBe('1')
    expect(await sync.readFileAtHead(dir, 'd/b.txt')).toBe('nouveau')
    expect(await sync.readFileAtHead(dir, 'absent.txt')).toBeNull()
  })
})
