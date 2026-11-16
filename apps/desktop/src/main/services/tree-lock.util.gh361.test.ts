import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TREE_LOCK_TTL_MS, TreeLockedError, lockDir, readAppLock, removeAppLock, waitForWriteLock, withTreeWriteLock, writeAppLock,
} from './tree-lock.util'

// GH361 — verrou du rangement (specs/GH361-tests.md §B). Un PID mort est simulé par un PID très grand.

const DEAD_PID = 2_000_000_000
let repo: string

const future = () => new Date(Date.now() + TREE_LOCK_TTL_MS).toISOString()
const now = () => new Date().toISOString()
const writeFile = async (name: string, content: unknown) => {
  const dir = await lockDir(repo)
  await fsP.mkdir(dir, { recursive: true })
  await fsP.writeFile(path.join(dir, name), JSON.stringify(content))
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh361-lock-'))
  await fsP.mkdir(path.join(repo, '.git'))
})
afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('tree-lock', () => {
  it('B1 — sous le dossier git ; .git fichier (worktree) → dossier cible', async () => {
    expect(await lockDir(repo)).toBe(path.join(repo, '.git', 'polenta', 'locks'))
    const wt = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh361-wt-'))
    try {
      await fsP.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'x')}\n`)
      expect(await lockDir(wt)).toBe(path.join(repo, '.git', 'worktrees', 'x', 'polenta', 'locks'))
    } finally {
      await fsP.rm(wt, { recursive: true, force: true })
    }
  })

  it('B2 — sans verrou : exécute, puis libère (même en cas d’erreur)', async () => {
    expect(await withTreeWriteLock(repo, 'root', 'req', async () => 42)).toBe(42)
    await expect(withTreeWriteLock(repo, 'root', 'req', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await fsP.readdir(await lockDir(repo))).toEqual([])
  })

  it('B3 — verrou long actif : refus avec `since`, rien exécuté, verrou court libéré', async () => {
    const since = now()
    await writeAppLock(repo, 'root', 'req', since, future())
    let ran = false
    const err = await withTreeWriteLock(repo, 'root', 'req', async () => { ran = true }).catch(e => e)
    expect(err).toBeInstanceOf(TreeLockedError)
    expect((err as TreeLockedError).info).toEqual({ by: 'app', since })
    expect(ran).toBe(false)
    expect((await fsP.readdir(await lockDir(repo))).filter(n => n.endsWith('.write'))).toEqual([])
    expect(await readAppLock(repo, 'root', 'req')).toEqual({ by: 'app', since })
    await removeAppLock(repo, 'root', 'req')
    expect(await readAppLock(repo, 'root', 'req')).toBeNull()
  })

  it('B4 — verrou long expiré ou processus mort : ignoré', async () => {
    await writeAppLock(repo, 'root', 'req', now(), new Date(Date.now() - 1000).toISOString())
    await writeFile(`tree.root.req.app-${DEAD_PID}.json`, { pid: DEAD_PID, since: now(), expiresAt: future() })
    expect(await readAppLock(repo, 'root', 'req')).toBeNull()
    expect(await withTreeWriteLock(repo, 'root', 'req', async () => 'ok')).toBe('ok')
  })

  it('B5 — écritures concurrentes sérialisées', async () => {
    let inside = 0
    let max = 0
    const run = () => withTreeWriteLock(repo, 'root', 'req', async () => {
      inside++
      max = Math.max(max, inside)
      await new Promise(r => setTimeout(r, 30))
      inside--
    })
    await Promise.all([run(), run(), run()])
    expect(max).toBe(1)
  })

  it('B6 — verrou court d’un processus mort ou trop ancien : repris', async () => {
    await writeFile('tree.root.req.write', { pid: DEAD_PID, since: now() })
    expect(await withTreeWriteLock(repo, 'root', 'req', async () => 1)).toBe(1)
    await writeFile('tree.root.req.write', { pid: process.pid, since: new Date(Date.now() - 2 * TREE_LOCK_TTL_MS).toISOString() })
    expect(await withTreeWriteLock(repo, 'root', 'req', async () => 2)).toBe(2)
  })

  it('revue — un verrou repris par un autre processus n’est pas supprimé par l’ancien détenteur', async () => {
    const file = path.join(await lockDir(repo), 'tree.root.req.write')
    const other = { pid: process.pid, since: now(), token: 'autre' }
    await withTreeWriteLock(repo, 'root', 'req', async () => {
      await fsP.writeFile(file, JSON.stringify(other))
    })
    expect(JSON.parse(await fsP.readFile(file, 'utf-8'))).toEqual(other)
    expect((await fsP.readdir(await lockDir(repo))).filter(n => n.endsWith('.stale'))).toEqual([])
  })

  it('B7 — verrou court vivant tenu au-delà de l’attente : refus', async () => {
    await writeFile('tree.root.req.write', { pid: process.pid, since: now() })
    await expect(withTreeWriteLock(repo, 'root', 'req', async () => 1)).rejects.toBeInstanceOf(TreeLockedError)
  }, 10_000)

  it('B8 — un autre type n’est pas concerné ; noms de nœud/type encodés', async () => {
    await writeAppLock(repo, 'root', 'req', now(), future())
    expect(await withTreeWriteLock(repo, 'root', 'test', async () => 'ok')).toBe('ok')
    await writeAppLock(repo, 'n_1', 'a.b', now(), future())
    expect(await readAppLock(repo, 'n.1', 'a_b')).toBeNull()
    expect(await readAppLock(repo, 'n_1', 'a.b')).not.toBeNull()
  })

  it('B9 — waitForWriteLock rend la main à la libération', async () => {
    let released = false
    const writing = withTreeWriteLock(repo, 'root', 'req', async () => {
      await new Promise(r => setTimeout(r, 100))
      released = true
    })
    await new Promise(r => setTimeout(r, 20))
    await waitForWriteLock(repo, 'root', 'req')
    expect(released).toBe(true)
    await writing
  })
})
