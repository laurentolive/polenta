import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `fs/promises` est un espace de noms ESM non modifiable : `rename` est remplacé par un mock qui
// délègue au vrai sauf quand un test lui impose des échecs.
const renameFailures = vi.hoisted(() => ({ queue: [] as Error[], always: null as Error | null, calls: 0 }))
vi.mock('fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('fs/promises')>()
  const rename = async (from: string, to: string) => {
    renameFailures.calls++
    const err = renameFailures.queue.shift() ?? renameFailures.always
    if (err) throw err
    return real.rename(from, to)
  }
  return { ...real, rename, default: { ...real, rename } }
})

import { PolentaRepoService } from './polenta-repo.service'
import { RepoWatcherService } from './repo-watcher.service'
import type { SyncService } from './sync.service'
import { WorkspaceTreeService } from './workspace-tree.service'

// GH115 — renommer le dossier d'une dépendance : la surveillance du repo est arrêtée (et attendue)
// avant, relancée sur le bon chemin après.

let ws: string
beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh115-'))
  await fsP.mkdir(path.join(ws, 'hmi-PH2'))
  await fsP.writeFile(path.join(ws, 'hmi-PH2', 'README.md'), 'x')
})
afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

const fakeWatcher = () => {
  const calls: string[] = []
  return {
    calls,
    watch: vi.fn((p: string) => { calls.push(`watch:${path.basename(p)}`) }),
    unwatchDir: vi.fn(async (p: string) => { calls.push(`unwatch:${path.basename(p)}`); return [p] }),
  }
}
const service = (watcher?: ReturnType<typeof fakeWatcher>) =>
  new WorkspaceTreeService({} as SyncService, new PolentaRepoService(), watcher, 1)

describe('WorkspaceTreeService.renameClonedRepo (GH115)', () => {
  it('arrête la surveillance, renomme, surveille le nouveau chemin', async () => {
    const w = fakeWatcher()
    await service(w).renameClonedRepo(ws, 'hmi-PH2', 'VE22D')
    expect(w.calls).toEqual(['unwatch:hmi-PH2', 'watch:VE22D'])
    await expect(fsP.readFile(path.join(ws, 'VE22D', 'README.md'), 'utf-8')).resolves.toBe('x')
  })

  it('échec : l\'ancien chemin est de nouveau surveillé, l\'erreur remonte', async () => {
    const w = fakeWatcher()
    await expect(service(w).renameClonedRepo(ws, 'absent', 'VE22D')).rejects.toThrow()
    expect(w.calls).toEqual(['unwatch:absent', 'watch:absent'])
  })

  it('verrou passager : nouvelle tentative ; verrou persistant : message explicite', async () => {
    const lock = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    renameFailures.calls = 0
    renameFailures.queue = [lock]
    await service(fakeWatcher()).renameClonedRepo(ws, 'hmi-PH2', 'VE22D')
    expect(renameFailures.calls).toBe(2)
    renameFailures.calls = 0
    renameFailures.always = lock
    try {
      await expect(service(fakeWatcher()).renameClonedRepo(ws, 'VE22D', 'X')).rejects.toThrow('utilisé par un autre programme')
      expect(renameFailures.calls).toBe(5)
    } finally {
      renameFailures.always = null
    }
  })

  it('RepoWatcherService.unwatchDir : clé insensible à la casse et aux séparateurs, close attendu', async () => {
    const watcher = new RepoWatcherService({ invalidateFile: () => {}, invalidate: () => {} } as never, { invalidateFile: () => {}, invalidate: () => {} } as never)
    const dir = path.join(ws, 'hmi-PH2')
    watcher.watch(dir)
    const other = process.platform === 'win32' ? `${dir.toUpperCase()}${path.sep}` : `${dir}${path.sep}`
    expect(await watcher.unwatchDir(other)).toEqual([dir])
    expect(await watcher.unwatchDir(dir)).toEqual([])
    // Plus aucun descripteur : le dossier se renomme.
    await fsP.rename(dir, path.join(ws, 'VE22D'))
  })
})
