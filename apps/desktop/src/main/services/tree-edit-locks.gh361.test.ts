import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TREE_LOCK_TTL_MS, lockDir, readAppLock, withTreeWriteLock } from './tree-lock.util'
import { TreeEditLocksService } from './tree-edit-locks.service'

// GH361 — baux du verrou long côté application (specs/GH361-tests.md D1, D2).

let repo: string
let clock: number
let locks: TreeEditLocksService

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh361-edit-'))
  await fsP.mkdir(path.join(repo, '.git'))
  clock = Date.now()
  locks = new TreeEditLocksService(() => clock)
})
afterEach(async () => {
  await locks.releaseAll()
  await fsP.rm(repo, { recursive: true, force: true })
})

const appFiles = async () => (await fsP.readdir(await lockDir(repo)).catch(() => [] as string[])).filter(n => n.includes('.app-'))

describe('TreeEditLocksService', () => {
  it('D1 — acquire pose le verrou, release le retire ; deux baux : tenu tant qu’il en reste un', async () => {
    const a = await locks.acquire(repo, 'root', 'req')
    expect(await readAppLock(repo, 'root', 'req')).toMatchObject({ by: 'app' })
    const b = await locks.acquire(repo, 'root', 'req')
    await locks.release(a)
    expect(await readAppLock(repo, 'root', 'req')).not.toBeNull()
    await locks.release(b)
    expect(await readAppLock(repo, 'root', 'req')).toBeNull()
    expect(await appFiles()).toEqual([])
  })

  it('D1 — le MCP est refusé tant que le bail est tenu', async () => {
    const id = await locks.acquire(repo, 'root', 'req')
    await expect(withTreeWriteLock(repo, 'root', 'req', async () => 1)).rejects.toMatchObject({ code: 'TREE_LOCKED' })
    await locks.release(id)
    expect(await withTreeWriteLock(repo, 'root', 'req', async () => 1)).toBe(1)
  })

  it('D1 — purge des baux échus ; renew d’un bail purgé → false ; renew prolonge', async () => {
    const id = await locks.acquire(repo, 'root', 'req')
    clock += TREE_LOCK_TTL_MS - 1000
    expect(await locks.renew(id)).toBe(true)
    clock += TREE_LOCK_TTL_MS - 1000
    await locks.prune()
    expect(await readAppLock(repo, 'root', 'req')).not.toBeNull()
    clock += TREE_LOCK_TTL_MS
    await locks.prune()
    expect(await appFiles()).toEqual([])
    expect(await locks.renew(id)).toBe(false)
  })

  it('D1 — releaseAll retire tous les fichiers', async () => {
    await locks.acquire(repo, 'root', 'req')
    await locks.acquire(repo, 'root', 'test')
    await locks.releaseAll()
    expect(await appFiles()).toEqual([])
  })

  it('revue — deux instances du même processus (serveur web) : chacune ses fichiers', async () => {
    const other = new TreeEditLocksService(() => clock)
    try {
      const a = await locks.acquire(repo, 'root', 'req')
      await other.acquire(repo, 'root', 'req')
      await locks.release(a)
      expect(await readAppLock(repo, 'root', 'req')).not.toBeNull()
      expect(await appFiles()).toHaveLength(1)
    } finally {
      await other.releaseAll()
    }
    expect(await appFiles()).toEqual([])
  })

  it('D2 — acquire attend la fin d’une écriture MCP en cours', async () => {
    let written = false
    const writing = withTreeWriteLock(repo, 'root', 'req', async () => {
      await new Promise(r => setTimeout(r, 100))
      written = true
    })
    await new Promise(r => setTimeout(r, 20))
    await locks.acquire(repo, 'root', 'req')
    expect(written).toBe(true)
    await writing
  })
})
