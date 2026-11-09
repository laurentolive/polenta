import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { GitService } from './git.service'
import { SyncService } from './sync.service'
import type { WorkspaceService } from './workspace.service'
import { RepoConformityService } from './repo-conformity.service'
import type { DashboardSeedService } from './dashboard-seed.service'

/**
 * GH336 §3.2, §4, §6 — mise en conformité d'un repo existant : rien n'est écrit sans validation ;
 * `apply` écrit, commite ces seuls fichiers, pousse, et laisse le repo propre.
 */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }

let tmp: string
let origin: string
let repo: string
let service: RepoConformityService
let sync: SyncService
let agentFiles: { path: string; content: string }[]

const run = (cwd: string, ...args: string[]) =>
  execFileAsync('git', ['-c', 'user.name=Testeur', '-c', 'user.email=t@x', '-c', 'core.autocrlf=false', ...args], { cwd })
const write = async (rel: string, content: string) => {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')
const headFiles = async (ref = 'HEAD') => git.listFiles({ fs, dir: repo, ref })
const clean = async () => {
  const s = await sync.status(repo)
  return s.staged.length + s.unstaged.length === 0
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-conf-'))
  origin = path.join(tmp, 'origin.git')
  repo = path.join(tmp, 'repo')
  await run(tmp, 'init', '--bare', '-b', 'main', origin)
  await run(tmp, 'clone', origin, repo)
  await write('a.yaml', 'a: 1\nb: 2\n')
  await write('.gitignore', 'node_modules/\n')
  await write('.local.migrated.pref', 'x: 1\n') // pref commitée par erreur
  await run(repo, 'add', '-A')
  await run(repo, 'commit', '-m', 'base')
  await run(repo, 'push', 'origin', 'main')

  const auth = { getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService
  sync = new SyncService(auth)
  agentFiles = []
  const workspace = { pendingAgentFiles: async () => agentFiles } as unknown as WorkspaceService
  service = new RepoConformityService(new GitService(), sync, workspace)
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('GH336 — check', () => {
  it('liste ce qui manque, sans rien écrire', async () => {
    agentFiles = [{ path: 'AGENTS.md', content: 'agents\n' }]
    const items = await service.check(repo, true)
    expect(items).toEqual([
      { id: 'gitattributes', files: ['.gitattributes'] },
      { id: 'gitignore', files: ['.gitignore'] },
      { id: 'tracked-local', files: ['.local.migrated.pref'] },
      { id: 'agent-files', files: ['AGENTS.md'] },
    ])
    expect(await clean()).toBe(true)
    expect(await read('.gitignore')).toBe('node_modules/\n')
  })

  it('repo conforme : rien à proposer ; fichiers d\'agent seulement pour le repo racine', async () => {
    agentFiles = [{ path: 'AGENTS.md', content: 'agents\n' }]
    await write('.gitattributes', '* text=auto eol=lf\n')
    await write('.gitignore', '.polenta/tree.cache.yaml\n*.pref\n')
    await run(repo, 'rm', '--cached', '.local.migrated.pref')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'conforme')
    expect(await service.check(repo, false)).toEqual([])
  })
})

describe('GH336 — apply', () => {
  it('écrit, commite ces seuls fichiers, retire la pref de l\'index (pas du disque), pousse, repo propre', async () => {
    agentFiles = [{ path: 'AGENTS.md', content: 'agents\n' }]
    const res = await service.apply(repo, true)

    expect(res.pushed).toBe(true)
    const { commit } = await git.readCommit({ fs, dir: repo, oid: res.sha! })
    expect(commit.message).toMatch(/^\[polenta\] Mise en conformité du dépôt/)
    expect(await headFiles()).toEqual(['.gitattributes', '.gitignore', 'AGENTS.md', 'a.yaml'])
    expect(await read('.gitattributes')).toBe('* text=auto eol=lf\n')
    expect(await read('.gitignore')).toBe('node_modules/\n.polenta/tree.cache.yaml\n*.pref\n')
    expect(await read('.local.migrated.pref')).toBe('x: 1\n')
    expect(await clean()).toBe(true)
    // Poussé : origin/main = le commit de conformité.
    const { stdout } = await run(origin, 'rev-parse', 'main')
    expect(stdout.trim()).toBe(res.sha)
    expect(await service.check(repo, false)).toEqual([])
  })

  it('.gitattributes existant : la ligne est ajoutée en tête, les règles précises restent après', async () => {
    await write('.gitattributes', 'vendor.js -text\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'attrs')
    await service.apply(repo, false)
    expect(await read('.gitattributes')).toBe('* text=auto eol=lf\nvendor.js -text\n')
  })

  it('fichiers en CRLF sur le disque (LF dans git) : repassés en LF, jamais vus modifiés', async () => {
    await write('a.yaml', 'a: 1\r\nb: 2\r\n')
    expect(await clean()).toBe(true)
    await service.apply(repo, false)
    expect(await read('a.yaml')).toBe('a: 1\nb: 2\n')
    expect(await clean()).toBe(true)
  })

  it('refuse si une vraie modification est en cours (rien n\'est écrit)', async () => {
    await write('a.yaml', 'a: changed\n')
    await expect(service.apply(repo, false)).rejects.toThrow('conformity-dirty')
    expect(await read('.gitignore')).toBe('node_modules/\n')
  })

  it('la pref commitée et modifiée localement ne bloque pas : c\'est elle qu\'on corrige', async () => {
    await write('.local.migrated.pref', 'x: 2\n')
    const res = await service.apply(repo, false)
    expect(res.pushed).toBe(true)
    expect(await read('.local.migrated.pref')).toBe('x: 2\n')
    expect(await clean()).toBe(true)
  })

  it('refuse hors de la branche d\'intégration', async () => {
    await git.branch({ fs, dir: repo, ref: 'dev-x', checkout: true })
    await expect(service.apply(repo, false)).rejects.toThrow('conformity-off-integration:main')
  })

  it('intégration en retard sur origin : fast-forward d\'abord, puis commit et push', async () => {
    const colleague = path.join(tmp, 'colleague')
    await run(tmp, 'clone', origin, colleague)
    await fsP.writeFile(path.join(colleague, 'c.yaml'), 'c: 1\n')
    await run(colleague, 'add', '-A')
    await run(colleague, 'commit', '-m', 'collègue')
    await run(colleague, 'push', 'origin', 'main')

    const res = await service.apply(repo, false)
    expect(res.pushed).toBe(true)
    expect(await headFiles()).toContain('c.yaml')
  })
})

describe('GH336 — seed partagé des dashboards', () => {
  it('proposé sur le repo racine, écrit et commité avec la mise en conformité seulement', async () => {
    let pending = true
    const seed = {
      sharedSeedPending: async () => pending,
      applySharedSeed: async () => { await write('dashboards/DASHBOARD-0001.yaml', 'id: DASHBOARD-0001\n'); pending = false },
    } as unknown as DashboardSeedService
    const workspace = { pendingAgentFiles: async () => [] } as unknown as WorkspaceService
    const svc = new RepoConformityService(new GitService(), sync, workspace, seed, async () => 'alice')

    expect((await svc.check(repo, false)).map(i => i.id)).not.toContain('dashboards-seed')
    expect((await svc.check(repo, true)).map(i => i.id)).toContain('dashboards-seed')
    expect(await clean()).toBe(true)

    const res = await svc.apply(repo, true)
    expect(res.pushed).toBe(true)
    expect(await headFiles()).toContain('dashboards/DASHBOARD-0001.yaml')
    expect(await clean()).toBe(true)
  })
})
