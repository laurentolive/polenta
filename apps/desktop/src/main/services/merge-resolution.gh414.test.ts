import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'

/** GH414 — « Terminer » une résolution ouverte par « Rafraîchir » : le merge à deux parents part du
 *  commit WIP, sur la branche de travail. Vrai repo, service de résolution réel (GH37). */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }
const WORK = 'dev-travail'

let tmp: string
let origin: string
let repo: string
let colleague: string
let userData: string
let sync: SyncService
let service: MergeResolutionService

async function run(dir: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=Testeur', '-c', 'user.email=t@x', ...args], { cwd: dir })
  return stdout.trim()
}

async function write(rel: string, content: string, dir = repo) {
  await fsP.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
  await fsP.writeFile(path.join(dir, rel), content)
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh414-merge-'))
  origin = path.join(tmp, 'origin.git')
  repo = path.join(tmp, 'repo')
  colleague = path.join(tmp, 'colleague')
  userData = path.join(tmp, 'userdata')
  await run(tmp, 'init', '--bare', '-b', 'main', origin)
  await run(tmp, 'clone', origin, repo)
  await run(repo, 'checkout', '-b', 'main')
  await write('tests/T1.yaml', 'title: t1\n')
  await run(repo, 'add', '-A')
  await run(repo, 'commit', '-m', 'init')
  await run(repo, 'push', '-u', 'origin', 'main')
  await run(tmp, 'clone', origin, colleague)
  await run(repo, 'config', 'core.autocrlf', 'false')
  await run(colleague, 'config', 'core.autocrlf', 'false')
  const auth = {
    getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null, isAccessRevoked: () => false,
  } as unknown as AuthService
  sync = new SyncService(auth)
  service = new MergeResolutionService(userData, auth, sync, new SchemaService(auth))
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('Terminer une résolution « Rafraîchir »', () => {
  it('M1 — résolution terminée : merge à deux parents sur la branche de travail, à partir du WIP', async () => {
    // Ma branche : un commit sur T1 + une modif non commitée. Le collègue modifie T1 aussi.
    await run(repo, 'checkout', '-b', WORK)
    await write('tests/T1.yaml', 'title: ma version\n')
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', 'ma version de T1')
    await write('tests/T1.yaml', 'title: ma version en cours\n')
    await write('tests/T1.yaml', 'title: version équipe\n', colleague)
    await run(colleague, 'add', '-A')
    await run(colleague, 'commit', '-m', 'collègue T1')
    await run(colleague, 'push', 'origin', 'main')

    const out = await sync.refreshBranch(repo, 'main')
    if (out.outcome !== 'conflicts' || !out.wip) throw new Error('expected conflicts with wip')

    const session = await service.open(repo, out.leftRef, out.rightRef, {
      kind: 'merge', from: out.leftRef, into: out.rightRef, wip: out.wip,
    })
    expect(session.targetRef).toBe(WORK)

    const file = session.files.find(f => f.path === 'tests/T1.yaml')
    if (!file) throw new Error('T1.yaml should be in conflict')
    await service.saveFile(session.id, file.path, { state: 'merged', text: 'title: résolu\n' })

    const res = await service.finalize(session.id)
    expect(res).toMatchObject({ ok: true })

    // Le merge à deux parents : parent 1 = le WIP (ma branche), parent 2 = l'intégration.
    const { commit } = await git.readCommit({ fs, dir: repo, oid: await git.resolveRef({ fs, dir: repo, ref: WORK }) })
    expect(commit.parent).toHaveLength(2)
    expect(commit.parent[0]).toBe(out.wip)
    expect(commit.message).toContain(`Merge branch 'main' into ${WORK}`)
    expect(await git.currentBranch({ fs, dir: repo })).toBe(WORK)
    expect(await fsP.readFile(path.join(repo, 'tests/T1.yaml'), 'utf8')).toBe('title: résolu\n')
  })
})
