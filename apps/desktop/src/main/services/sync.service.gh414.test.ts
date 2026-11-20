import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAutoBranch } from '@polenta/types'

import type { AuthService } from './auth.service'
import { REFRESH_WIP_MESSAGE, SyncService } from './sync.service'
import { gitFor } from '../git/git-backend'

/** GH414 — « Rafraîchir » : specs/GH414-tests.md, sur de vrais repos git temporaires. */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }
const WORK = 'dev-travail'

let tmp: string
let origin: string
let repo: string
let colleague: string
let sync: SyncService

async function run(dir: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=Testeur', '-c', 'user.email=t@x', ...args], { cwd: dir })
  return stdout.trim()
}

async function write(rel: string, content: string, dir = repo) {
  await fsP.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
  await fsP.writeFile(path.join(dir, rel), content)
}

async function read(rel: string, dir = repo) {
  return fsP.readFile(path.join(dir, rel), 'utf8')
}

const current = () => gitFor(repo).currentBranch()
const sha = (ref: string, dir = repo) => gitFor(dir).resolveOrThrow(ref)
const parentsOfHead = async () => (await run(repo, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length - 1
const headSubjects = async (n = 6) => (await run(repo, 'log', '--format=%s', '-n', String(n))).split('\n')
const pendingFiles = async () => {
  const { staged, unstaged } = await sync.status(repo)
  return { staged: staged.map(f => f.path), unstaged: unstaged.map(f => f.path) }
}

/** Le collègue publie `rel` sur `origin/main`. */
async function colleaguePublishes(rel: string, content: string) {
  await write(rel, content, colleague)
  await run(colleague, 'add', '-A')
  await run(colleague, 'commit', '-m', `collègue ${rel}`)
  await run(colleague, 'push', 'origin', 'main')
}

/** Branche de travail créée depuis `main`, avec un commit personnel, puis on y reste. */
async function workBranchWithOwnCommit() {
  await run(repo, 'checkout', '-b', WORK)
  await write('mine/M1.yaml', 'title: mine\n')
  await run(repo, 'add', '-A')
  await run(repo, 'commit', '-m', 'mon travail')
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh414-'))
  origin = path.join(tmp, 'origin.git')
  repo = path.join(tmp, 'repo')
  colleague = path.join(tmp, 'colleague')
  await run(tmp, 'init', '--bare', '-b', 'main', origin)
  await run(tmp, 'clone', origin, repo)
  await run(repo, 'checkout', '-b', 'main')
  await write('requirements/R1.yaml', 'title: r1\n')
  await write('tests/T1.yaml', 'title: t1\n')
  await run(repo, 'add', '-A')
  await run(repo, 'commit', '-m', 'init')
  await run(repo, 'push', '-u', 'origin', 'main')
  await run(tmp, 'clone', origin, colleague)
  // Deterministic line endings whatever the machine's global config (Windows autocrlf).
  await run(repo, 'config', 'core.autocrlf', 'false')
  await run(colleague, 'config', 'core.autocrlf', 'false')
  const auth = {
    getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null, isAccessRevoked: () => false,
  } as unknown as AuthService
  sync = new SyncService(auth)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('refreshState — compteur du bouton', () => {
  it('G1 — branche de travail en retard : compte les commits de l\'intégration absents', async () => {
    await workBranchWithOwnCommit()
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')
    await sync.fetch(repo, '')
    const s = await sync.refreshState(repo, 'main')
    expect(s).toMatchObject({ branch: WORK, integration: 'main', onIntegration: false, behind: 1, dirty: false })
  })

  it('G2 — sur l\'intégration : compteur à zéro', async () => {
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')
    await sync.fetch(repo, '')
    const s = await sync.refreshState(repo, 'main')
    expect(s).toMatchObject({ onIntegration: true, behind: 0 })
  })

  it('G3 — à jour : compteur à zéro, et signale les modifs en cours', async () => {
    await workBranchWithOwnCommit()
    await write('mine/M1.yaml', 'title: mine modifié\n')
    const s = await sync.refreshState(repo, 'main')
    expect(s).toMatchObject({ behind: 0, dirty: true })
  })

  it('G4 — ne fait aucun appel réseau', async () => {
    await workBranchWithOwnCommit()
    const fetchSpy = vi.spyOn(sync, 'fetch')
    await sync.refreshState(repo, 'main')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('refreshBranch — sans modif locale', () => {
  it('R1 — merge propre : les commits de l\'intégration arrivent, ceux de la branche sont conservés', async () => {
    await workBranchWithOwnCommit()
    const own = await sha(WORK)
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'merged', pulled: 1 })
    expect(out.outcome === 'merged' && out.wip).toBeFalsy()
    expect(await current()).toBe(WORK)
    expect(await read('requirements/R2.yaml')).toBe('title: r2\n')
    expect(await read('mine/M1.yaml')).toBe('title: mine\n')
    expect(await parentsOfHead()).toBe(2)
    expect(await run(repo, 'merge-base', '--is-ancestor', own, 'HEAD').catch(() => 'no')).not.toBe('no')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(await pendingFiles()).toEqual({ staged: [], unstaged: [] })
  })

  it('R2 — rien à récupérer : aucun commit, aucune écriture', async () => {
    await workBranchWithOwnCommit()
    const head = await sha(WORK)
    const out = await sync.refreshBranch(repo, 'main')
    expect(out).toEqual({ outcome: 'up-to-date' })
    expect(await sha(WORK)).toBe(head)
  })

  it('R3 — hors-ligne : rien n\'est écrit', async () => {
    await workBranchWithOwnCommit()
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')
    const head = await sha(WORK)
    vi.spyOn(sync, 'fetch').mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))
    const out = await sync.refreshBranch(repo, 'main')
    expect(out).toEqual({ outcome: 'offline' })
    expect(await sha(WORK)).toBe(head)
  })

  it('R4 — sur la branche d\'intégration : fast-forward seulement, pas de merge ni de WIP', async () => {
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')
    const out = await sync.refreshBranch(repo, 'main')
    expect(out).toEqual({ outcome: 'integration-updated' })
    expect(await current()).toBe('main')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(await parentsOfHead()).toBe(1)
    expect(await headSubjects(1)).toEqual(['collègue requirements/R2.yaml'])
  })
})

describe('refreshBranch — clic sur l\'intégration avec modifs en cours', () => {
  it('R10 — le retard arrive aussi dans la branche où l\'auto-pull a déplacé les modifs (dev-auto)', async () => {
    // Modif non commitée sur l'intégration : l'auto-pull la déplace sur dev-auto (GH173).
    await write('mine/P.yaml', 'title: en cours\n')
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'merged', pulled: 1 })
    expect(isAutoBranch(await current() ?? '')).toBe(true)
    // Le fichier de l'équipe est dans l'arbre de travail, pas seulement dans la ref de l'intégration.
    expect(await read('requirements/R2.yaml')).toBe('title: r2\n')
    expect(await read('mine/P.yaml')).toBe('title: en cours\n')
    expect(await pendingFiles()).toEqual({ staged: [], unstaged: [] })
  })
})

describe('refreshBranch — modifs non commitées (commit WIP)', () => {
  it('R5 — un commit WIP est créé, les modifs sont présentes et identiques après le merge', async () => {
    await workBranchWithOwnCommit()
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')
    await write('mine/M1.yaml', 'title: mine modifié\n')
    await write('mine/NEW.yaml', 'title: nouveau\n')

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'merged', pulled: 1 })
    if (out.outcome !== 'merged') throw new Error('expected merged')
    expect(out.wip).toBeTruthy()
    expect(await headSubjects(4)).toContain(REFRESH_WIP_MESSAGE)
    expect(await read('mine/M1.yaml')).toBe('title: mine modifié\n')
    expect(await read('mine/NEW.yaml')).toBe('title: nouveau\n')
    expect(await read('requirements/R2.yaml')).toBe('title: r2\n')
    expect(await pendingFiles()).toEqual({ staged: [], unstaged: [] })
  })
})

describe('refreshBranch — conflit et résolution', () => {
  /** Le collègue et moi modifions le même fichier. */
  async function conflictingSetup(uncommitted: boolean) {
    await workBranchWithOwnCommit()
    await write('tests/T1.yaml', 'title: ma version\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'ma version de T1')
    if (uncommitted) await write('tests/T1.yaml', 'title: ma version en cours\n')
    await colleaguePublishes('tests/T1.yaml', 'title: version équipe\n')
  }

  it('R6 — conflit : aucun merge écrit, la résolution est renvoyée, le WIP est la tête de la branche', async () => {
    await conflictingSetup(true)
    const before = await sha(WORK)

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'conflicts', leftRef: 'main', rightRef: WORK })
    if (out.outcome !== 'conflicts') throw new Error('expected conflicts')
    expect(out.conflicts).toContain('tests/T1.yaml')
    expect(out.wip).toBeTruthy()
    expect(await sha(WORK)).toBe(out.wip)
    expect(await parentsOfHead()).toBe(1)
    expect(await sha(WORK)).not.toBe(before)
    expect(await read('tests/T1.yaml')).toBe('title: ma version en cours\n')
  })

  it('R6b — conflit sans modif en cours : pas de WIP, branche intacte', async () => {
    await conflictingSetup(false)
    const before = await sha(WORK)
    const out = await sync.refreshBranch(repo, 'main')
    expect(out).toMatchObject({ outcome: 'conflicts' })
    if (out.outcome !== 'conflicts') throw new Error('expected conflicts')
    expect(out.wip).toBeUndefined()
    expect(await sha(WORK)).toBe(before)
  })

  it('R7 — « Abandonner » : branche, HEAD et contenu identiques à avant le clic, modifs non indexées', async () => {
    await conflictingSetup(true)
    const before = await sha(WORK)
    const out = await sync.refreshBranch(repo, 'main')
    if (out.outcome !== 'conflicts' || !out.wip) throw new Error('expected conflicts with wip')

    const res = await sync.undoRefreshWip(repo, out.wip)

    expect(res).toEqual({ undone: true })
    expect(await current()).toBe(WORK)
    expect(await sha(WORK)).toBe(before)
    expect(await read('tests/T1.yaml')).toBe('title: ma version en cours\n')
    const { staged, unstaged } = await pendingFiles()
    expect(staged).toEqual([])
    expect(unstaged).toContain('tests/T1.yaml')
  })

  it('R7b — « Abandonner » refusé si la branche a bougé depuis (commit par-dessus) : rien n\'est touché', async () => {
    await conflictingSetup(true)
    const out = await sync.refreshBranch(repo, 'main')
    if (out.outcome !== 'conflicts' || !out.wip) throw new Error('expected conflicts with wip')
    await write('mine/AUTRE.yaml', 'x\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'commit par-dessus')
    const head = await sha(WORK)

    const res = await sync.undoRefreshWip(repo, out.wip)

    expect(res).toEqual({ undone: false })
    expect(await sha(WORK)).toBe(head)
  })

  it('R7c — abandon sans WIP : un commit de l\'utilisateur n\'est jamais défait', async () => {
    await conflictingSetup(false)
    const before = await sha(WORK)
    const res = await sync.undoRefreshWip(repo, before)
    expect(res).toEqual({ undone: false })
    expect(await sha(WORK)).toBe(before)
    expect(await headSubjects(1)).toEqual(['ma version de T1'])
  })
})

describe('refreshBranch — intégration divergée (Resynchroniser, GH39)', () => {
  it('R8 — divergence sans conflit : resynchronisation puis merge, l\'intégration locale est poussée', async () => {
    await workBranchWithOwnCommit()
    await run(repo, 'checkout', 'main')
    await write('requirements/L1.yaml', 'title: local main\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'commit local main')
    await run(repo, 'checkout', WORK)
    await colleaguePublishes('requirements/R2.yaml', 'title: r2\n')

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'merged' })
    expect(await read('requirements/L1.yaml')).toBe('title: local main\n')
    expect(await read('requirements/R2.yaml')).toBe('title: r2\n')
    expect(await sha('refs/remotes/origin/main')).toBe(await sha('main'))
  })

  it('R9 — divergence avec conflit : commits de l\'intégration mis de côté sur dev-resync, puis merge de l\'intégration recalée', async () => {
    await workBranchWithOwnCommit()
    await run(repo, 'checkout', 'main')
    await write('tests/T1.yaml', 'title: local T1\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'local T1 sur main')
    await run(repo, 'checkout', WORK)
    await colleaguePublishes('tests/T1.yaml', 'title: équipe T1\n')

    const out = await sync.refreshBranch(repo, 'main')

    expect(out).toMatchObject({ outcome: 'merged' })
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect((await sync.status(repo)).branch).toBe(WORK)
    const branches = await gitFor(repo).refNames('refs/heads')
    expect(branches).toContain('dev-resync')
    expect(await read('mine/M1.yaml')).toBe('title: mine\n')
  })
})
