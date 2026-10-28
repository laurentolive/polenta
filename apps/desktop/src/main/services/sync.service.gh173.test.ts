import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAutoBranch } from '@polenta/types'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'

/** GH173 — specs/GH173-tests.md (scénarios U), sur de vrais repos git temporaires. */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }

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

const current = () => git.currentBranch({ fs, dir: repo })
const sha = (ref: string, dir = repo) => git.resolveRef({ fs, dir, ref })
const branches = () => git.listBranches({ fs, dir: repo })

/** Le collègue publie `rel` sur `origin/main`. */
async function colleaguePublishes(rel: string, content: string) {
  await write(rel, content, colleague)
  await run(colleague, 'add', '-A')
  await run(colleague, 'commit', '-m', `collègue ${rel}`)
  await run(colleague, 'push', 'origin', 'main')
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh173-'))
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
  const auth = {
    getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null, isAccessRevoked: () => false,
  } as unknown as AuthService
  sync = new SyncService(auth)
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('isAutoBranch (U20)', () => {
  it('noms exacts générés seulement', () => {
    for (const b of ['dev-auto', 'dev-auto-2', 'dev-auto-17']) expect(isAutoBranch(b)).toBe(true)
    for (const b of ['dev-auto-notes', 'dev-autonome', 'dev-auto-', 'main', 'dev-resync']) expect(isAutoBranch(b)).toBe(false)
  })
})

describe('settleAutoBranch', () => {
  it('U1 — intégration modifiée : bascule sur dev-auto sans toucher aux fichiers', async () => {
    const before = await sha('main')
    await write('requirements/R1.yaml', 'title: modifié\n')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'switched', branch: 'dev-auto' })
    expect(await current()).toBe('dev-auto')
    expect(await read('requirements/R1.yaml')).toBe('title: modifié\n')
    expect((await sync.status(repo)).unstaged.map(f => f.path)).toEqual(['requirements/R1.yaml'])
    expect(await sha('main')).toBe(before)
  })

  it('U2 — nouveau fichier non suivi seulement : bascule', async () => {
    await write('requirements/R2.yaml', 'title: r2\n')
    expect(await sync.settleAutoBranch(repo, 'main')).toMatchObject({ action: 'switched' })
  })

  it('U3 — repo propre : rien', async () => {
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await current()).toBe('main')
  })

  it('U4 — sans remote : rien', async () => {
    await run(repo, 'remote', 'remove', 'origin')
    await write('requirements/R1.yaml', 'title: modifié\n')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await current()).toBe('main')
  })

  it('U5 — HEAD détaché : rien', async () => {
    await git.checkout({ fs, dir: repo, ref: await sha('main') })
    await write('requirements/R1.yaml', 'title: modifié\n')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await current()).toBeUndefined()
  })

  it('U6 — sur une branche dev-* ou une int-* non désignée : rien', async () => {
    for (const b of ['dev-perso', 'int-B']) {
      await sync.createBranch(repo, b)
      await write('requirements/R1.yaml', `title: ${b}\n`)
      expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
      expect(await current()).toBe(b)
      await sync.discardAll(repo)
      await git.checkout({ fs, dir: repo, ref: 'main' })
    }
  })

  it('U7 — dev-auto existante et non fusionnée : bascule sur dev-auto-2', async () => {
    await sync.createBranch(repo, 'dev-auto')
    await write('requirements/R1.yaml', 'title: travail\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'travail')
    await git.checkout({ fs, dir: repo, ref: 'main' })
    await write('tests/T1.yaml', 'title: autre\n')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'switched', branch: 'dev-auto-2' })
    expect(await branches()).toContain('dev-auto')
  })

  it('U8 — dev-auto propre sans commit : retour sur l\'intégration, branche supprimée', async () => {
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.settleAutoBranch(repo, 'main')
    await sync.discardAll(repo)
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'returned', branch: 'dev-auto' })
    expect(await current()).toBe('main')
    expect(await branches()).not.toContain('dev-auto')
  })

  it('U9 — dev-auto propre avec un commit absent de l\'intégration : conservée', async () => {
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.settleAutoBranch(repo, 'main')
    await sync.stageAll(repo)
    await sync.commit(repo, 'publication interrompue')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await current()).toBe('dev-auto')
  })

  it('U10 — dev-auto modifiée : rien', async () => {
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.settleAutoBranch(repo, 'main')
    expect(await sync.settleAutoBranch(repo, 'main')).toEqual({ action: 'none' })
    expect(await current()).toBe('dev-auto')
  })

  it('U11 — dev-auto-3 fusionnée non checkoutée supprimée, dev-auto-notes conservée', async () => {
    await git.branch({ fs, dir: repo, ref: 'dev-auto-3' })
    await git.branch({ fs, dir: repo, ref: 'dev-auto-notes' })
    await sync.settleAutoBranch(repo, 'main')
    const names = await branches()
    expect(names).not.toContain('dev-auto-3')
    expect(names).toContain('dev-auto-notes')
  })
})

describe('autoSync', () => {
  it('U12 — intégration modifiée, collègue a poussé : bascule, main avancée, WD inchangé', async () => {
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await write('requirements/R1.yaml', 'title: modifié\n')
    const state = await sync.autoSync(repo, 'main')
    expect(await current()).toBe('dev-auto')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(state.state).toBe('up-to-date')
    expect(await read('requirements/R1.yaml')).toBe('title: modifié\n')
    expect(fs.existsSync(path.join(repo, 'tests/T2.yaml'))).toBe(false)
  })

  it('U13 — dev-auto propre sans commit, collègue a poussé : retour sur main à jour', async () => {
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.settleAutoBranch(repo, 'main')
    await sync.discardAll(repo)
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await sync.autoSync(repo, 'main')
    expect(await current()).toBe('main')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(await read('tests/T2.yaml')).toBe('title: t2\n')
  })

  it('U14 — serveur injoignable : la bascule a lieu avant le fetch', async () => {
    await run(repo, 'remote', 'set-url', 'origin', path.join(tmp, 'absent.git'))
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.autoSync(repo, 'main').catch(() => {})
    expect(await current()).toBe('dev-auto')
  })

  it('U15 — sur une dev-* manuelle : main avancée, branche courante inchangée', async () => {
    await sync.createBranch(repo, 'dev-perso')
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await sync.autoSync(repo, 'main')
    expect(await current()).toBe('dev-perso')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
  })

  it('U16 — intégration divergée, sur dev-auto : main non modifiée', async () => {
    await write('tests/T1.yaml', 'title: local\n')
    await run(repo, 'commit', '-am', 'local non poussé')
    const local = await sha('main')
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await write('requirements/R1.yaml', 'title: modifié\n')
    await run(repo, 'remote', 'set-url', '--push', 'origin', path.join(tmp, 'absent.git'))
    const state = await sync.autoSync(repo, 'main')
    expect(await current()).toBe('dev-auto')
    expect(await sha('main')).toBe(local)
    expect(state.state).toBe('diverged')
  })
})

describe('autoSync — revue de code', () => {
  it('U21 — dev-auto avec un commit propre (publication en conflit) : main non déplacée', async () => {
    await write('requirements/R1.yaml', 'title: modifié\n')
    await sync.settleAutoBranch(repo, 'main')
    await sync.stageAll(repo)
    await sync.commit(repo, 'publication en cours')
    const before = await sha('main')
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await sync.autoSync(repo, 'main')
    expect(await current()).toBe('dev-auto')
    expect(await sha('main')).toBe(before)
  })
})

describe('resyncIntegration', () => {
  it('U17 — intégration modifiée et en retard : bascule puis fast-forward, WD intact', async () => {
    await colleaguePublishes('tests/T2.yaml', 'title: t2\n')
    await write('requirements/R1.yaml', 'title: modifié\n')
    expect(await sync.resyncIntegration(repo, 'main')).toEqual({ outcome: 'fast-forwarded' })
    expect(await current()).toBe('dev-auto')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(await read('requirements/R1.yaml')).toBe('title: modifié\n')
  })

  it('U18 — sans remote : inchangé', async () => {
    await run(repo, 'remote', 'remove', 'origin')
    await write('requirements/R1.yaml', 'title: modifié\n')
    expect(await sync.resyncIntegration(repo, 'main')).toEqual({ outcome: 'up-to-date' })
    expect(await current()).toBe('main')
  })

  it('U22 — divergée en conflit avec modifications en attente : commits gardés sur dev-auto, pas de dev-resync', async () => {
    await write('requirements/R1.yaml', 'title: local\n')
    await run(repo, 'commit', '-am', 'local non poussé')
    await colleaguePublishes('requirements/R1.yaml', 'title: collègue\n')
    await write('tests/T1.yaml', 'title: en attente\n')
    expect(await sync.resyncIntegration(repo, 'main')).toEqual({ outcome: 'set-aside', branch: 'dev-auto' })
    expect(await current()).toBe('dev-auto')
    expect(await sha('main')).toBe(await sha('refs/remotes/origin/main'))
    expect(await branches()).not.toContain('dev-resync')
    expect(await read('tests/T1.yaml')).toBe('title: en attente\n')
  })

  it('U19 — non-régression GH39 : mise de côté sur dev-resync puis dev-resync-2', async () => {
    await git.branch({ fs, dir: repo, ref: 'dev-resync' })
    await write('requirements/R1.yaml', 'title: local\n')
    await run(repo, 'commit', '-am', 'local non poussé')
    await colleaguePublishes('requirements/R1.yaml', 'title: collègue\n')
    expect(await sync.resyncIntegration(repo, 'main')).toEqual({ outcome: 'set-aside', branch: 'dev-resync-2' })
    expect(await current()).toBe('dev-resync-2')
  })
})
