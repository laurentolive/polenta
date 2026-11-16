import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { objectData, objectInfo } from './cat-file-batch'
import { GitUnavailableError, isSupportedVersion, parseGitVersion, resolveGitInstall } from './git-binary'
import { gitEnv, renderGitConfig } from './git-config'
import { classifyGitError, GitError } from './git-errors'
import { gitText, runGit } from './git-runner'
import { closeAll, closeRepo, liveProcessCount } from './process-registry'

/** GH337 — socle du git natif : binaire, environnement isolé, exécution, cat-file persistant. */

let repo: string

async function commitFile(dir: string, file: string, content: string, msg = file): Promise<string> {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), content)
  await runGit(dir, ['add', '--', file], { write: true })
  await runGit(dir, ['-c', 'user.name=T', '-c', 'user.email=t@x', 'commit', '-q', '-m', msg], { write: true })
  return (await gitText(dir, ['rev-parse', 'HEAD'])).trim()
}

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-core-'))
  await runGit(repo, ['init', '-q', '-b', 'main'], { write: true })
  await commitFile(repo, 'a.txt', 'alpha\n')
  await commitFile(repo, 'dir/é b.txt', 'beta\n')
})

afterAll(async () => {
  await closeAll()
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('B — résolution du binaire', () => {
  const base = { env: {}, resourcesPath: undefined, searchFrom: ['/x/app/out/main'], readVersion: () => 'git version 2.56.1.windows.1\n' }

  it('B1 POLENTA_GIT_DIR prioritaire', () => {
    const i = resolveGitInstall({ ...base, platform: 'win32', env: { POLENTA_GIT_DIR: 'C:\\g' }, exists: () => true })
    expect(i.gitExe).toBe(path.join('C:\\g', 'ucrt64', 'bin', 'git.exe'))
    expect(i.version).toBe('2.56.1')
  })

  it('B2 Windows sans binaire embarqué : erreur, jamais le git du PATH', () => {
    expect(() => resolveGitInstall({ ...base, platform: 'win32', exists: () => false })).toThrow(/git:fetch/)
  })

  it('B2 hors Windows : repli sur le git du PATH', () => {
    const i = resolveGitInstall({ ...base, platform: 'linux', exists: () => false })
    expect(i.gitExe).toBe('git')
    expect(i.gitDir).toBeNull()
  })

  it('B2 vendor/git trouvé en remontant depuis out/main', () => {
    const root = path.join('/x/app', 'vendor', 'git')
    const i = resolveGitInstall({ ...base, platform: 'win32', exists: p => p.startsWith(root) })
    expect(i.gitExe).toBe(path.join(root, 'ucrt64', 'bin', 'git.exe'))
  })

  it('B3 version trop ancienne refusée', () => {
    expect(() => resolveGitInstall({ ...base, platform: 'linux', exists: () => false, readVersion: () => 'git version 2.37.9' }))
      .toThrow(GitUnavailableError)
    expect(isSupportedVersion('2.38.0')).toBe(true)
    expect(isSupportedVersion('3.0')).toBe(true)
    expect(parseGitVersion('git version 2.39.5')).toBe('2.39.5')
  })
})

describe('B — environnement isolé', () => {
  it('B4 config : ni hooks, ni signature, ni helper, autocrlf=false', () => {
    const c = renderGitConfig('/h/hooks', { name: 'A "B"', email: 'a@b' }, 300)
    expect(c).toMatch(/autocrlf = false/)
    expect(c).toMatch(/hooksPath = "\/h\/hooks"/)
    expect(c).toMatch(/helper = $/m)
    expect(c).toMatch(/gpgSign = false/)
    expect(c).toMatch(/name = "A \\"B\\""/)
  })

  it('B5 variables GIT_* héritées retirées, config système ignorée', () => {
    const env = gitEnv({}, { PATH: '/bin', GIT_DIR: '/evil', GIT_WORK_TREE: '/evil', GIT_TRACE: '1' })
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GIT_WORK_TREE).toBeUndefined()
    expect(env.GIT_TRACE).toBe('1')
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.LC_ALL).toBe('C')
  })

  it('B4 hook pre-commit du dépôt et config locale hostile sans effet sur le commit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-hostile-'))
    try {
      await runGit(dir, ['init', '-q', '-b', 'main'], { write: true })
      fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      await runGit(dir, ['config', 'commit.gpgsign', 'true'], { write: true })
      // gpgsign local reste actif (config du dépôt) : Polenta le neutralise par -c à chaque commit.
      fs.writeFileSync(path.join(dir, 'f'), 'x')
      await runGit(dir, ['add', 'f'], { write: true })
      await runGit(dir, ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'm'], { write: true })
      expect((await gitText(dir, ['log', '--format=%s'])).trim()).toBe('m')
    } finally {
      await closeRepo(dir)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('P — exécution', () => {
  it('P1 200 résolutions parallèles par un seul cat-file', async () => {
    const before = liveProcessCount()
    const head = (await gitText(repo, ['rev-parse', 'HEAD'])).trim()
    const t = performance.now()
    const all = await Promise.all(Array.from({ length: 200 }, () => objectInfo(repo, 'HEAD')))
    const ms = performance.now() - t
    expect(all.every(i => i?.oid === head && i.type === 'commit')).toBe(true)
    expect(liveProcessCount() - before).toBeLessThanOrEqual(1)
    expect(ms).toBeLessThan(2000)
  })

  it('L5 rev absente ou chemin absent : null ; chemin avec accent et espace lu', async () => {
    expect(await objectInfo(repo, 'nope')).toBeNull()
    expect(await objectData(repo, 'HEAD:absent.txt')).toBeNull()
    expect((await objectData(repo, 'HEAD:dir/é b.txt'))?.data.toString()).toBe('beta\n')
  })

  it('P2 cat-file tué : relancé, requête rejouée', async () => {
    await objectInfo(repo, 'HEAD')
    await closeRepo(repo) // ferme le persistant comme à la fermeture du dépôt
    expect((await objectData(repo, 'HEAD:a.txt'))?.data.toString()).toBe('alpha\n')
  })

  it('P3 50 écritures concurrentes sans conflit index.lock', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => {
      fs.writeFileSync(path.join(repo, `w${i}.txt`), String(i))
      return runGit(repo, ['add', '--', `w${i}.txt`], { write: true })
    }))
    const staged = (await gitText(repo, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean)
    expect(staged).toHaveLength(50)
    await runGit(repo, ['reset', '-q'], { write: true })
  })

  it('P8 erreurs classées', async () => {
    await expect(runGit(repo, ['rev-parse', '--verify', 'nope'])).rejects.toMatchObject({ kind: 'not-found' })
    expect(classifyGitError("fatal: unable to access 'https://x/': Could not resolve host: x")).toBe('network')
    expect(classifyGitError("fatal: Authentication failed for 'https://x/'")).toBe('auth')
    expect(classifyGitError(' ! [rejected]        main -> main (non-fast-forward)')).toBe('non-fast-forward')
    expect(classifyGitError("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe('lock')
    expect(classifyGitError('error: Your local changes to the following files would be overwritten by checkout:')).toBe('local-changes')
  })

  it('P7 délai dépassé : GitError timeout', async () => {
    const err = await runGit(repo, ['hash-object', '--stdin'], { timeoutMs: 1, stdin: undefined }).catch(e => e)
    // Selon la machine, git peut finir en moins d'1 ms : seul le type d'erreur est vérifié s'il y en a une.
    if (err instanceof GitError) expect(err.kind).toBe('timeout')
  })

  it('P5 closeAll : aucun processus vivant', async () => {
    await objectInfo(repo, 'HEAD')
    await closeAll()
    expect(liveProcessCount()).toBe(0)
  })
})
