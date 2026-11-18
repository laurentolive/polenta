import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from '../git/git-backend'
import { gitText, runGit } from '../git/git-runner'
import { closeAll, closeRepo } from '../git/process-registry'
import type { AuthService } from './auth.service'
import { GITATTRIBUTES_CONTENT } from './repo-conformity.util'
import { SyncService } from './sync.service'

/**
 * GH337 sprint 2 — écritures locales de SyncService sur le git natif : `stageAll` normalise selon
 * `.gitattributes` (revue du sprint 1), config hostile du poste sans effet (spec §5.4, tests B4).
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let repo: string
let g: GitBackend
let sync: SyncService

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

async function setupRepo(prefix: string): Promise<void> {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  g = gitFor(repo)
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await g.init('main')
}

async function teardownRepo(): Promise<void> {
  await closeRepo(repo)
  fs.rmSync(repo, { recursive: true, force: true })
}

afterAll(() => closeAll())

describe('stageAll — normalisation .gitattributes (revue sprint 1)', () => {
  beforeEach(() => setupRepo('gh337-stage-'))
  afterEach(teardownRepo)

  it('nouveau fichier CRLF ajouté par stageAll : blob LF avec `* text=auto eol=lf`', async () => {
    write('.gitattributes', GITATTRIBUTES_CONTENT)
    write('base.yaml', 'a: 1\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'base', AUTHOR)

    write('new.yaml', 'a: 1\r\nb: 2\r\n')
    write('base.yaml', 'a: 2\r\n')
    await sync.stageAll(repo)
    const sha = (await sync.commit(repo, 'crlf', AUTHOR)).sha

    expect(await g.readText(sha, 'new.yaml')).toBe('a: 1\nb: 2\n')
    expect(await g.readText(sha, 'base.yaml')).toBe('a: 2\n')
    // Le disque n'est pas réécrit, et rien ne reste en attente.
    expect(read('new.yaml')).toBe('a: 1\r\nb: 2\r\n')
    const s = await sync.status(repo)
    expect(s.staged.length + s.unstaged.length).toBe(0)
  })

  it('suppression et ajout dans le même stageAll ; stage / unstage d\'un fichier', async () => {
    write('a.yaml', 'a\n')
    write('b.yaml', 'b\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'base', AUTHOR)
    fs.rmSync(path.join(repo, 'a.yaml'))
    write('c.yaml', 'c\n')
    await sync.stageAll(repo)
    expect((await sync.status(repo)).staged).toEqual(expect.arrayContaining([
      { path: 'a.yaml', marker: 'D' }, { path: 'c.yaml', marker: 'A' },
    ]))
    await sync.unstage(repo, 'c.yaml')
    expect((await sync.status(repo)).unstaged).toEqual([{ path: 'c.yaml', marker: 'A' }])
    await sync.stage(repo, 'c.yaml')
    expect((await sync.status(repo)).staged).toContainEqual({ path: 'c.yaml', marker: 'A' })
  })
})

describe('tags et branches', () => {
  beforeEach(() => setupRepo('gh337-refs-'))
  afterEach(teardownRepo)

  it('createTag ne remplace jamais un tag ; deleteTag d\'un tag absent sans erreur ; createBranch sans toucher au disque', async () => {
    write('a.yaml', 'a\n')
    await sync.stageAll(repo)
    const first = (await sync.commit(repo, 'base', AUTHOR)).sha
    await sync.createTag(repo, 'v1')
    write('a.yaml', 'b\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'second', AUTHOR)
    await expect(sync.createTag(repo, 'v1')).rejects.toThrow()
    expect(await sync.resolveTag(repo, 'v1')).toBe(first)
    await sync.deleteTag(repo, 'absent')
    await sync.deleteTag(repo, 'v1')
    expect(await sync.resolveTag(repo, 'v1')).toBeNull()

    write('a.yaml', 'en cours\n')
    await sync.createBranch(repo, 'dev-x')
    expect(await g.currentBranch()).toBe('dev-x')
    expect(read('a.yaml')).toBe('en cours\n')
    expect((await sync.status(repo)).unstaged).toEqual([{ path: 'a.yaml', marker: 'M' }])
  })
})

/**
 * Spec §5.4, GH337-tests.md B4 — config du poste hostile (système et globale) : `core.autocrlf=true`,
 * `commit.gpgsign=true`, hook `pre-commit` qui sort en 1, `credential.helper=!echo bad`,
 * `core.editor=false`. Plus, dans le dépôt, un hook `pre-commit` et `commit.gpgsign=true` locaux.
 * Commit, checkout et statut par SyncService : comme avec une config vide.
 */
describe('B4 — config hostile du poste', () => {
  const saved: Record<string, string | undefined> = {}
  const VARS = ['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_DIR', 'GIT_WORK_TREE']
  let hostile: string

  beforeAll(() => {
    hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-hostile-home-'))
    const hooks = path.join(hostile, 'hooks')
    fs.mkdirSync(hooks)
    for (const h of ['pre-commit', 'commit-msg', 'post-checkout', 'reference-transaction']) {
      fs.writeFileSync(path.join(hooks, h), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    }
    const config = [
      '[core]', '\tautocrlf = true', '\teditor = false', `\thooksPath = ${hooks.replace(/\\/g, '/')}`,
      '[commit]', '\tgpgsign = true', '[tag]', '\tgpgsign = true',
      '[credential]', '\thelper = !echo bad',
      '[user]', '\tname = Hostile', '\temail = hostile@x',
    ].join('\n') + '\n'
    fs.writeFileSync(path.join(hostile, 'system.gitconfig'), config)
    fs.writeFileSync(path.join(hostile, '.gitconfig'), config)
    fs.mkdirSync(path.join(hostile, 'git'))
    fs.writeFileSync(path.join(hostile, 'git', 'config'), config)
    for (const v of VARS) saved[v] = process.env[v]
    process.env.GIT_CONFIG_SYSTEM = path.join(hostile, 'system.gitconfig')
    process.env.GIT_CONFIG_GLOBAL = path.join(hostile, '.gitconfig')
    process.env.HOME = hostile
    process.env.USERPROFILE = hostile
    process.env.XDG_CONFIG_HOME = hostile
    process.env.GIT_DIR = path.join(hostile, 'nowhere')
    process.env.GIT_WORK_TREE = hostile
  })

  afterAll(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
    fs.rmSync(hostile, { recursive: true, force: true })
  })

  beforeEach(() => setupRepo('gh337-hostile-'))
  afterEach(teardownRepo)

  it('commit, checkout et statut se comportent comme avec une config vide', async () => {
    // Dépôt sans .gitattributes : seul `core.autocrlf` déciderait des fins de ligne.
    fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await g.setConfig('commit.gpgsign', 'true')

    write('a.yaml', 'a: 1\nb: 1\n')
    await sync.stageAll(repo)
    const base = await sync.commit(repo, 'base', AUTHOR)
    expect((await g.readCommit(base.sha))?.author).toMatchObject(AUTHOR)
    expect(await g.readText(base.sha, 'a.yaml')).toBe('a: 1\nb: 1\n')

    await sync.createBranch(repo, 'int-x')
    write('a.yaml', 'a: 2\nb: 2\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'x', AUTHOR)
    await sync.commitSingleFile(repo, 'single.yaml', 's: 1\n', 'single')
    write('single.yaml', 's: 1\n')
    await sync.createAnnotatedTag(repo, 'base-tag', 'baseline', base.sha)

    await sync.checkoutBranch(repo, 'main')
    expect(await g.currentBranch()).toBe('main')
    // autocrlf=true du poste ignoré : le fichier sort en LF, comme dans git.
    expect(read('a.yaml')).toBe('a: 1\nb: 1\n')
    expect(fs.existsSync(path.join(repo, 'single.yaml'))).toBe(false)
    const s = await sync.status(repo)
    expect(s.staged.length + s.unstaged.length).toBe(0)

    await sync.checkoutBranch(repo, 'int-x')
    expect(read('a.yaml')).toBe('a: 2\nb: 2\n')
    expect(read('single.yaml')).toBe('s: 1\n')
    const s2 = await sync.status(repo)
    expect(s2.staged.length + s2.unstaged.length).toBe(0)

    // Le hook local et la signature locale sont restés en place (le dépôt n'est pas modifié).
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true)
    expect((await gitText(repo, ['config', '--local', 'commit.gpgsign'])).trim()).toBe('true')
    // L'identité du poste n'a servi à rien.
    expect(await runGit(repo, ['log', '--format=%an', '--author=Hostile'])).toMatchObject({ stdout: Buffer.from('') })
  })
})
